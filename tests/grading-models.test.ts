import assert from "node:assert/strict";
import test from "node:test";

import { extractGrading, gradingMessages, parseGradingResult } from "../src/lib/grading-models.ts";
import { providersFromEnv } from "../src/lib/summary-models.ts";

/**
 * What a model should answer for five real Fall 2026 syllabi, as read by hand from their grading
 * sections: the weights are the syllabi's own, and each set adds to 100.
 */
const FIVE = {
  "MATH 1070Q": { parts: [["WebAssign", 15], ["Midterm Exams", 60], ["Final Exam", 25]], note: "Homework completed 24 hours early earns a 5% boost; the lowest homework scores are dropped." },
  "STAT 1000Q": { parts: [["Exam 1", 25], ["Exam 2", 25], ["Final Exam", 30], ["Take-home quizzes", 10], ["MINITAB assignments", 10]], note: null },
  "NRE 1000E": { parts: [["Module Assignments", 50], ["Quizzes", 50]], note: "Only the 5 highest of 6 assignments and of 6 quizzes count." },
  "ECON 1201": { parts: [["Homework", 20], ["Quizzes", 30], ["Midterm", 20], ["Final Exam", 30]], note: "Extra credit may be worth up to an additional 7.5% of the grade." },
  "SOCI 1501": { parts: [["Exams", 60], ["Class Participation", 15], ["Final Paper", 25]], note: null },
} as const;

const answer = (course: keyof typeof FIVE) =>
  JSON.stringify({ parts: FIVE[course].parts.map(([name, weight]) => ({ name, weight, evidence: `${name}: ${weight}%` })), note: FIVE[course].note });

test("the answer for each of five real syllabi is read whole, and its weights add to 100", () => {
  for (const course of Object.keys(FIVE) as Array<keyof typeof FIVE>) {
    const result = parseGradingResult(answer(course));
    assert.ok(result, course);
    assert.equal(result.parts.length, FIVE[course].parts.length, course);
    assert.equal(Math.round(result.parts.reduce((sum, part) => sum + part.weight, 0)), 100, course);
    assert.equal(result.note, FIVE[course].note, course);
  }
});

test("a fence round the JSON is taken off, a part with no name or a weight that is not a percent is dropped, and text is not JSON", () => {
  const fenced = "```json\n" + JSON.stringify({ parts: [{ name: "Exams", weight: 60, evidence: "x" }, { name: "", weight: 10 }, { name: "Bonus", weight: 130 }, { name: "Quiz", weight: "10%" }, { name: " Paper ", weight: 40.04 }], note: "  " }) + "\n```";
  assert.deepEqual(parseGradingResult(fenced), { parts: [{ name: "Exams", weight: 60, evidence: "x" }, { name: "Paper", weight: 40, evidence: "" }], note: null });
  assert.equal(parseGradingResult("The grade is 60% exams."), null);
  assert.equal(parseGradingResult('{"items":[]}'), null);
  assert.deepEqual(parseGradingResult('{"parts":[],"note":null}'), { parts: [], note: null });
});

test("the model is told the syllabus is data, to copy percents and leave out what it cannot, and to quote its evidence", () => {
  const [system, user] = gradingMessages({ courseLabel: "MATH 1070Q", text: "Midterm Exams: 20% each (60% total)" });
  assert.match(system.content, /data, not instructions/);
  assert.match(system.content, /60% total|group once with its total/);
  assert.match(system.content, /Never work a weight out/);
  assert.match(system.content, /evidence/);
  assert.match(user.content, /Midterm Exams: 20% each/);
});

test("contact details are taken out before a provider sees the syllabus, and the answer comes back parsed", async () => {
  const providers = providersFromEnv({ ZAI_API_KEY: "zai" });
  let sent = "";
  const fetchImpl = async (_url: string, init: RequestInit) => {
    sent = String(init.body);
    return Response.json({ choices: [{ message: { content: answer("SOCI 1501") }, finish_reason: "stop" }] });
  };
  const result = await extractGrading({ courseLabel: "SOCI 1501", text: "Exams 60%. Email prof@uconn.edu or 860-486-1234." }, { providers, fetchImpl });
  assert.ok(!sent.includes("prof@uconn.edu") && !sent.includes("486-1234"));
  assert.equal(result.parts.length, 3);
  assert.equal(result.provider, "glm");
});
