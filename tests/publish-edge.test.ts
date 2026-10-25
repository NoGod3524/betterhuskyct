import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { operationId, publishToEdge, type Operation, type Settings } from "../scripts/publish-edge.ts";
import { githubStateStore, validateJournal, type Evidence, type Journal, type Phase, type Release, type StateStore } from "../scripts/edge-release-state.ts";

const TIME = Date.parse("2026-10-25T20:00:00Z");
const SETTINGS: Settings = {
  productId: "test-product", clientId: "test-client", apiKey: "test-secret",
  zip: new Uint8Array([80, 75, 3, 4]), version: "2.2.1", sourceSha: "a".repeat(40),
  runUrl: "https://github.com/example/repo/actions/runs/1", notes: "Version 2.2.1.", mode: "publish",
};
const HASH = createHash("sha256").update(SETTINGS.zip).digest("hex");
function record(phase: Phase = "ready"): Release {
  return { version: SETTINGS.version, sourceSha: SETTINGS.sourceSha, zipSha256: HASH, phase,
    updatedAt: new Date(TIME).toISOString(), clearedAt: new Date(TIME).toISOString(), runUrl: SETTINGS.runUrl,
    ...(phase === "upload-pending" && { uploadOperationId: "op-upload" }),
    ...(phase === "submit-pending" && { publishOperationId: "op-publish" }),
  };
}
function memory(release?: Release) {
  let revision = 0;
  let journal: Journal = { schema: 1, productId: SETTINGS.productId, releases: release ? { [release.version]: release } : {}, ...(release && release.phase !== "published" && { activeVersion: release.version }) };
  const history: Journal[] = [];
  const store: StateStore = {
    async load() { return { journal: structuredClone(journal), sha: String(revision) }; },
    async save(snapshot, next) {
      if (snapshot.sha !== String(revision)) throw new Error("CAS conflict");
      validateJournal(next, SETTINGS.productId);
      journal = structuredClone(next); history.push(journal); revision++;
      return { journal: structuredClone(journal), sha: String(revision) };
    },
  };
  return { store, history, current: () => structuredClone(journal) };
}
type Reply = Operation | Response | Error;
function server(options: { upload?: Reply[]; submit?: Reply[]; post?: Response | Error; beforePost?: () => void } = {}) {
  const calls: { method: string; url: string; headers: Headers }[] = [];
  const upload = [...(options.upload ?? [{ status: "Succeeded" } as Operation])];
  const submit = [...(options.submit ?? [{ status: "Succeeded", message: "Successfully created submission with ID 12345" } as Operation])];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET";
    calls.push({ method, url, headers: new Headers(init?.headers) });
    if (method === "POST") {
      options.beforePost?.();
      if (options.post instanceof Error) throw options.post;
      return options.post ?? new Response(null, { status: 202, headers: { Location: url.endsWith("/draft/package") ? "op-upload" : "op-publish" } });
    }
    const reply = (url.includes("/draft/package/") ? upload : submit).shift();
    if (reply instanceof Error) throw reply;
    if (reply instanceof Response) return reply;
    assert.ok(reply, "unexpected GET");
    return new Response(JSON.stringify(reply), { status: reply.status === "InProgress" ? 202 : 200 });
  };
  return { fetch: fetcher as typeof fetch, calls, posts: () => calls.filter(x => x.method === "POST") };
}
function deps(store: StateStore, fetch: typeof globalThis.fetch) {
  return { store, fetch, now: () => TIME, every: 0, tries: 4, wait: async () => {}, log: () => {}, random: () => 0.5 };
}
const evidence = (state: Evidence["state"], version = SETTINGS.version): Evidence => ({ state, version, observedAt: new Date(TIME).toISOString(), reference: "https://partner.microsoft.com/dashboard/microsoftedge/overview", ...(state === "in-review" && { submissionId: "12345" }) });

test("a fresh product has no permission to upload, including explicit manual publish", async () => {
  const m = memory(), s = server();
  assert.equal((await publishToEdge(SETTINGS, deps(m.store, s.fetch))).phase, "unreconciled");
  assert.equal(s.calls.length, 0);
});

