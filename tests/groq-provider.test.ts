import assert from "node:assert/strict";
import test from "node:test";

import { extractPlan } from "../src/lib/plan-models.ts";
import { estimateTokens, providersFromEnv, summarizeAnnouncements, type SummaryRequest } from "../src/lib/summary-models.ts";

/**
 * Groq as the third provider: after GLM and Gemini, never sent a request
 * bigger than its free tier takes, and asked for no more answer than fits.
 */
const ALL = providersFromEnv({ ZAI_API_KEY: "zai-key", GEMINI_API_KEY: "gemini-key", GROQ_API_KEY: "groq-key" });

const REQUEST: SummaryRequest = {
  courseLabel: "MATH 1070Q",
  locale: "en",
  announcements: [{ title: "Midterm 2 moved", body: "Midterm 2 moves to Tuesday Oct 14, MSB 411.", posted: "Posted Sep 24" }],
};

type Id = "glm" | "gemini" | "groq";

function upstream(answers: Partial<Record<Id, () => Response>>) {
  const calls: Array<{ id: Id; body: Record<string, unknown>; auth: string }> = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const id: Id = url.includes("z.ai") ? "glm" : url.includes("groq.com") ? "groq" : "gemini";
    calls.push({ id, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization });
    return (answers[id] ?? (() => new Response("{}", { status: 429 })))();
  };
  return { calls, fetchImpl };
}

const says = (content: string) => () => Response.json({ choices: [{ message: { content }, finish_reason: "stop" }] });
const busy = () => new Response("{}", { status: 429 });

test("Groq comes last, on its OpenAI-style endpoint, with gpt-oss's reasoning kept short and not sent back", () => {
  assert.deepEqual(
    ALL.map((provider) => provider.id),
    ["glm", "gemini", "groq"],
  );
  const groq = ALL[2];
  assert.equal(groq.endpoint, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(groq.model, "openai/gpt-oss-120b");
  assert.deepEqual(groq.extra, { reasoning_effort: "low", include_reasoning: false });
  assert.equal(groq.maxRequestTokens, 8_000);
  assert.equal(groq.servesCountry("DE"), true);

  const other = providersFromEnv({ GROQ_API_KEY: "k", GROQ_MODEL: "qwen/qwen3.8-27b" })[0];
  assert.equal(other.model, "qwen/qwen3.8-27b");
  assert.deepEqual(other.extra, {}, "gpt-oss's settings were sent to a model that does not take them");
});

test("when GLM and Gemini are both busy, Groq writes the summary with its own key", async () => {
  const { calls, fetchImpl } = upstream({ glm: busy, gemini: busy, groq: says("- Midterm 2 moves to Tuesday Oct 14, MSB 411.") });

  const result = await summarizeAnnouncements(REQUEST, { providers: ALL, fetchImpl, wait: async () => {} });

  assert.equal(result.provider, "groq");
  assert.deepEqual(calls.map((call) => call.id), ["glm", "gemini", "groq"]);
  assert.equal(calls[2].auth, "Bearer groq-key");
});

test("Groq is asked for no more answer than fits beside the question in 8,000 tokens", async () => {
  const groqOnly = providersFromEnv({ GROQ_API_KEY: "groq-key" });
  const { calls, fetchImpl } = upstream({
    groq: says('{"items":[]}'),
  });
  const text = "Midterm 1 is on October 14. ".repeat(500); // about 4,700 tokens by the estimate

  await extractPlan(
    { kind: "syllabus", courseLabel: "MATH", term: null, today: "2026-09-01", text, announcements: [] },
    { providers: groqOnly, fetchImpl, wait: async () => {} },
  );

  const maxTokens = calls[0].body.max_tokens as number;
  assert.ok(maxTokens < 4096, `asked for ${maxTokens}, which with the question is over the limit`);
  assert.ok(maxTokens >= 1_500);
});

test("a syllabus too long for Groq is never sent to it", async () => {
  const { calls, fetchImpl } = upstream({ glm: busy, gemini: busy, groq: says('{"items":[]}') });
  const text = "Week 1: introduction and course policies. ".repeat(1_200); // ~50,000 characters

  await assert.rejects(
    extractPlan(
      { kind: "syllabus", courseLabel: "MATH", term: null, today: "2026-09-01", text, announcements: [] },
      { providers: ALL, fetchImpl, wait: async () => {} },
    ),
  );
  assert.ok(!calls.some((call) => call.id === "groq"), "Groq was sent a request it would refuse");
});

test("the size estimate errs high, and counts a Chinese character as about one token", () => {
  assert.equal(estimateTokens("abcdef"), 2);
  assert.equal(estimateTokens("期中考试"), 4);
  assert.equal(estimateTokens("期中 exam"), 2 + Math.ceil(5 / 3));
});

test("the summary endpoint takes Groq as a choice, and then asks only Groq", async () => {
  const { POST } = await import("../src/app/api/announcements/summarize/route.ts");
  const keys = ["ZAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY"] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const realFetch = globalThis.fetch;
  process.env.ZAI_API_KEY = "zai-key";
  process.env.GEMINI_API_KEY = "gemini-key";
  process.env.GROQ_API_KEY = "groq-key";
  const { calls, fetchImpl } = upstream({ groq: says("- Midterm 2 moves to Tuesday Oct 14, MSB 411.") });
  globalThis.fetch = fetchImpl as typeof fetch;
  try {
    const response = await POST(
      new Request("http://localhost/api/announcements/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-real-ip": "192.0.2.77" },
        body: JSON.stringify({ ...REQUEST, courseLabel: "GROQ 1000", provider: "groq" }),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).provider, "groq");
    assert.deepEqual(calls.map((call) => call.id), ["groq"]);
  } finally {
    globalThis.fetch = realFetch;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
