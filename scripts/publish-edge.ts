/**
 * Sends the extension to Microsoft Edge Add-ons: uploads the package over the draft, then submits
 * the draft for review. It is what the "Publish the extension to Edge" workflow runs, and it can be
 * run by hand:
 *
 *   EDGE_CLIENT_ID=… EDGE_API_KEY=… EDGE_PRODUCT_ID=… node scripts/publish-edge.ts [package.zip]
 *
 * The API is Microsoft's own (https://learn.microsoft.com/microsoft-edge/extensions/update/api/using-addons-api),
 * v1.1, which takes an API key and a client id from Partner Center's "Publish API" page. It only
 * updates an extension that is already in the store: the first submission, and the listing's text
 * and images, are Partner Center's. Review still happens after this, and takes up to seven days.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const API = "https://api.addons.microsoftedge.microsoft.com";

export type Settings = { productId: string; clientId: string; apiKey: string; zip: Uint8Array; notes: string };
export type Deps = {
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  /** How long between two looks at an operation, and how many looks before giving up. */
  every?: number;
  tries?: number;
  log?: (line: string) => void;
};
type Operation = { status?: string; message?: string | null; errorCode?: string | null; errors?: unknown };

/** A failed operation as one line a person can act on. */
function failure(step: string, operation: Operation): Error {
  const code = operation.errorCode ? ` [${operation.errorCode}]` : "";
  const errors = Array.isArray(operation.errors) && operation.errors.length ? ` ${JSON.stringify(operation.errors)}` : "";
  return new Error(`${step} failed${code}: ${operation.message ?? "no message"}${errors}`);
}

export async function publishToEdge(settings: Settings, deps: Deps = {}): Promise<{ upload: string; publish: string }> {
  const request = deps.fetch ?? fetch;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const every = deps.every ?? 5000;
  const tries = deps.tries ?? 60;
  const log = deps.log ?? ((line: string) => console.log(line));
  const base = `${API}/v1/products/${encodeURIComponent(settings.productId)}/submissions`;
  const auth = { Authorization: `ApiKey ${settings.apiKey}`, "X-ClientID": settings.clientId };

  /** The operation a POST started: its id is the Location header. */
  async function started(step: string, response: Response): Promise<string> {
    if (response.status !== 202) throw new Error(`${step}: the store answered ${response.status} ${(await response.text()).slice(0, 300)}`);
    const id = response.headers.get("location");
    if (!id) throw new Error(`${step}: the store accepted it but gave no operation id`);
    return id;
  }

  /** Looks at an operation until it is done. */
  async function finished(step: string, url: string): Promise<Operation> {
    for (let look = 0; look < tries; look++) {
      const response = await request(url, { headers: auth });
      // Microsoft documents 200 here, and the store answers 202 while an operation is still going: both carry the status.
      if (response.status !== 200 && response.status !== 202) throw new Error(`${step}: checking on it, the store answered ${response.status}`);
      const operation = (await response.json()) as Operation;
      if (operation.status === "Succeeded") return operation;
      if (operation.status === "Failed") throw failure(step, operation);
      if (look < tries - 1) await wait(every);
    }
    throw new Error(`${step}: still in progress after ${tries} looks`);
  }

  log("Uploading the package…");
  const uploading = await started(
    "Upload",
    await request(`${base}/draft/package`, { method: "POST", headers: { ...auth, "Content-Type": "application/zip" }, body: settings.zip as BodyInit }),
  );
  const upload = (await finished("Upload", `${base}/draft/package/operations/${uploading}`)).message ?? "uploaded";
  log(upload);

  log("Submitting it for review…");
  const publishing = await started(
    "Publish",
    await request(base, { method: "POST", headers: { ...auth, "Content-Type": "text/plain" }, body: settings.notes }),
  );
  const publish = (await finished("Publish", `${base}/operations/${publishing}`)).message ?? "submitted";
  log(publish);
  return { upload, publish };
}

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main() {
  const zipPath = process.argv[2] ?? "public/betterhuskyct-extension.zip";
  const helper = readFileSync("tools/huskyct-helper/huskyct-helper.user.js", "utf8");
  const version = /^\/\/ @version\s+(\S+)/m.exec(helper)?.[1];
  if (!version) throw new Error("no @version in the helper");

  // The notes the reviewers read: the same every time, with this release on top.
  const standing = readFileSync("tools/extension/certification-notes.txt", "utf8").trim();
  const release = process.env.RELEASE_NOTE ? ` ${process.env.RELEASE_NOTE}.` : "";
  const notes = `Version ${version}.${release}\n\n${standing}`;
  if (notes.length >= 2000) throw new Error(`the certification notes are ${notes.length} characters; the limit is 2,000`);

  await publishToEdge({
    productId: setting("EDGE_PRODUCT_ID"),
    clientId: setting("EDGE_CLIENT_ID"),
    apiKey: setting("EDGE_API_KEY"),
    zip: readFileSync(zipPath),
    notes,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
}