test("intents and operation receipts are durable before subsequent remote actions", async () => {
  const m = memory(record());
  const seen: Phase[] = [];
  const s = server({ beforePost: () => seen.push(m.current().releases[SETTINGS.version].phase), upload: [{ status: "InProgress" }, { status: "Succeeded" }] });
  const outcome = await publishToEdge(SETTINGS, deps(m.store, s.fetch));
  assert.equal(outcome.phase, "submitted"); assert.equal(outcome.submissionId, "12345");
  assert.deepEqual(seen, ["upload-intent", "submit-intent"]);
  assert.deepEqual(m.history.map(x => x.releases[SETTINGS.version].phase), ["upload-intent", "upload-pending", "uploaded", "submit-intent", "submit-pending", "submitted"]);
  assert.equal(s.calls[0].headers.get("authorization"), "ApiKey test-secret");
  assert.equal(s.posts().length, 2);
  assert.equal((await publishToEdge(SETTINGS, deps(m.store, s.fetch))).phase, "submitted");
  assert.equal(s.posts().length, 2, "a repeat run submitted twice");
});

test("submitted and published records never POST; a different active version blocks the product", async () => {
  for (const phase of ["submitted", "published"] as const) {
    const m = memory(record(phase)), s = server();
    assert.equal((await publishToEdge(SETTINGS, deps(m.store, s.fetch))).phase, phase);
    assert.equal(s.calls.length, 0);
  }
  const m = memory({ ...record("submitted"), version: "2.2.0" }), s = server();
  assert.equal((await publishToEdge(SETTINGS, deps(m.store, s.fetch))).errorCode, "ActiveRelease");
  assert.equal(s.calls.length, 0);
});

test("same version with different bytes or source is refused before network access", async () => {
  for (const patch of [{ zip: new Uint8Array([1]) }, { sourceSha: "b".repeat(40) }]) {
    const m = memory(record()), s = server();
    await assert.rejects(publishToEdge({ ...SETTINGS, ...patch }, deps(m.store, s.fetch)), /identity conflict/);
    assert.equal(s.calls.length, 0);
  }
});

test("failed intent persistence prevents all Microsoft writes", async () => {
  const m = memory(record()), s = server();
  const store = { ...m.store, save: async () => { throw new Error("disk unavailable"); } };
  await assert.rejects(publishToEdge(SETTINGS, deps(store, s.fetch)), /disk unavailable/);
  assert.equal(s.calls.length, 0);
});

test("losing the operation receipt leaves durable intent and cannot repeat POST", async () => {
  const m = memory(record()), s = server(); let saves = 0;
  const store: StateStore = { ...m.store, save: async (snap, journal) => {
    if (++saves === 2) throw new Error("receipt unavailable");
    return m.store.save(snap, journal);
  } };
  await assert.rejects(publishToEdge(SETTINGS, deps(store, s.fetch)), /receipt unavailable/);
  assert.equal(m.current().releases[SETTINGS.version].phase, "upload-intent");
  assert.equal((await publishToEdge(SETTINGS, deps(m.store, s.fetch))).phase, "unknown");
  assert.equal(s.posts().length, 1);
});

test("crashes before the successful submission receipt/tag is recorded resume the same GET", async () => {
  const m = memory(record("submit-pending")), s = server();
  const outcome = await publishToEdge(SETTINGS, deps(m.store, s.fetch));
  assert.equal(outcome.phase, "submitted");
  assert.equal(s.posts().length, 0);
  assert.ok(s.calls[0].url.endsWith("/operations/op-publish"));
});

test("upload pending resumes GET and status mode never follows it with a submission", async () => {
  const m = memory(record("upload-pending")), s = server();
  assert.equal((await publishToEdge({ ...SETTINGS, mode: "status" }, deps(m.store, s.fetch))).phase, "uploaded");
  assert.equal(s.posts().length, 0);
  assert.ok(s.calls[0].url.endsWith("/draft/package/operations/op-upload"));
  await publishToEdge(SETTINGS, deps(m.store, s.fetch));
  assert.equal(s.posts().length, 1, "uploaded package was uploaded again");
});

test("status is the default; a ready version cannot be sent accidentally", async () => {
  const m = memory(record()), s = server();
  assert.equal((await publishToEdge({ ...SETTINGS, mode: undefined }, deps(m.store, s.fetch))).phase, "ready");
  assert.equal(s.calls.length, 0);
});

