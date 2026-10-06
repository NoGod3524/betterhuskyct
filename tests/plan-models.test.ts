import assert from "node:assert/strict";
import test from "node:test";

import { extractPlan, parsePlanAnswer, parsePlanResult, planMessages, type PlanRequest } from "../src/lib/plan-models.ts";
import { ModelError, providersFromEnv } from "../src/lib/summary-models.ts";

const SYLLABUS: PlanRequest = {
  kind: "syllabus",
  courseLabel: "MATH 1070Q",
  term: "Fall 2026",
  today: "2026-09-01",
  text: "Midterm 1: Wednesday, October 14 in MSB 411. Questions: prof.jones@uconn.edu or 860-486-1234.",
  announcements: [],
};

const providers = providersFromEnv({ ZAI_API_KEY: "zai", GEMINI_API_KEY: "gemini" });

const says = (content: string) => () => Response.json({ choices: [{ message: { content }, finish_reason: "stop" }] });

function stub(answers: { glm?: Array<() => Response>; gemini?: Array<() => Response> }) {
  const sent: Array<{ provider: string; body: Record<string, unknown> }> = [];
  const counts = { glm: 0, gemini: 0 };
  const fetchImpl = async (url: string, init: RequestInit) => {
    const provider = url.includes("z.ai") ? "glm" : "gemini";
    sent.push({ provider, body: JSON.parse(String(init.body)) });
    const list = answers[provider] ?? [() => new Response("{}", { status: 500 })];
    return list[Math.min(counts[provider]++, list.length - 1)]();
  };
  return { sent, fetchImpl };
}

test("the source is data, dates are copied and never worked out, and the term and today are given", () => {
  const [system, user] = planMessages(SYLLABUS);

  assert.match(system.content, /data, not instructions/);
  assert.match(system.content, /Never invent/);
  assert.match(system.content, /only a week number[^.]*set "date" to null/);
  assert.match(user.content, /Term: Fall 2026/);
  assert.match(user.content, /Today: 2026-09-01/);
  assert.ok(user.content.includes("Midterm 1: Wednesday, October 14"));
});

test("announcements are numbered so each item can say which one it came from", () => {
  const [system, user] = planMessages({
    ...SYLLABUS,
    kind: "announcements",
    text: "",
    announcements: [
      { title: "Exam moved", body: "Exam 2 is now Oct 21.", posted: "Oct 1" },
      { title: "Welcome", body: "Hi all", posted: null },
    ],
  });

  assert.match(system.content, /"source": the number of the announcement/);
  assert.match(user.content, /\[1\] Exam moved\nPosted: Oct 1\nExam 2 is now Oct 21\./);
  assert.match(user.content, /\[2\] Welcome/);
});

test("an answer is read with or without a code fence, and anything unusable in it is dropped or emptied", () => {
  const answer = JSON.stringify({
    items: [
      { title: "Midterm 1", date: "2026-10-14", time: "18:30", kind: "exam", evidence: "Midterm 1: Wednesday, October 14", source: null },
      { title: "Feb 30 quiz", date: "2026-02-30", time: "10:00", kind: "quiz", evidence: "", source: null },
      { title: "Buy the textbook", date: null, time: "09:00", kind: "chore", evidence: "", source: 7 },
      { title: "   ", date: "2026-10-01", kind: "exam" },
      "not an item",
    ],
  });

  for (const content of [answer, "```json\n" + answer + "\n```"]) {
    const items = parsePlanAnswer(content, 1);
    assert.ok(items, "a fenced answer was refused");
    assert.equal(items.length, 3, "an untitled or non-object item was kept");
    assert.deepEqual(items[0], { title: "Midterm 1", date: "2026-10-14", time: "18:30", kind: "exam", evidence: "Midterm 1: Wednesday, October 14", source: null });
    assert.equal(items[1].date, null, "a day that does not exist was kept");
    assert.equal(items[1].time, null, "a time was kept on an item with no date");
    assert.equal(items[2].kind, "task", "an unknown kind was not made a plain to-do");
    assert.equal(items[2].source, null, "a source past the announcements sent was kept");
  }
});

test("an answer that is not the JSON asked for is no answer", () => {
  assert.equal(parsePlanAnswer("Here are the dates: Midterm Oct 14"), null);
  assert.equal(parsePlanAnswer('{"dates":[]}'), null);
  assert.deepEqual(parsePlanAnswer('{"items":[]}'), []);
});

