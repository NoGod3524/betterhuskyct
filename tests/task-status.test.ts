import assert from "node:assert/strict";
import { test } from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import type { GradeItem, GradesSnapshot } from "../src/lib/grades.ts";
import {
  REOPENED_STORAGE_KEY,
  autoDoneTasks,
  doneLabels,
  doneReasonOf,
  normalizeCode,
  normalizeTitle,
  restoreReopened,
  saveReopened,
} from "../src/lib/task-status.ts";
import { buildTodo } from "../src/lib/todo.ts";

const row = (id: string, title: string, patch: Partial<GradeItem> = {}): GradeItem => ({
  id,
  title,
  status: null,
  earned: null,
  possible: null,
  label: "Not graded",
  ...patch,
});
const submitted = (id: string, title: string) => row(id, title, { status: "1 attempt submitted", label: "Not graded" });
const graded = (id: string, title: string, earned = 9, possible = 10) => row(id, title, { earned, possible, label: null });

const course = (id: string, code: string | null, items: GradeItem[]) => ({ id, code, items });
const snapshot = (...courses: GradesSnapshot["courses"]): GradesSnapshot => ({ version: 1, term: "Fall 2026", takenAt: "2026-09-28T18:00:00.000Z", courses });

const task = (id: string, title: string, patch: Partial<CalendarTask> = {}): CalendarTask => ({
  id,
  title,
  course: null,
  start: "2026-10-05T03:59:00.000Z",
  dateKey: null,
  end: null,
  allDay: false,
  location: null,
  kind: "assignment",
  ...patch,
});

const codeOf = (t: CalendarTask) => t.course;

// --- the words -------------------------------------------------------------------------------

test("titles that two systems spell differently are one title", () => {
  assert.equal(normalizeTitle("Section 4.1 Homework"), normalizeTitle("  section 4.1  HOMEWORK. "));
  assert.equal(normalizeTitle("Section 4.1 Homework is due"), normalizeTitle("Section 4.1 Homework"));
  assert.equal(normalizeTitle("Section 4.1 Homework - Due"), normalizeTitle("Section 4.1 Homework"));
  assert.equal(normalizeTitle("Exam 1: Chapter 4(Content isn't available)"), normalizeTitle("Exam 1: Chapter 4"));
  // Only a trailing "due" goes: a title that is about something due is left alone.
  assert.notEqual(normalizeTitle("Due diligence essay"), normalizeTitle("essay"));
  assert.notEqual(normalizeTitle("Section 4.1 Homework"), normalizeTitle("Section 4.2 Homework"));
});

test("a course is one course however its code is written", () => {
  assert.equal(normalizeCode("MATH 1070Q"), normalizeCode("math-1070q"));
  assert.equal(normalizeCode("MATH 1070Q"), "MATH1070Q");
});

test("a row says done when it has a score, is complete, or is handed in; not when merely started", () => {
  assert.equal(doneReasonOf(graded("_1_1", "HW")), "graded");
  assert.equal(doneReasonOf(graded("_1_1", "HW", 0, 100)), "graded");
  assert.equal(doneReasonOf(row("_1_1", "HW", { label: "Grade is complete" })), "graded");
  assert.equal(doneReasonOf(submitted("_1_1", "HW")), "submitted");
  assert.equal(doneReasonOf(row("_1_1", "HW", { status: "2 attempts submitted (1 Late)" })), "submitted");
  assert.equal(doneReasonOf(row("_1_1", "EA", { status: "First participated on 9/22/26" })), "submitted");
  // The gradebook table's own words for its status column.
  assert.equal(doneReasonOf(row("_1_1", "Exam", { status: "Submitted", label: "Not graded" })), "submitted");
  assert.equal(doneReasonOf(row("_1_1", "Quiz", { status: "Graded" })), "graded");
  assert.equal(doneReasonOf(row("_1_1", "Late", { status: "Submitted (Late)" })), "submitted");
  // Not in yet.
  assert.equal(doneReasonOf(row("_1_1", "HW", { status: "Not submitted" })), null);
  assert.equal(doneReasonOf(row("_1_1", "HW")), null);
  assert.equal(doneReasonOf(row("_1_1", "Test", { status: "Attempt 2 started" })), null);
  assert.equal(doneReasonOf(row("_1_1", "EA", { status: "No participation (Late)" })), null);
  assert.equal(doneReasonOf(row("_1_1", "Practice", { earned: 0, possible: 0, label: null })), null);
  assert.equal(doneReasonOf(row("_1_1", "HW", { label: "Not graded" })), null);
});