test("InProgressSubmission blocks without claiming submission or publication", async () => {
  const m = memory(record()), s = server({ submit: [{ status: "Failed", errorCode: "InProgressSubmission" }] });
  const outcome = await publishToEdge(SETTINGS, deps(m.store, s.fetch));
  assert.equal(outcome.phase, "blocked"); assert.equal(outcome.errorCode, "InProgressSubmission");
  assert.equal(outcome.submissionId, undefined);
  await publishToEdge(SETTINGS, deps(m.store, s.fetch));
  assert.equal(s.posts().length, 2);
});

test("invalid upload never submits; validation and no-updates failures never count as success", async () => {
  const m = memory(record()), s = server({ upload: [{ status: "Failed", errorCode: "InvalidVersion" }] });
  assert.equal((await publishToEdge(SETTINGS, deps(m.store, s.fetch))).phase, "failed");
  assert.equal(s.posts().length, 1);
  for (const code of ["NoModulesUpdated", "SubmissionValidationError", "ModuleStateUnPublishable"]) {
    const m = memory(record()), s = server({ submit: [{ status: "Failed", errorCode: code }] });
    assert.equal((await publishToEdge(SETTINGS, deps(m.store, s.fetch))).errorCode, code);
    assert.equal(m.current().releases[SETTINGS.version].phase, "failed");
  }
});

test("unknown POST outcomes, missing Location and server failures never repeat a write", async () => {
  for (const post of [new Error("test-secret"), new Response(null, { status: 202 }), new Response("test-secret", { status: 500 })]) {
    const m = memory(record()), s = server({ post });
    assert.equal((await publishToEdge(SETTINGS, deps(m.store, s.fetch))).phase, "unknown");
    await publishToEdge(SETTINGS, deps(m.store, s.fetch));
    assert.equal(s.posts().length, 1);
  }
});

test("pending timeouts keep the operation for the next run instead of repeating POST", async () => {
  const m = memory(record("submit-pending")), s = server({ submit: Array.from({ length: 4 }, () => ({ status: "InProgress" })) });
  assert.equal((await publishToEdge(SETTINGS, deps(m.store, s.fetch))).phase, "submit-pending");
  assert.equal(s.posts().length, 0);
  const resumed = server();
  assert.equal((await publishToEdge(SETTINGS, deps(m.store, resumed.fetch))).phase, "submitted");
  assert.equal(resumed.posts().length, 0);
});

test("GET backoff honors Retry-After and remaining budget without a second POST", async () => {
  const m = memory(record("submit-pending")); let clock = TIME;
  const waits: number[] = [];
  const s = server({ submit: [new Response(null, { status: 429, headers: { "retry-after": "2" } }), new Response(null, { status: 500 }), { status: "Succeeded" }] });
  const d = { ...deps(m.store, s.fetch), every: 1000, now: () => clock, wait: async (ms: number) => { waits.push(ms); clock += ms; } };
  assert.equal((await publishToEdge(SETTINGS, d)).phase, "submitted");
  assert.deepEqual(waits, [2000, 2000]); assert.equal(s.posts().length, 0);
  const m2 = memory(record("submit-pending")), s2 = server({ submit: [new Response(null, { status: 429, headers: { "retry-after": "3600" } })] });
  assert.equal((await publishToEdge(SETTINGS, { ...d, store: m2.store, fetch: s2.fetch })).phase, "submit-pending");
  assert.equal(s2.calls.length, 1);
});

test("unexpected/malformed GET and missing operations block future writes", async () => {
  for (const reply of [new Response(null, { status: 404 }), new Response("bad json"), new Response(JSON.stringify({ status: "Surprise", message: "test-secret" }))]) {
    const m = memory(record("submit-pending")), s = server({ submit: [reply] });
    assert.equal((await publishToEdge(SETTINGS, deps(m.store, s.fetch))).phase, "unknown");
    assert.equal(s.posts().length, 0);
  }
});

test("an unknown GET outcome can recover only its saved operation through status", async () => {
  const m = memory({ ...record("unknown"), publishOperationId: "saved-operation" }), s = server();
  assert.equal((await publishToEdge(SETTINGS, deps(m.store, s.fetch))).phase, "unknown");
  assert.equal(s.calls.length, 0);
  assert.equal((await publishToEdge({ ...SETTINGS, mode: "status" }, deps(m.store, s.fetch))).phase, "submitted");
  assert.ok(s.calls[0].url.endsWith("/operations/saved-operation"));
  assert.equal(s.posts().length, 0);
});

