import assert from "node:assert/strict";
import test from "node:test";

import { distinct, flatten, match, predict, rates, score, splitOf, unitsOf, type Event } from "../scripts/eval-announcements/common.ts";

const a = (id: string, body: string, course = "C1", title = "T") => ({ id, courseId: null, courseCode: course, title, body, posted: "10/5/26, 4:00 PM", announced: "2026-10-05T20:00:00.000Z" });
const quiz = (date: string | null): Event => ({ kind: "quiz", date });

test("precision and recall count a multiset of keys, so a repeated event is matched once per time it is expected", () => {
  assert.deepEqual(match(["a", "a", "b"], ["a", "b", "c"]), { tp: 2, fp: 1, fn: 1 });
  const r = rates({ tp: 3, fp: 1, fn: 1 });
  assert.equal(r.precision, 0.75);
  assert.equal(r.recall, 0.75);
  assert.equal(rates({ tp: 0, fp: 0, fn: 0 }).precision, null);
});

test("the three levels get stricter: the kind, then the kind with its day, then the day the student would pick", () => {
  const options = new Map([["quiz|null", ["2026-10-09", "2026-10-16"]]]);
  // The rules found a quiz and left its day open; the right day was among the choices.
  const left = score([quiz(null)], options, [quiz("2026-10-09")]);
  assert.deepEqual([left.kind.tp, left.date.tp, left.assisted.tp], [1, 0, 1]);
  // The wrong day settled is wrong at both of the last two.
  const wrong = score([quiz("2026-10-10")], new Map(), [quiz("2026-10-09")]);
  assert.deepEqual([wrong.kind.tp, wrong.date.tp, wrong.assisted.tp], [1, 0, 0]);
  // Nothing found is a miss at every level.
  const none = score([], new Map(), [quiz("2026-10-09")]);
  assert.deepEqual([none.kind.fn, none.date.fn, none.assisted.fn], [1, 1, 1]);
});

test("the same event said twice counts once, in the rules' output and in the gold", () => {
  const { events } = predict(a("x", "Quiz 3 is due October 9. Reminder: the quiz is due October 9."));
  assert.deepEqual(events, [{ kind: "quiz", date: "2026-10-09" }]);
  assert.equal(flatten({ "1": [quiz("2026-10-09")], "2": [quiz("2026-10-09")] }).length, 1);
});

test("copies of one text are one announcement, and the split never puts a text on both sides", () => {
  const list = [a("a1", "Same.", "C1"), a("a2", "Same.", "C1"), a("a3", "Other.", "C1"), a("a4", "Third.", "C1")];
  assert.equal(distinct(list).length, 3);
  const split = splitOf(list);
  assert.equal(split.size, 3);
  assert.deepEqual([...split.values()].sort(), ["dev", "dev", "test"]);
});

test("the title is unit 0 and the sentences follow, cut as the app cuts them", () => {
  assert.deepEqual(unitsOf({ title: "Quiz  2", body: "Due Friday. Bring a pencil." }).map((u) => [u.i, u.from, u.text]), [[0, "title", "Quiz 2"], [1, "text", "Due Friday."], [2, "text", "Bring a pencil."]]);
});
