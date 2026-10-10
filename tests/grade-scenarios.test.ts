import assert from "node:assert/strict";
import test from "node:test";

import type { GradeItem } from "../src/lib/grades.ts";
import {
  guessCategory,
  letterFor,
  neededOnOpen,
  parseScheme,
  scenarioTotal,
  standingOf,
  type Scheme,
} from "../src/lib/grade-scenarios.ts";

const item = (id: string, title: string, earned: number | null, possible: number | null): GradeItem => ({
  id, title, status: null, earned, possible, label: null,
});
const cats = [
  { id: "hw", name: "Homework", weight: 20 },
  { id: "quiz", name: "Quizzes", weight: 20 },
  { id: "exam", name: "Exams", weight: 60 },
];
const scheme = (extra: Partial<Scheme> = {}): Scheme => ({ categories: cats, assigned: {}, expected: {}, open: [], ...extra });

test("a gradebook row is put with the part it names or the usual word for it, and left out when unclear", () => {
  assert.equal(guessCategory("Quiz 2", cats), "quiz");
  assert.equal(guessCategory("HW 3", cats), "hw");
  assert.equal(guessCategory("Problem Set 4", cats), "hw");
  assert.equal(guessCategory("Midterm 1", cats), "exam");
  assert.equal(guessCategory("Welcome survey", cats), null);
  // Two parts fit: no guess.
  assert.equal(guessCategory("Quiz and homework", cats), null);
});

test("each part's average is over its scored rows by points, a choice beats the guess, and the rest are listed apart", () => {
  const items = [item("a", "Quiz 1", 8, 10), item("b", "Quiz 2", 18, 20), item("c", "Homework 1", 9, 10), item("d", "Survey", 1, 1), item("e", "Quiz 3", null, null)];
  const standing = standingOf(items, scheme());
  const average = (id: string) => standing.parts.find((part) => part.category.id === id)?.average;
  assert.equal(average("quiz"), 86.7);
  assert.equal(average("hw"), 90);
  assert.equal(average("exam"), null);
  assert.deepEqual(standing.unassigned.map((row) => row.id), ["d"]);
  const moved = standingOf(items, scheme({ assigned: { d: "exam" } }));
  assert.equal(moved.parts.find((part) => part.category.id === "exam")?.average, 100);
  assert.deepEqual(moved.unassigned, []);
});

test("the scenario total weighs what each part stands at or is expected to come to, and says what it left out", () => {
  const standing = standingOf([item("a", "Quiz 1", 80, 100), item("c", "HW 1", 90, 100)], scheme());
  // Exams have nothing yet: the total is over homework and quizzes.
  assert.deepEqual(scenarioTotal(standing, scheme()), { percent: 85, missingWeight: 60, totalWeight: 100 });
  // An expectation of 100 on the exams brings them in.
  assert.deepEqual(scenarioTotal(standing, scheme({ expected: { exam: 100 } })), { percent: 94, missingWeight: 0, totalWeight: 100 });
  // An expectation overrides what a part stands at.
  assert.equal(scenarioTotal(standing, scheme({ expected: { quiz: 100, exam: 100 } })).percent, 98);
});

test("what the open parts must average to reach a target, as in 40% done at 90 and 93 wanted", () => {
  const two: Scheme = { categories: [{ id: "done", name: "Done", weight: 40 }, { id: "rest", name: "Rest", weight: 60 }], assigned: {}, expected: { done: 90 }, open: ["rest"] };
  const standing = standingOf([], two);
  // (93*100 - 40*90) / 60 = 95
  assert.deepEqual(neededOnOpen(standing, two, 93), { kind: "needs", percent: 95 });
  assert.deepEqual(neededOnOpen(standing, two, 30), { kind: "safe" });
  assert.deepEqual(neededOnOpen(standing, two, 99), { kind: "out", best: 96 });
  // A closed part with nothing known, no open part, or a target that is not a percent: no answer.
  assert.deepEqual(neededOnOpen(standing, { ...two, expected: {} }, 93), { kind: "none" });
  assert.deepEqual(neededOnOpen(standing, { ...two, open: [] }, 93), { kind: "none" });
  assert.deepEqual(neededOnOpen(standing, two, NaN), { kind: "none" });
});

test("a scheme that does not add to 100 is worked over its own sum", () => {
  const odd: Scheme = { categories: [{ id: "a", name: "A", weight: 30 }, { id: "b", name: "B", weight: 30 }], assigned: {}, expected: { a: 80 }, open: ["b"] };
  assert.deepEqual(neededOnOpen(standingOf([], odd), odd, 90), { kind: "needs", percent: 100 });
});

test("letters follow the usual cut-offs", () => {
  assert.deepEqual([93, 92.9, 90, 87, 59.9].map(letterFor), ["A", "A-", "A-", "B+", "F"]);
});

test("a stored scheme is read only when it is in shape, and stray references are dropped", () => {
  const good = parseScheme({ categories: cats, assigned: { r1: "hw", r2: "gone" }, expected: { quiz: 80, nope: 50, exam: 120 }, open: ["exam", "nope"] });
  assert.deepEqual(good?.assigned, { r1: "hw" });
  assert.deepEqual(good?.expected, { quiz: 80 });
  assert.deepEqual(good?.open, ["exam"]);
  assert.equal(parseScheme({ categories: [{ id: "x", name: 5, weight: 10 }] }), null);
  assert.equal(parseScheme({ categories: [{ id: "x", name: "", weight: 10 }] })?.categories.length, 1);
  assert.equal(parseScheme({ categories: [{ id: "x", name: "X", weight: 101 }] }), null);
  assert.equal(parseScheme("nope"), null);
});

test("with several exam parts a row goes to the one it names, and one that fits them all is left for the student", () => {
  const stat = [
    { id: "e1", name: "Exam 1", weight: 25 },
    { id: "e2", name: "Exam 2", weight: 25 },
    { id: "fin", name: "Final Exam", weight: 30 },
    { id: "q", name: "Take-home quizzes", weight: 10 },
    { id: "m", name: "MINITAB assignments", weight: 10 },
  ];
  assert.equal(guessCategory("Exam 2", stat), "e2");
  assert.equal(guessCategory("Exam 1 Score", stat), "e1");
  assert.equal(guessCategory("Final Exam", stat), "fin");
  assert.equal(guessCategory("Take-home Quiz 3", stat), "q");
  assert.equal(guessCategory("Quiz 7", stat), "q");
  assert.equal(guessCategory("MINITAB 4", stat), "m");
  // A midterm could be either exam: no guess.
  assert.equal(guessCategory("Midterm", stat), null);
  // A number alone is not a reason.
  assert.equal(guessCategory("Survey 1", stat), null);
});