// --- matching ----------------------------------------------------------------------------------------

test("a deadline is done when its course and whole title match a row that is in", () => {
  const grades = snapshot(
    course("_1_1", "MATH 1070Q", [
      submitted("_10_1", "Section 4.1 Homework"),
      graded("_11_1", "Section 4.2 Homework"),
      row("_12_1", "Section 4.3 Homework"),
    ]),
  );
  const tasks = [
    task("a", "Section 4.1 Homework", { course: "MATH 1070Q" }),
    task("b", "Section 4.2 Homework is due", { course: "math-1070q" }),
    task("c", "Section 4.3 Homework", { course: "MATH 1070Q" }), // not handed in
    task("d", "Section 9.9 Homework", { course: "MATH 1070Q" }), // not in the gradebook
  ];

  const done = autoDoneTasks(tasks, grades, codeOf);

  assert.deepEqual([...done].sort(), [["a", "submitted"], ["b", "graded"]]);
});

test("the same title in another course does not make a task done", () => {
  const grades = snapshot(course("_1_1", "MATH 1070Q", [submitted("_1_1", "Homework 1")]), course("_2_1", "ECON 1201", [row("_2_1", "Homework 1")]));

  const done = autoDoneTasks([task("m", "Homework 1", { course: "MATH 1070Q" }), task("e", "Homework 1", { course: "ECON 1201" })], grades, codeOf);

  assert.deepEqual([...done.keys()], ["m"]);
});

test("two rows with one title, only one of them in: not done, because it is not clear which this is", () => {
  const grades = snapshot(course("_1_1", "STAT 1000Q", [submitted("_1_1", "Quiz"), row("_2_1", "Quiz")]));

  assert.equal(autoDoneTasks([task("q", "Quiz", { course: "STAT 1000Q" })], grades, codeOf).size, 0);
});

test("a lecture and its lab share a code, and a row in either counts", () => {
  const grades = snapshot(course("_1_1", "STAT 1000Q", [row("_1_1", "Lab 1")]), course("_2_1", "STAT 1000Q", [graded("_2_1", "Lab 1")]));
  // One is done and one is not under one title: ambiguous, so open.
  assert.equal(autoDoneTasks([task("l", "Lab 1", { course: "STAT 1000Q" })], grades, codeOf).size, 0);

  const bothIn = snapshot(course("_1_1", "STAT 1000Q", [submitted("_1_1", "Lab 2")]), course("_2_1", "STAT 1000Q", [graded("_2_1", "Lab 2")]));
  assert.equal(autoDoneTasks([task("l", "Lab 2", { course: "STAT 1000Q" })], bothIn, codeOf).get("l"), "graded");
});

test("a task with no course is matched on its title alone only when every row of that title is in", () => {
  const unique = snapshot(course("_1_1", "MATH 1070Q", [submitted("_1_1", "Midterm project proposal")]));
  assert.equal(autoDoneTasks([task("p", "Midterm project proposal")], unique, codeOf).get("p"), "submitted");

  const clash = snapshot(course("_1_1", "MATH 1070Q", [submitted("_1_1", "Homework 1")]), course("_2_1", "ECON 1201", [row("_2_1", "Homework 1")]));
  assert.equal(autoDoneTasks([task("h", "Homework 1")], clash, codeOf).size, 0);
});