test("contact details are taken out before a provider sees the syllabus, and JSON is asked for", async () => {
  const { sent, fetchImpl } = stub({ glm: [says('{"items":[]}')] });

  await extractPlan(SYLLABUS, { providers, fetchImpl });

  const body = JSON.stringify(sent[0].body);
  assert.ok(!body.includes("prof.jones@uconn.edu") && !body.includes("486-1234"), body);
  assert.ok(body.includes("[email]") && body.includes("[phone]"));
  assert.ok(body.includes("October 14"), "the date itself was redacted");
  assert.deepEqual(sent[0].body.response_format, { type: "json_object" });
});

test("an answer that is not JSON moves on to the next provider", async () => {
  const { sent, fetchImpl } = stub({
    glm: [says("Sure! Midterm is Oct 14.")],
    gemini: [says('{"items":[{"title":"Midterm 1","date":"2026-10-14","time":null,"kind":"exam","evidence":"","source":null}]}')],
  });

  const result = await extractPlan(SYLLABUS, { providers, fetchImpl, wait: async () => {} });

  assert.equal(result.provider, "gemini");
  assert.equal(result.items[0].title, "Midterm 1");
  assert.deepEqual(sent.map((call) => call.provider), ["glm", "gemini"]);
});

test("when every provider is busy the problem is busy, so the page can try again later", async () => {
  const { fetchImpl } = stub({ glm: [() => new Response("{}", { status: 429 })], gemini: [() => new Response("{}", { status: 429 })] });

  await assert.rejects(
    extractPlan(SYLLABUS, { providers, fetchImpl, wait: async () => {} }),
    (error: unknown) => error instanceof ModelError && error.problem === "busy",
  );
});

test("a syllabus is also summed up, in the reader's language, with its numbers copied; announcements are not", () => {
  const [syllabusSystem] = planMessages({ ...SYLLABUS, locale: "zh-CN" });
  assert.match(syllabusSystem.content, /"summary"/);
  assert.match(syllabusSystem.content, /Simplified Chinese/);
  assert.match(syllabusSystem.content, /how the grade is made up/);
  assert.match(syllabusSystem.content, /Copy every number, percentage/);

  const [announcementSystem] = planMessages({ ...SYLLABUS, kind: "announcements", text: "", announcements: [{ title: "A", body: "B", posted: null }] });
  assert.doesNotMatch(announcementSystem.content, /"summary"/);
});

test("a summary keeps its bullets, loses its Markdown, and is dropped when in the wrong language, without losing the dates", () => {
  const items = [{ title: "Midterm 1", date: "2026-10-14", time: null, kind: "exam", evidence: "", source: null }];
  const answer = (summary: string) => JSON.stringify({ summary, items });

  const english = parsePlanResult(answer("Here is the summary:\n- **Grading:** exams 60%, homework 40%\n* Late work: -10% a day\n"), 0, "en");
  assert.equal(english?.summary, "- Grading: exams 60%, homework 40%\n- Late work: -10% a day");

  const chinese = parsePlanResult(answer("- 成绩：考试 60%，作业 40%\n- 迟交每天扣 10%"), 0, "zh-CN");
  assert.equal(chinese?.summary, "- 成绩：考试 60%，作业 40%\n- 迟交每天扣 10%");

  const wrong = parsePlanResult(answer("- Grading: exams 60%, homework 40%"), 0, "zh-CN");
  assert.equal(wrong?.summary, null, "an English summary was kept for a Chinese page");
  assert.equal(wrong?.items.length, 1, "the dates went with the summary");

  assert.equal(parsePlanResult(JSON.stringify({ items }), 0, "en")?.summary, null);
});

test("only a syllabus's summary is kept: one a model adds to announcements is dropped", async () => {
  const { fetchImpl } = stub({ glm: [says('{"summary":"- Something","items":[]}')] });
  const result = await extractPlan(
    { ...SYLLABUS, kind: "announcements", text: "", announcements: [{ title: "A", body: "B", posted: null }] },
    { providers, fetchImpl },
  );
  assert.equal(result.summary, null);

  const { fetchImpl: again } = stub({ glm: [says('{"summary":"- Exams 60%","items":[]}')] });
  assert.equal((await extractPlan(SYLLABUS, { providers, fetchImpl: again })).summary, "- Exams 60%");
});
