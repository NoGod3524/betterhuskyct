import assert from "node:assert/strict";
import test from "node:test";

import { createSummaryCache } from "../src/lib/summary-cache.ts";

const ENV = {
  UPSTASH_REDIS_REST_URL: "https://redis.example.test",
  UPSTASH_REDIS_REST_TOKEN: "test-cache-token",
};
const PREFIX = "betterhuskyct:summary:v1:";
const TTL = 6 * 60 * 60 * 1_000;
const HASH = "a".repeat(64);
const SUMMARY = "- The exam moves to Tuesday.";

/** Shared storage, but no expiry: the cache must also reject stale remote values. */
function redis() {
  const values = new Map<string, string>();
  const calls: Array<{ url: string; init: RequestInit; command: Array<string | number> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.ok(init);
    const command = JSON.parse(String(init.body)) as Array<string | number>;
    calls.push({ url: String(input), init, command });
    if (command[0] === "SET") {
      values.set(String(command[1]), String(command[2]));
      return Response.json({ result: "OK" });
    }
    assert.equal(command[0], "GET");
    return Response.json({ result: values.get(String(command[1])) ?? null });
  };
  return { values, calls, fetchImpl };
}

test("missing, partial or invalid Redis configuration stays entirely local", async () => {
  let networkCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    networkCalls += 1;
    throw new Error("must not connect");
  };
  const configurations = [
    {},
    { UPSTASH_REDIS_REST_URL: ENV.UPSTASH_REDIS_REST_URL },
    { UPSTASH_REDIS_REST_TOKEN: ENV.UPSTASH_REDIS_REST_TOKEN },
    { ...ENV, UPSTASH_REDIS_REST_TOKEN: " " },
    ...["invalid", "http://redis.example.test", "https://user:password@redis.example.test", "https://redis.example.test?token=x", "https://redis.example.test#fragment"]
      .map((UPSTASH_REDIS_REST_URL) => ({ ...ENV, UPSTASH_REDIS_REST_URL })),
  ];
  for (const env of configurations) {
    const cache = createSummaryCache({ env, fetchImpl, now: () => 10 });
    assert.equal(await cache.get("missing", true), null);
    await cache.set(HASH, SUMMARY, "glm");
    assert.deepEqual(await cache.get(HASH, true), { summary: SUMMARY, provider: "glm", at: 10 });
  }
  assert.equal(networkCalls, 0);
});

