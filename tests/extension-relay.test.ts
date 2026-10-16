import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../tools/extension/relay.js", import.meta.url), "utf8");
const PROTOCOL = "betterhuskyct/background@1";
const settle = () => new Promise(resolve => setImmediate(resolve));
function load(origin = "https://betterhuskyct.vercel.app") {
  const handlers = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const runtimeListeners: Array<(value: unknown) => void> = [];
  const sent: Array<Record<string, unknown>> = [], posted: Array<Record<string, unknown>> = [];
  const responses = new Map<string, unknown>();
  const window = {
    location: { origin },
    addEventListener: (kind: string, handler: (event: Record<string, unknown>) => void) => { handlers.set(kind, [...handlers.get(kind) ?? [], handler]); },
    postMessage: (message: Record<string, unknown>, target: string) => { assert.equal(target, origin); posted.push(message); },
  };
  const chrome = { runtime: {
    sendMessage: async (message: Record<string, unknown>) => { sent.push(message); return responses.get(String(message.kind)) ?? { ok: true, snapshot: null }; },
    onMessage: { addListener: (handler: (value: unknown) => void) => runtimeListeners.push(handler) },
  } };
  vm.runInNewContext(source, { window, chrome, document: { visibilityState: "visible", addEventListener() {} } });
  return { sent, posted, responses,
    page: (data: unknown, from = origin, currentWindow = true) => handlers.get("message")?.forEach(handler => handler({ source: currentWindow ? window : {}, origin: from, data })),
    broadcast: (message: unknown) => runtimeListeners.forEach(handler => handler(message)),
  };
}

test("legacy GM writes use the trusted worker and broadcasts preserve the existing page protocol", async () => {
  const relay = load("https://lms.uconn.edu");
  relay.page({ protocol: "betterhuskyct/ext@1", from: "page", kind: "set", key: "basket", value: { count: 1 } });
  await settle();
  const write = relay.sent.find(message => message.kind === "gm-write")!;
  assert.equal(write.key, "gm:basket");
  assert.equal(write.target, "worker");
  assert.equal(relay.sent.some(message => message.kind === "claim"), false);
  relay.broadcast({ protocol: PROTOCOL, target: "relay", kind: "gm-changed", key: "basket", value: 2 });
  assert.equal(relay.posted[0].protocol, "betterhuskyct/ext@1");
  assert.equal(relay.posted[0].key, "basket");
  assert.equal(relay.posted[0].value, 2);
});

test("messages from another origin or frame do not reach GM storage or background controls", async () => {
  const relay = load();
  await settle();
  const count = relay.sent.length;
  const write = { protocol: "betterhuskyct/ext@1", from: "page", kind: "set", key: "basket", value: 1 };
  relay.page(write, "https://attacker.example");
  relay.page(write, "https://betterhuskyct.vercel.app", false);
  relay.page({ protocol: PROTOCOL, target: "relay", kind: "run-now", requestId: "one" }, "https://attacker.example");
  await settle();
  assert.equal(relay.sent.length, count);
});

test("only the exact offered lease and revision can be acknowledged", async () => {
  const relay = load();
  await settle();
  relay.responses.set("claim", { ok: true, leaseId: "lease-one", snapshot: { revision: "revision-one" }, changes: { version: 1, entries: [], baselines: [] } });
  relay.page({ protocol: PROTOCOL, target: "relay", kind: "ready" });
  await settle();
  assert.equal(relay.posted.find(message => message.kind === "offer")?.leaseId, "lease-one");
  relay.page({ protocol: PROTOCOL, target: "relay", kind: "ack", leaseId: "old-lease", revision: "revision-one" });
  relay.page({ protocol: PROTOCOL, target: "relay", kind: "ack", leaseId: "lease-one", revision: "old-revision" });
  assert.equal(relay.sent.filter(message => message.kind === "ack").length, 0);
  relay.page({ protocol: PROTOCOL, target: "relay", kind: "ack", leaseId: "lease-one", revision: "revision-one" });
  await settle();
  assert.equal(relay.sent.filter(message => message.kind === "ack").length, 1);
});

test("only the official app origin gets cached offers or forwards settings", async () => {
  const relay = load("https://lms.uconn.edu");
  relay.page({ protocol: PROTOCOL, target: "relay", kind: "ready" });
  relay.page({ protocol: PROTOCOL, target: "relay", kind: "settings", requestId: "one", settings: { enabled: true } });
  await settle();
  assert.equal(relay.sent.some(message => ["claim", "settings"].includes(String(message.kind))), false);
  assert.deepEqual(relay.posted, []);
});

test("completion availability is retried when it arrives during an older in-flight claim", async () => {
  const relay = load();
  await settle();
  let release!: (value: unknown) => void;
  relay.responses.set("claim", new Promise(resolve => { release = resolve; }));
  relay.page({ protocol: PROTOCOL, target: "relay", kind: "ready" });
  relay.broadcast({ protocol: PROTOCOL, target: "relay", kind: "available" });
  relay.responses.set("claim", { ok: true, leaseId: "new-lease", snapshot: { revision: "new-revision" }, changes: { version: 1, entries: [], baselines: [] } });
  release({ ok: true, snapshot: null });
  await settle();
  assert.equal(relay.posted.find(message => message.kind === "offer")?.leaseId, "new-lease");
});
