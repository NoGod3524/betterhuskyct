import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, mock, test } from "node:test";

import { POST } from "../src/app/api/announcements/summarize/route.ts";

/**
 * The summarise endpoint, called the way Next calls it: with a Request.
 *
 * Providers and Redis are replaced by a stubbed global `fetch`, which is what the
 * endpoint uses upstream. The rate limiter and the summary cache outlive a
 * single test, so every test uses its own client address and its own course.
 */
const realFetch = globalThis.fetch;
const KEYS = ["ZAI_API_KEY", "GEMINI_API_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const;
const realKeys = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
let address = 0;
let course = 0;
let serverLog: ReturnType<typeof mock.method>;

beforeEach(() => {
  process.env.ZAI_API_KEY = "zai-secret-123";
  process.env.GEMINI_API_KEY = "gemini-secret-456";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  serverLog = mock.method(console, "error", () => {});
  course += 1;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restoreAll();
  for (const key of KEYS) {
    if (realKeys[key] === undefined) delete process.env[key];
    else process.env[key] = realKeys[key];
  }
});

const SECRET_BODY = "Midterm 2 moves to Tuesday Oct 14, MSB 411.";

function payload() {
  return {
    courseLabel: `MATH ${1000 + course}`,
    locale: "en",
    announcements: [{ title: "Midterm 2 moved", body: SECRET_BODY, posted: "Posted Sep 24" }],
  };
}

function call(body: unknown, options: { ip?: string; country?: string } = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-real-ip": options.ip ?? `198.51.100.${++address}`,
  };
  if (options.country) headers["x-vercel-ip-country"] = options.country;
  return POST(
    new Request("http://localhost/api/announcements/summarize", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/** Replaces both providers; each answers from its list in turn, the last repeating. */
function stubUpstream(answers: { glm?: Array<() => Response>; gemini?: Array<() => Response> }) {
  const calls: Array<{ provider: "glm" | "gemini"; auth: string }> = [];
  const counts = { glm: 0, gemini: 0 };
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const provider = String(url).includes("z.ai") ? "glm" : "gemini";
    calls.push({ provider, auth: (init.headers as Record<string, string>).Authorization });
    const list = answers[provider] ?? [() => new Response("{}", { status: 500 })];
    return list[Math.min(counts[provider]++, list.length - 1)]();
  }) as typeof fetch;
  return calls;
}

const says = (content: string, finish_reason = "stop") => () =>
  Response.json({ choices: [{ message: { role: "assistant", content }, finish_reason }] });
const busy = () => new Response("{}", { status: 429 });

const REDIS_URL = "https://summary-test.upstash.io/";
const redisKey = (body: unknown) => `betterhuskyct:summary:v1:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`;

/** A separate Redis store, so a route can start with another instance's answer. */
function stubRedis(entries = new Map<string, string>()) {
  process.env.UPSTASH_REDIS_REST_URL = REDIS_URL;
  process.env.UPSTASH_REDIS_REST_TOKEN = "redis-secret-789";
  const upstream = globalThis.fetch;
  const calls: Array<Array<string | number>> = [];
  globalThis.fetch = (async (input, init) => {
    if (String(input) !== REDIS_URL) return upstream(input, init);
    const command = JSON.parse(String(init?.body)) as Array<string | number>;
    calls.push(command);
    const [operation, key, value] = command;
    if (operation === "GET") return Response.json({ result: entries.get(String(key)) ?? null });
    assert.equal(operation, "SET");
    entries.set(String(key), String(value));
    return Response.json({ result: "OK" });
  }) as typeof fetch;
  return { entries, calls };
}

test("with no key at all the endpoint says it is not set up, and calls nobody", async () => {
  delete process.env.ZAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const calls = stubUpstream({ glm: [says("- unused")] });

  const response = await call(payload());

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { problem: "not-configured" });
  assert.equal(calls.length, 0);
});

