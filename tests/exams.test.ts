import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { isExamTitle, upcomingExams } from "../src/lib/exams.ts";

const now = new Date(2026, 9, 9, 10, 0, 0);
const task = (id: string, title: string, dayOffset: number, extra: Partial<CalendarTask> = {}): CalendarTask => ({
  id, title, course: null,
  start: new Date(2026, 9, 9 + dayOffset, 15).toISOString(),
  dateKey: null, end: null, allDay: false, location: null, ...extra,
});

test("a title names an exam when it says exam, midterm, final or test, but not a quiz or a final project", () => {
  for (const yes of ["Midterm Exam", "Mid-term 1", "Final Exam", "Exam 2", "Test 3", "Finals", "midterm"]) assert.equal(isExamTitle(yes), true, yes);
  for (const no of ["Quiz 4", "Final Project", "Final paper draft", "Problem set 5", "Reading response", "Contest"]) assert.equal(isExamTitle(no), false, no);
});

test("the exams ahead come nearest first with the days left, today's included, and not what is done or past", () => {
  const found = upcomingExams(
    [task("fin", "Final Exam", 30), task("mid", "Midterm", 5), task("today", "Exam 1", 0), task("gone", "Old Exam", -3), task("done", "Test 2", 2), task("quiz", "Quiz", 1)],
    new Set(["done"]),
    now,
  );
  assert.deepEqual(found.map((e) => [e.task.id, e.daysLeft]), [["today", 0], ["mid", 5], ["fin", 30]]);
});

test("a class meeting is not an exam, and an all-day exam today is still ahead", () => {
  const found = upcomingExams([task("lecture", "Exam review", 3, { kind: "class" }), task("allday", "Final exam", 0, { allDay: true, start: new Date(2026, 9, 9).toISOString() })], new Set(), now);
  assert.deepEqual(found.map((e) => e.task.id), ["allday"]);
});