test("independent instances share summaries through authenticated bounded REST commands", async () => {
  const remote = redis();
  const options = { env: ENV, fetchImpl: remote.fetchImpl, now: () => 100 };
  const writer = createSummaryCache(options);
  const reader = createSummaryCache(options);

  await writer.set(HASH, SUMMARY, "glm");
  const entry = { summary: SUMMARY, provider: "glm", at: 100 };
  assert.deepEqual(await reader.get(HASH, true), entry);
  assert.deepEqual(await reader.get(HASH, true), entry);
  assert.deepEqual(remote.calls.map((call) => call.command), [
    ["SET", PREFIX + HASH, JSON.stringify(entry), "EX", 21600],
    ["GET", PREFIX + HASH],
  ], "the second read should use the instance's local cache");
  for (const { url, init } of remote.calls) {
    assert.equal(url, "https://redis.example.test/");
    assert.equal(init.method, "POST");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Authorization"), "Bearer test-cache-token");
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test("local hits expire six hours after generation even when read just before expiry", async () => {
  let time = 0;
  const cache = createSummaryCache({ env: {}, now: () => time });
  await cache.set(HASH, SUMMARY, "glm");
  time = TTL - 1;
  assert.equal((await cache.get(HASH, true))?.at, 0);
  time = TTL;
  assert.equal(await cache.get(HASH, true), null);
});

test("the local cache keeps 500 entries and evicts the least recently read", async () => {
  const cache = createSummaryCache({ env: {}, now: () => 0 });
  for (let index = 0; index < 500; index += 1) await cache.set(String(index), SUMMARY, "glm");
  assert.ok(await cache.get("0", true));
  await cache.set("500", SUMMARY, "glm");
  assert.equal(await cache.get("1", true), null);
  for (const key of ["0", "2", "499", "500"]) assert.ok(await cache.get(key, true), key);
});

test("promoting a remote hit preserves its original age and cannot extend its life", async () => {
  const remote = redis();
  remote.values.set(PREFIX + HASH, JSON.stringify({ summary: SUMMARY, provider: "glm", at: 0 }));
  let time = TTL - 2;
  const cache = createSummaryCache({ env: ENV, fetchImpl: remote.fetchImpl, now: () => time });

  assert.equal((await cache.get(HASH, true))?.at, 0);
  time += 1;
  assert.equal((await cache.get(HASH, true))?.at, 0);
  assert.equal(remote.calls.length, 1, "a fresh promoted entry should be local");
  time += 1;
  assert.equal(await cache.get(HASH, true), null, "the stale remote copy must not revive the local entry");
  assert.equal(remote.calls.length, 2);
});

test("malformed, expired, future and unknown-provider remote entries are misses", async () => {
  const entry = { summary: SUMMARY, provider: "glm", at: TTL };
  const invalid = [
    "not JSON", "null", "{}", "[]",
    ...[
      { ...entry, summary: " " },
      { ...entry, summary: "x".repeat(16001) },
      { ...entry, provider: "unknown" },
      { ...entry, at: -1 },
      { ...entry, at: 0.5 },
      { ...entry, at: 0 },
      { ...entry, at: TTL + 1 },
    ].map((value) => JSON.stringify(value)),
  ];
  for (const value of invalid) {
    const cache = createSummaryCache({
      env: ENV,
      now: () => TTL,
      fetchImpl: async () => Response.json({ result: value }),
    });
    assert.equal(await cache.get(HASH, true), null, value.slice(0, 100));
  }
});

test("Gemini eligibility is checked for local, remote and promoted hits", async () => {
  const local = createSummaryCache({ env: {}, now: () => 10 });
  await local.set(HASH, SUMMARY, "gemini");
  assert.equal((await local.get(HASH, true))?.provider, "gemini");
  assert.equal(await local.get(HASH, false), null);

  const remote = redis();
  remote.values.set(PREFIX + HASH, JSON.stringify({ summary: SUMMARY, provider: "gemini", at: 10 }));
  const cache = createSummaryCache({ env: ENV, fetchImpl: remote.fetchImpl, now: () => 10 });
  assert.equal(await cache.get(HASH, false), null);
  assert.equal((await cache.get(HASH, true))?.provider, "gemini");
  assert.equal(await cache.get(HASH, false), null);
});

test("HTTP, network and malformed-response failures leave local writes usable and report no secrets", async () => {
  const reported: string[] = [];
  const failures = [
    async () => new Response("private upstream details", { status: 503 }),
    async () => { throw new Error("private upstream details"); },
    async () => Response.json({ error: "private upstream details" }),
    async () => new Response("not JSON"),
    async () => Response.json({}),
  ];
  for (const fail of failures) {
    let calls = 0;
    const cache = createSummaryCache({
      env: ENV,
      now: () => 10,
      fetchImpl: async () => { calls += 1; return fail(); },
      onError: (command) => reported.push(command),
    });
    assert.equal(await cache.get("missing", true), null);
    await cache.set(HASH, SUMMARY, "glm");
    assert.deepEqual(await cache.get(HASH, true), { summary: SUMMARY, provider: "glm", at: 10 });
    assert.equal(calls, 2, "the local hit should survive a failed SET without another request");
  }
  assert.deepEqual(reported, failures.flatMap(() => ["GET", "SET"]));
  const logs = JSON.stringify(reported);
  for (const secret of ["private upstream details", ENV.UPSTASH_REDIS_REST_URL, ENV.UPSTASH_REDIS_REST_TOKEN, SUMMARY]) {
    assert.ok(!logs.includes(secret));
  }
});

test("stalled GET and SET abort and fall back without losing the local summary", { timeout: 4000 }, async () => {
  const signals: AbortSignal[] = [];
  const cache = createSummaryCache({
    env: ENV,
    now: () => 10,
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal);
      signals.push(signal);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  // AbortSignal.timeout is unref'ed; keep the event loop alive while awaiting it.
  const keepAlive = setTimeout(() => {}, 3000);
  try {
    const [miss] = await Promise.all([cache.get("missing", true), cache.set(HASH, SUMMARY, "glm")]);
    assert.equal(miss, null);
    assert.equal(signals.length, 2);
    for (const signal of signals) {
      assert.ok(signal.aborted);
      assert.equal(signal.reason.name, "TimeoutError");
    }
    assert.equal((await cache.get(HASH, true))?.summary, SUMMARY);
  } finally {
    clearTimeout(keepAlive);
  }
});