test("classes are never done, and with no grades nothing is", () => {
  const grades = snapshot(course("_1_1", "MATH 1070Q", [submitted("_1_1", "Lecture")]));
  assert.equal(autoDoneTasks([task("c", "Lecture", { course: "MATH 1070Q", kind: "class" })], grades, codeOf).size, 0);
  assert.equal(autoDoneTasks([task("a", "Lecture", { course: "MATH 1070Q" })], null, codeOf).size, 0);
});

// --- ticks and reopening ---------------------------------------------------------------------------------

test("a student's tick, HuskyCT's word, and a reopened task, together", () => {
  const auto = new Map([["a", "submitted" as const], ["b", "graded" as const], ["c", "submitted" as const]]);

  const labels = doneLabels(new Set(["c", "d"]), auto, new Set(["b"]));

  // b was reopened, so it is not done; c is both, and the tick is the label; d only ticked.
  assert.deepEqual([...labels].sort(), [["a", "submitted"], ["c", "ticked"], ["d", "ticked"]]);
});

test("reopened tasks are kept in the browser, and bad data or blocked storage reads as none", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };

  assert.equal(restoreReopened(storage).size, 0);
  saveReopened(storage, new Set(["a", "b"]));
  assert.deepEqual([...restoreReopened(storage)].sort(), ["a", "b"]);
  saveReopened(storage, new Set());
  assert.equal(values.has(REOPENED_STORAGE_KEY), false);

  values.set(REOPENED_STORAGE_KEY, "{not json");
  assert.equal(restoreReopened(storage).size, 0);
  values.set(REOPENED_STORAGE_KEY, JSON.stringify(["ok", 7, null, ""]));
  assert.deepEqual([...restoreReopened(storage)], ["ok"]);

  const blocked = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("SecurityError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  assert.equal(restoreReopened(blocked).size, 0);
  assert.doesNotThrow(() => saveReopened(blocked, new Set(["a"])));
});

// --- the to-do list ----------------------------------------------------------------------------------------

test("the to-do list reaches back to what is overdue and forward to what is coming, without classes", () => {
  const now = new Date("2026-10-05T14:00:00");
  const at = (days: number, hour = 12) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const tasks = [
    task("old", "Missed", { start: at(-3) }),
    task("ancient", "Months ago", { start: at(-90) }),
    task("now", "Tonight", { start: at(0, 23) }),
    task("tom", "Tomorrow", { start: at(1) }),
    task("wk", "This week", { start: at(4) }),
    task("later", "Later", { start: at(20) }),
    task("far", "Far away", { start: at(200) }),
    task("class", "Lecture", { start: at(0, 23), kind: "class" }),
    task("handed", "Handed in", { start: at(2) }),
    task("handedOld", "Handed in earlier", { start: at(-5) }),
  ];

  const todo = buildTodo(tasks, new Set(["handed", "handedOld"]), now);

  assert.deepEqual(todo.open.overdue.map((t) => t.id), ["old"]);
  assert.deepEqual(todo.open.today.map((t) => t.id), ["now"]);
  assert.deepEqual(todo.open.tomorrow.map((t) => t.id), ["tom"]);
  assert.deepEqual(todo.open.week.map((t) => t.id), ["wk"]);
  assert.deepEqual(todo.open.later.map((t) => t.id), ["later"]);
  assert.equal(todo.openCount, 5);
  // Done work is set apart, most recently due first; the class, the ancient and the far are out.
  assert.deepEqual(todo.done.map((t) => t.id), ["handed", "handedOld"]);
});

test("an all-day deadline is not overdue until its day is over", () => {
  const now = new Date("2026-10-05T14:00:00");
  const todo = buildTodo([task("d", "Due today, all day", { allDay: true, start: "2026-10-05", dateKey: "2026-10-05" })], new Set(), now);
  assert.deepEqual(todo.open.today.map((t) => t.id), ["d"]);
  assert.equal(todo.open.overdue.length, 0);
});