test("a stale clearance blocks upload and an expired clearance blocks submission after upload", async () => {
  const m = memory({ ...record(), clearedAt: new Date(TIME - 31 * 60_000).toISOString() }), s = server();
  assert.equal((await publishToEdge(SETTINGS, deps(m.store, s.fetch))).errorCode, "ClearanceExpired");
  assert.equal(s.posts().length, 0);
  const m2 = memory(record()); let clock = TIME;
  const s2 = server({ upload: [{ status: "InProgress" }, { status: "Succeeded" }] });
  assert.equal((await publishToEdge(SETTINGS, { ...deps(m2.store, s2.fetch), now: () => clock, wait: async () => { clock += 31 * 60_000; }, budgetMs: 60 * 60_000 })).errorCode, "ClearanceExpired");
  assert.equal(s2.posts().length, 1);
});

test("reconciliation requires fresh evidence, makes no Microsoft requests, and distinguishes versions", async () => {
  for (const state of ["clear", "in-review", "published"] as const) {
    const m = memory(), s = server();
    const outcome = await publishToEdge({ ...SETTINGS, mode: "reconcile", evidence: evidence(state) }, deps(m.store, s.fetch));
    assert.equal(outcome.phase, { clear: "ready", "in-review": "submitted", published: "published" }[state]);
    assert.equal(s.calls.length, 0);
  }
  const m = memory(), s = server();
  const blocked = await publishToEdge({ ...SETTINGS, mode: "reconcile", evidence: evidence("in-review", "2.2.0") }, deps(m.store, s.fetch));
  assert.equal(blocked.phase, "blocked");
  assert.equal(blocked.submissionId, undefined, "older version's submission ID was attributed to the target");
  await publishToEdge(SETTINGS, deps(m.store, s.fetch)); assert.equal(s.calls.length, 0);
  await assert.rejects(publishToEdge({ ...SETTINGS, mode: "reconcile", evidence: { ...evidence("clear"), observedAt: new Date(TIME - 31 * 60_000).toISOString() } }, deps(m.store, s.fetch)), /fresh Partner Center/);
});

test("a submitted operation cannot be reset by a manual publish; publication needs external evidence", async () => {
  const m = memory(record("submitted")), s = server();
  assert.equal((await publishToEdge(SETTINGS, deps(m.store, s.fetch))).phase, "submitted");
  assert.equal(s.calls.length, 0);
  assert.equal((await publishToEdge({ ...SETTINGS, mode: "reconcile", evidence: evidence("published") }, deps(m.store, s.fetch))).phase, "published");
  await assert.rejects(publishToEdge({ ...SETTINGS, mode: "reconcile", evidence: evidence("clear") }, deps(m.store, s.fetch)), /cannot be reset/);
});

test("reconciliation cannot discard a known operation that is still pending", async () => {
  for (const phase of ["upload-pending", "submit-pending"] as const) {
    const m = memory(record(phase)), s = server();
    await assert.rejects(publishToEdge({ ...SETTINGS, mode: "reconcile", evidence: evidence("clear") }, deps(m.store, s.fetch)), /Resume the known operation/);
    assert.equal(s.calls.length, 0);
    assert.equal(m.current().releases[SETTINGS.version].phase, phase);
  }
});

test("simultaneous writers cannot both acquire the product intent", async () => {
  const m = memory(record()), s = server();
  const results = await Promise.allSettled([publishToEdge(SETTINGS, deps(m.store, s.fetch)), publishToEdge(SETTINGS, deps(m.store, s.fetch))]);
  assert.equal(results.filter(x => x.status === "rejected").length, 1);
  assert.equal(s.posts().length, 2, "more than one upload/submission pair occurred");
});

test("output never echoes remote messages or credentials", async () => {
  const m = memory(record()), s = server({ submit: [{ status: "Failed", errorCode: "SubmissionValidationError", message: "test-secret" }] });
  const lines: string[] = [];
  const outcome = await publishToEdge(SETTINGS, { ...deps(m.store, s.fetch), log: line => lines.push(line) });
  assert.ok(!JSON.stringify([outcome, lines, m.current()]).includes("test-secret"));
  const m2 = memory(record()), s2 = server({ submit: [{ status: "Failed", errorCode: "test-secret", message: "test-secret" }] });
  assert.equal((await publishToEdge(SETTINGS, deps(m2.store, s2.fetch))).errorCode, "OperationFailed");
});

