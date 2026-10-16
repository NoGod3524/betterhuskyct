import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import { POST } from "../src/app/api/plan/extract/route.ts";

/**
 * The plan endpoint, called as Next calls it. Providers are a stubbed global
 * `fetch`; the limiter and cache outlive a test, so each test has its own
 * client address and its own course.
 */
const realFetch = globalThis.fetch;
const KEYS = ["ZAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const;
const realKeys = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
let address = 0;
let course = 0;

beforeEach(() => {
  process.env.ZAI_API_KEY = "zai-secret-123";
  process.env.GEMINI_API_KEY = "gemini-secret-456";
  delete process.env.GROQ_API_KEY;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  mock.method(console, "error", () => {});
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

function syllabus(overrides: Record<string, unknown> = {}) {
  return {
    kind: "syllabus",
    courseLabel: `MATH ${1000 + course}`,
    term: "Fall 2026",
    today: "2026-09-01",
    text: "Midterm 1: Wednesday, October 14.",
    announcements: [],
    ...overrides,
  };
}

function call(body: unknown, ip = `203.0.113.${++address}`, country: string | null = "US") {
  return POST(
    new Request("http://localhost/api/plan/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-real-ip": ip, ...(country === null ? {} : { "x-vercel-ip-country": country }) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const ITEMS = '{"items":[{"title":"Midterm 1","date":"2026-10-14","time":null,"kind":"exam","evidence":"Midterm 1: Wednesday, October 14","source":null}]}';

function stubUpstream(answer: (url: string) => Response) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return answer(String(url));
  }) as typeof fetch;
  return calls;
}

const says = (content: string) => () => Response.json({ choices: [{ message: { content }, finish_reason: "stop" }] });

test("a syllabus comes back as checked items, and the model was asked for JSON", async () => {
  const calls = stubUpstream(says(ITEMS));

  const response = await call(syllabus());

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.provider, "glm");
  assert.deepEqual(body.items, JSON.parse(ITEMS).items);
  assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
});

test("an explicit Gemini choice without a country is refused before sending the syllabus", async () => {
  const calls = stubUpstream(says(ITEMS));

  const response = await call(syllabus({ provider: "gemini" }), undefined, null);

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { problem: "region" });
  assert.equal(calls.length, 0);
});

test("automatic fallback without a country skips Gemini and still reaches Groq after GLM fails", async () => {
  process.env.GROQ_API_KEY = "groq-secret-789";
  const calls = stubUpstream((url) => url.includes("api.z.ai") ? new Response("{}", { status: 503 }) : says(ITEMS)());

  const response = await call(syllabus(), undefined, null);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).provider, "groq");
  assert.deepEqual(calls.map((entry) => new URL(entry.url).hostname), ["api.z.ai", "api.groq.com"]);
});

test("an explicit Gemini cache hit cannot bypass a missing country", async () => {
  const calls = stubUpstream(says(ITEMS));
  const body = syllabus({ provider: "gemini" });
  const first = await call(body);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).provider, "gemini");
  assert.equal((await call(body)).status, 200);
  assert.equal(calls.length, 1, "the allowed-country response was not cached");

  const unknown = await call(body, undefined, null);

  assert.equal(unknown.status, 403);
  assert.deepEqual(await unknown.json(), { problem: "region" });
  assert.equal(calls.length, 1, "a missing country caused another Gemini request");
});

test("automatic selection without a country skips a cached Gemini answer and asks GLM", async () => {
  delete process.env.ZAI_API_KEY;
  const calls = stubUpstream(says(ITEMS));
  const body = syllabus();
  const first = await call(body);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).provider, "gemini");
  assert.equal((await call(body)).status, 200);
  assert.equal(calls.length, 1, "the allowed-country response was not cached");
  process.env.ZAI_API_KEY = "zai-secret-123";

  const unknown = await call(body, undefined, null);

  assert.equal(unknown.status, 200);
  assert.equal((await unknown.json()).provider, "glm");
  assert.deepEqual(calls.map((entry) => new URL(entry.url).hostname), ["generativelanguage.googleapis.com", "api.z.ai"]);
});

test("explicit GLM and Groq choices still work without a country", async () => {
  process.env.GROQ_API_KEY = "groq-secret-789";
  const calls = stubUpstream(says(ITEMS));

  for (const provider of ["glm", "groq"] as const) {
    const response = await call(syllabus({ provider }), undefined, null);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).provider, provider);
  }
  assert.deepEqual(calls.map((entry) => new URL(entry.url).hostname), ["api.z.ai", "api.groq.com"]);
});