test("a malformed request is refused before anything is sent", async () => {
  const calls = stubUpstream({ glm: [says("- unused")] });
  const valid = payload();

  for (const body of [
    "{not json",
    { ...valid, announcements: [] },
    { ...valid, locale: "fr" },
    { ...valid, announcements: [{ title: "x".repeat(201), body: "", posted: null }] },
    { ...valid, announcements: Array.from({ length: 41 }, () => valid.announcements[0]) },
  ]) {
    const response = await call(body);
    assert.equal(response.status, 400, `accepted ${JSON.stringify(body).slice(0, 60)}`);
  }
  assert.equal(calls.length, 0);
});

test("GLM's summary comes back named as GLM's, and no key comes back with it", async () => {
  const calls = stubUpstream({ glm: [says("- Midterm 2 moves to Tue Oct 14.")] });

  const response = await call(payload());
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(text), { summary: "- Midterm 2 moves to Tue Oct 14.", provider: "glm" });
  assert.ok(!text.includes("secret"), "an API key reached the page");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(calls[0].auth, "Bearer zai-secret-123");
});

test("a busy GLM is covered by Gemini, and the page is told which wrote it", async () => {
  const calls = stubUpstream({ glm: [busy], gemini: [says("- From Gemini.")] });

  const response = await call(payload());

  assert.deepEqual(await response.json(), { summary: "- From Gemini.", provider: "gemini" });
  assert.deepEqual(calls.map((c) => c.provider), ["glm", "gemini"]);
});

test("a reader in the EEA is not passed to Gemini's free tier", async () => {
  const calls = stubUpstream({ glm: [busy], gemini: [says("- must not be used")] });

  const response = await call(payload(), { country: "DE" });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { problem: "busy" });
  assert.ok(calls.every((c) => c.provider === "glm"), "Gemini was called for a reader in Germany");
});

test("the same announcements are summarised once and shared, without counting against anyone", async () => {
  const calls = stubUpstream({ glm: [says("- Shared summary.")] });
  const body = payload();
  const ip = "203.0.113.50";

  const first = await call(body, { ip });
  assert.equal(first.status, 200);
  // Past the per-person limit of six: cached answers must not be rationed.
  for (let index = 0; index < 8; index += 1) {
    const again = await call(body, { ip });
    assert.equal(again.status, 200, "a cached answer was rate-limited");
    assert.deepEqual(await again.json(), { summary: "- Shared summary.", provider: "glm" });
  }
  // A classmate elsewhere gets it too.
  assert.equal((await call(body)).status, 200);
  assert.equal(calls.length, 1, "the model was asked more than once for the same announcements");
});

test("a cached Gemini summary is not handed to a reader Gemini's terms exclude", async () => {
  const calls = stubUpstream({ glm: [busy, says("- GLM for the German reader.")], gemini: [says("- From Gemini.")] });
  const body = payload();

  assert.equal((await (await call(body)).json()).provider, "gemini");
  const german = await (await call(body, { country: "DE" })).json();

  assert.deepEqual(german, { summary: "- GLM for the German reader.", provider: "glm" });
  assert.deepEqual(calls.map((c) => c.provider), ["glm", "gemini", "glm"]);
});

test("the provider's content filter is reported as refused", async () => {
  stubUpstream({ glm: [says("", "sensitive")], gemini: [says("", "content_filter")] });

  const response = await call(payload());

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { problem: "refused" });
});

test("failures are logged by provider and status only, never with announcements or keys", async () => {
  stubUpstream({
    glm: [() => new Response("upstream exploded", { status: 500 })],
    gemini: [() => new Response("also exploded", { status: 503 })],
  });

  const response = await call(payload());

  assert.equal(response.status, 502);
  const logged = serverLog.mock.calls.map((entry) => entry.arguments);
  assert.equal(logged.length, 2, "each provider's failure should be logged once");
  const everything = JSON.stringify(logged);
  assert.match(everything, /"provider":"glm".*"status":500/);
  assert.ok(!everything.includes(SECRET_BODY), "announcement text reached the server log");
  assert.ok(!everything.includes("secret"), "a key reached the server log");
});

