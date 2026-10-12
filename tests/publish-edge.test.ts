import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publishToEdge, type Settings } from "../scripts/publish-edge.ts";

/**
 * The upload to Edge Add-ons, against a stand-in for the store that keeps to the shape Microsoft
 * documents: a POST answers 202 with the operation's id in Location, and a GET on the operation
 * answers 200 with its status.
 */
const SETTINGS: Settings = {
  productId: "765d310d-eb89-4c3c-af8d-d031dbc78399",
  clientId: "client-1",
  apiKey: "secret-key-value",
  zip: new Uint8Array([80, 75, 3, 4]),
  notes: "Version 2.0.0.",
};

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

/** `answers` is what each operation's GET says, in order; a POST that is not listed is accepted. */
function store(options: { uploadAnswers?: object[]; publishAnswers?: object[]; postStatus?: Record<string, number>; noLocation?: boolean } = {}) {
  const calls: Call[] = [];
  const uploadAnswers = [...(options.uploadAnswers ?? [{ status: "Succeeded", message: "Successfully updated package" }])];
  const publishAnswers = [...(options.publishAnswers ?? [{ status: "Succeeded", message: "Successfully created submission" }])];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, headers: init?.headers as Record<string, string>, body: init?.body });
    // The store answers an operation that is still going with 202, and a finished one with 200.
    const json = (body: { status?: string }) => new Response(JSON.stringify(body), { status: body.status === "InProgress" ? 202 : 200 });
    if (method === "POST") {
      const status = options.postStatus?.[url.endsWith("/draft/package") ? "upload" : "publish"] ?? 202;
      return new Response(status === 202 ? "" : "refused", { status, headers: status === 202 && !options.noLocation ? { location: url.endsWith("/draft/package") ? "op-upload" : "op-publish" } : {} });
    }
    return json((url.includes("/draft/package/operations/") ? uploadAnswers.shift() : publishAnswers.shift()) as { status?: string });
  };
  return { calls, fetch: fetcher as typeof fetch };
}

const quick = { wait: async () => undefined, every: 0, tries: 5, log: () => undefined };

test("the package goes up, then the draft is submitted, in that order and with the key in the header", async () => {
  const { calls, fetch } = store({ uploadAnswers: [{ status: "InProgress" }, { status: "Succeeded", message: "Successfully updated package to a.zip" }] });

  const result = await publishToEdge(SETTINGS, { ...quick, fetch });

  assert.deepEqual(result, { upload: "Successfully updated package to a.zip", publish: "Successfully created submission" });
  const base = "https://api.addons.microsoftedge.microsoft.com/v1/products/765d310d-eb89-4c3c-af8d-d031dbc78399/submissions";
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url.slice(base.length)}`),
    ["POST /draft/package", "GET /draft/package/operations/op-upload", "GET /draft/package/operations/op-upload", "POST ", "GET /operations/op-publish"],
  );
  assert.equal(calls[0].headers.Authorization, "ApiKey secret-key-value");
  assert.equal(calls[0].headers["X-ClientID"], "client-1");
  assert.equal(calls[0].headers["Content-Type"], "application/zip");
  assert.equal(calls[3].body, "Version 2.0.0.", "the notes are the body of the submission");
});

test("what is printed never carries the API key", async () => {
  const lines: string[] = [];
  const { fetch } = store();

  await publishToEdge(SETTINGS, { ...quick, fetch, log: (line) => lines.push(line) });

  assert.ok(lines.length > 0);
  assert.ok(lines.every((line) => !line.includes("secret-key-value")));
});

test("a package the store refuses stops there, says why, and submits nothing", async () => {
  const { calls, fetch } = store({ uploadAnswers: [{ status: "Failed", message: "Version is not higher.", errorCode: "InvalidVersion", errors: ["1.18.0 is already in the store"] }] });

  await assert.rejects(publishToEdge(SETTINGS, { ...quick, fetch }), /Upload failed \[InvalidVersion\]: Version is not higher\. \["1\.18\.0 is already in the store"\]/);
  assert.ok(!calls.some((call) => call.method === "POST" && !call.url.endsWith("/draft/package")), "it submitted anyway");
});

test("a submission the store will not take says why", async () => {
  const { fetch } = store({ publishAnswers: [{ status: "Failed", message: "Can't publish extension since there are no updates.", errorCode: "NoModulesUpdated" }] });

  await assert.rejects(publishToEdge(SETTINGS, { ...quick, fetch }), /Publish failed \[NoModulesUpdated\]: Can't publish extension since there are no updates\./);
});

test("an upload that is refused outright, or accepted with no operation, or never finishes, is an error", async () => {
  await assert.rejects(publishToEdge(SETTINGS, { ...quick, fetch: store({ postStatus: { upload: 401 } }).fetch }), /Upload: the store answered 401/);
  await assert.rejects(publishToEdge(SETTINGS, { ...quick, fetch: store({ noLocation: true }).fetch }), /gave no operation id/);
  await assert.rejects(
    publishToEdge(SETTINGS, { ...quick, tries: 3, fetch: store({ uploadAnswers: [{ status: "InProgress" }, { status: "InProgress" }, { status: "InProgress" }] }).fetch }),
    /still in progress after 3 looks/,
  );
});

test("the workflow sends only when the helper moved, with the secrets from the repository and none written in it", () => {
  const workflow = readFileSync(new URL("../.github/workflows/publish-edge.yml", import.meta.url), "utf8");
  assert.match(workflow, /tags: \["v\*"\]/);
  assert.match(workflow, /EDGE_CLIENT_ID: \$\{\{ secrets\.EDGE_CLIENT_ID \}\}/);
  assert.match(workflow, /EDGE_API_KEY: \$\{\{ secrets\.EDGE_API_KEY \}\}/);
  assert.match(workflow, /steps\.moved\.outputs\.send == 'true'/);
  assert.doesNotMatch(workflow, /EDGE_API_KEY: [^$\s]/, "a key is written into the workflow");
});

test("the certification notes fit the 2,000 characters Edge allows, with the release line on top", () => {
  const notes = readFileSync(new URL("../tools/extension/certification-notes.txt", import.meta.url), "utf8").trim();
  assert.ok(notes.length + "Version 10.10.10. Release title which can be long enough to matter.\n\n".length < 2000, `${notes.length} characters`);
});