test("operation locations cannot send authenticated requests to another origin or product", () => {
  const endpoint = "/v1/products/test-product/submissions";
  assert.equal(operationId("op-1", endpoint), "op-1");
  assert.equal(operationId(`https://api.addons.microsoftedge.microsoft.com${endpoint}/operations/op-1`, endpoint), "op-1");
  for (const location of [null, "https://evil.example/operations/op-1", `${endpoint}/operations/op-1?key=x`, "/v1/products/other/submissions/operations/op-1"]) assert.throws(() => operationId(location, endpoint));
});

test("GitHub journal uses file SHA compare-and-swap; conflicts are not retried", async () => {
  const j: Journal = { schema: 1, productId: SETTINGS.productId, releases: { [SETTINGS.version]: record() }, activeVersion: SETTINGS.version };
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return init?.method === "PUT" ? new Response(null, { status: 409 }) : new Response(JSON.stringify({ sha: "c".repeat(40), encoding: "base64", content: Buffer.from(JSON.stringify(j)).toString("base64") }));
  };
  const store = githubStateStore({ repository: "example/repo", token: "test-token", productId: SETTINGS.productId, seedSha: SETTINGS.sourceSha, fetch: fetcher as typeof fetch });
  const snap = await store.load();
  await assert.rejects(store.save(snap, j), /HTTP 409/);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(String(calls[1].init?.body)).sha, "c".repeat(40));
  assert.ok(!String(calls[1].init?.body).includes("test-token"));
});

test("first journal write initializes its isolated branch and persists a receipt", async () => {
  const calls: { url: string; method: string; body: string }[] = [];
  const answers = [new Response(null, { status: 404 }), new Response(null, { status: 404 }), new Response(null, { status: 201 }), new Response(JSON.stringify({ content: { sha: "d".repeat(40) } }), { status: 201 })];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
    const response = answers.shift(); assert.ok(response); return response;
  };
  const store = githubStateStore({ repository: "example/repo", token: "test-token", productId: SETTINGS.productId, seedSha: SETTINGS.sourceSha, fetch: fetcher as typeof fetch });
  const snapshot = await store.load();
  const journal: Journal = { ...snapshot.journal, releases: { [SETTINGS.version]: record() }, activeVersion: SETTINGS.version };
  assert.equal((await store.save(snapshot, journal)).sha, "d".repeat(40));
  assert.deepEqual(calls.map(x => x.method), ["GET", "GET", "POST", "PUT"]);
  assert.equal(JSON.parse(calls[2].body).ref, "refs/heads/edge-release-state");
  const write = JSON.parse(calls[3].body);
  assert.equal(write.branch, "edge-release-state"); assert.equal(write.sha, undefined);
  assert.deepEqual(JSON.parse(Buffer.from(write.content, "base64").toString()), journal);
});

test("an uncertain journal write stops without making a Microsoft POST", async () => {
  const m = memory(record()); const s = server();
  const store: StateStore = { ...m.store, save: async () => { throw new Error("Edge journal request uncertain"); } };
  await assert.rejects(publishToEdge(SETTINGS, deps(store, s.fetch)), /uncertain/);
  assert.equal(s.posts().length, 0);
});

test("journal rejects malformed state and a missing record never creates ready permission", async () => {
  assert.throws(() => validateJournal({ schema: 1, productId: SETTINGS.productId, releases: { x: record() } }, SETTINGS.productId));
  const store = githubStateStore({ repository: "example/repo", token: "test-token", productId: SETTINGS.productId, seedSha: SETTINGS.sourceSha, fetch: (async () => new Response(null, { status: 404 })) as typeof fetch });
  assert.deepEqual((await store.load()).journal.releases, {});
});

test("workflow keeps manual and tag runs on the same fail-closed entry point", () => {
  const workflow = readFileSync(new URL("../.github/workflows/publish-edge.yml", import.meta.url), "utf8");
  assert.match(workflow, /default: status/);
  assert.match(workflow, /EDGE_MODE: \$\{\{ inputs.action \|\| 'status' \}\}/);
  assert.match(workflow, /group: publish-edge/);
  assert.doesNotMatch(workflow, /send=true|git tag|continue-on-error/);
  assert.match(workflow, /path: \.release/);
  assert.match(workflow, /node scripts\/publish-edge.ts \.release\/public/);
});
