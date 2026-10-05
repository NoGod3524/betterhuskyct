import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import { POST } from "../src/app/api/plan/extract/route.ts";

/**
 * The plan endpoint, called as Next calls it. Providers are a stubbed global
 * `fetch`; the limiter and cache outlive a test, so each test has its own
 * client address and its own course.
 */
const realFetch = globalThis.fetch;
const KEYS = ["ZAI_API_KEY", "GEMINI_API_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const;
const realKeys = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
let address = 0;
let course = 0;

beforeEach(() => {
  process.env.ZAI_API_KEY = "zai-secret-123";
  process.env.GEMINI_API_KEY = "gemini-secret-456";
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

function call(body: unknown, ip = `203.0.113.${++address}`) {
  return POST(
    new Request("http://localhost/api/plan/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-real-ip": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const ITEMS = '{"items":[{"title":"Midterm 1","date":"2026-10-14","time":null,"kind":"exam","evidence":"Midterm 1: Wednesday, October 14","source":null}]}';

function stubUpstream(answer: () => Response) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return answer();
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