test("a request of the wrong shape is refused before anything is sent", async () => {
  const calls = stubUpstream(says(ITEMS));

  for (const body of [
    "{not json",
    syllabus({ today: "2026-02-30" }),
    syllabus({ text: "" }),
    syllabus({ text: "x".repeat(60_001) }),
    syllabus({ announcements: [{ title: "A", body: "B", posted: null }] }),
    syllabus({ kind: "announcements" }),
    syllabus({ kind: "minutes" }),
  ]) {
    const response = await call(body);
    assert.equal(response.status === 400 || response.status === 413, true, JSON.stringify(body).slice(0, 120));
  }
  assert.equal(calls.length, 0);
});

test("oversized and failed request streams return JSON without calling a provider", async () => {
  const calls = stubUpstream(says(ITEMS));
  for (const failure of ["oversized", "failed"] as const) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (failure === "failed") controller.error(new Error("private syllabus text"));
        else controller.enqueue(new Uint8Array(450_001));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(new Request("http://localhost/api/plan/extract", {
      method: "POST", body, duplex: "half",
    } as RequestInit));
    assert.equal(response.status, failure === "oversized" ? 413 : 400);
    assert.deepEqual(await response.json(), { problem: "invalid" });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    if (failure === "oversized") assert.equal(cancelled, true);
  }
  assert.equal(calls.length, 0);
});

test("a request body that never finishes returns a JSON timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = stubUpstream(says(ITEMS));
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const result = POST(new Request("http://localhost/api/plan/extract", {
    method: "POST", body, duplex: "half",
  } as RequestInit));
  t.mock.timers.tick(5_000);
  const response = await result;
  assert.equal(response.status, 408);
  assert.deepEqual(await response.json(), { problem: "invalid" });
  assert.equal(cancelled, true);
  assert.equal(calls.length, 0);
});

test("a full length Chinese syllabus still fits the byte limit", async () => {
  const calls = stubUpstream(says(ITEMS));
  const response = await call(syllabus({ text: "课".repeat(60_000) }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
});

test("the same syllabus read again, on another day, is answered from the cache", async () => {
  const calls = stubUpstream(says(ITEMS));

  await call(syllabus());
  const again = await call(syllabus({ today: "2026-09-02" }));

  assert.equal(again.status, 200);
  assert.deepEqual((await again.json()).items, JSON.parse(ITEMS).items);
  assert.equal(calls.length, 1, "the model was asked twice for the same syllabus");
});

test("a busy model is a 503 the page can wait out, and an answer that is not JSON a 502", async () => {
  stubUpstream(() => new Response("{}", { status: 429 }));
  const busy = await call(syllabus());
  assert.equal(busy.status, 503);
  assert.deepEqual(await busy.json(), { problem: "busy" });
  assert.ok(busy.headers.get("Retry-After"));

  course += 1;
  stubUpstream(says("Midterm 1 is on October 14."));
  const prose = await call(syllabus());
  assert.equal(prose.status, 502);
  assert.deepEqual(await prose.json(), { problem: "failed" });
});

test("with no key the endpoint says it is not set up", async () => {
  delete process.env.ZAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const response = await call(syllabus());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { problem: "not-configured" });
});

test("a syllabus comes back with its summary, which is cached with it, separately for each language", async () => {
  const calls = stubUpstream(says('{"summary":"- 成绩：考试 60%","items":[]}'));

  const first = await call(syllabus({ locale: "zh-CN" }));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).summary, "- 成绩：考试 60%");

  const cached = await call(syllabus({ locale: "zh-CN", today: "2026-09-02" }));
  assert.equal((await cached.json()).summary, "- 成绩：考试 60%");
  assert.equal(calls.length, 1, "the same syllabus in the same language was read twice");

  await call(syllabus({ locale: "en" }));
  assert.equal(calls.length, 2, "an English page was handed the Chinese summary");
});

test("announcements read on another day are asked again, since 'next Tuesday' moves with the day", async () => {
  const calls = stubUpstream(says('{"items":[]}'.replace("[]", '[{"title":"Quiz 4","date":"2026-09-08","time":null,"kind":"quiz","evidence":"Quiz 4 is next Tuesday","source":1}]')));
  const news = (today: string) => syllabus({ kind: "announcements", text: "", today, announcements: [{ title: "Quiz moved", body: "Quiz 4 is next Tuesday.", posted: null }] });

  await call(news("2026-09-01"));
  await call(news("2026-09-01"));
  await call(news("2026-09-03"));

  assert.equal(calls.length, 2, "the same day should come from the cache, another day should not");
});

test("nothing found is not cached, so the next try asks again", async () => {
  const calls = stubUpstream(says('{"items":[]}'));

  await call(syllabus());
  await call(syllabus());

  assert.equal(calls.length, 2);
});