test("one person asking for many different summaries is slowed down", async () => {
  stubUpstream({ glm: [says("- ok")] });
  const ip = "203.0.113.77";

  for (let index = 0; index < 6; index += 1) {
    course += 1;
    assert.equal((await call(payload(), { ip })).status, 200);
  }
  course += 1;
  const response = await call(payload(), { ip });

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { problem: "rate-limited" });
  assert.ok(response.headers.get("Retry-After"));
});

test("another instance's cached answer bypasses both the model and an exhausted caller's limit", async () => {
  const models = stubUpstream({ glm: [says("- Newly made.")] });
  const body = payload();
  const redis = stubRedis(new Map([
    [redisKey(body), JSON.stringify({ summary: "- Shared from another instance.", provider: "glm", at: Date.now() })],
  ]));
  const ip = "198.51.100.220";
  for (let i = 0; i < 6; i++) {
    const response = await call({ ...body, courseLabel: `${body.courseLabel} ${i}` }, { ip });
    assert.equal(response.status, 200);
  }
  const response = await call(body, { ip });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(text), { summary: "- Shared from another instance.", provider: "glm" });
  assert.equal(models.length, 6);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.ok(!text.includes("secret"));
  assert.ok(redis.calls.some(([operation, key]) => operation === "GET" && key === redisKey(body)));
});

test("language and changed announcements get their own shared cache keys", async () => {
  const models = stubUpstream({ glm: [says("- English answer."), says("- 中文总结。"), says("- Updated deadline.")] });
  const redis = stubRedis();
  const english = payload();
  const chinese = { ...english, locale: "zh-CN" };
  const updated = { ...english, announcements: [{ ...english.announcements[0], body: "Midterm moves to Thursday." }] };
  for (const body of [english, chinese, updated]) assert.equal((await call(body)).status, 200);
  assert.equal(models.length, 3);
  assert.equal(redis.entries.size, 3);
  for (const [key, value] of redis.entries) {
    assert.match(key, /^betterhuskyct:summary:v1:[a-f0-9]{64}$/);
    assert.ok(!key.includes(english.courseLabel));
    assert.ok(!value.includes(SECRET_BODY));
    assert.deepEqual(Object.keys(JSON.parse(value)).sort(), ["at", "provider", "summary"]);
  }
});

test("a remote Gemini answer cannot bypass region restrictions or a removed Gemini key", async () => {
  const models = stubUpstream({ glm: [says("- GLM instead.")] });
  const redis = stubRedis();
  for (const country of ["DE", "CH", "GB", "US"]) {
    const body = { ...payload(), courseLabel: `${payload().courseLabel} ${country}` };
    redis.entries.set(redisKey(body), JSON.stringify({ summary: "- Gemini must not be shown.", provider: "gemini", at: Date.now() }));
    if (country === "US") delete process.env.GEMINI_API_KEY;
    const response = await call(body, { country });
    assert.deepEqual(await response.json(), { summary: "- GLM instead.", provider: "glm" });
  }
  assert.deepEqual(models.map((entry) => entry.provider), ["glm", "glm", "glm", "glm"]);
});

test("failed Redis reads and writes still return the model answer, then reuse it locally", async () => {
  const models = stubUpstream({ glm: [says("- Kept locally.")] });
  stubRedis();
  const upstream = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    if (String(input) === REDIS_URL) throw new Error("redis-secret-789: cache payload must not be logged");
    return upstream(input, init);
  }) as typeof fetch;
  const body = payload();
  for (let i = 0; i < 2; i++) {
    const response = await call(body);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { summary: "- Kept locally.", provider: "glm" });
  }
  assert.equal(models.length, 1);
  assert.equal(serverLog.mock.calls.length, 2);
  const logs = JSON.stringify(serverLog.mock.calls.map((entry) => entry.arguments));
  assert.ok(!logs.includes("secret"));
  assert.ok(!logs.includes(REDIS_URL));
  assert.ok(!logs.includes(SECRET_BODY));
});
