import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { completionOf } from "../src/lib/todo.ts";

function makeTask(overrides: Partial<CalendarTask> & { id: string }): CalendarTask {
  return {
    title: overrides.id,
    course: null,
    start: new Date(2026, 8, 8, 12, 0, 0).toISOString(),
    dateKey: null,
    end: null,
    allDay: false,
    location: null,
    ...overrides,
  };
}

const codeOf = (task: CalendarTask) => task.course;

test("completionOf is zero for no tasks", () => {
  const { overall, byCourse } = completionOf([], new Set(), codeOf);

  assert.deepEqual(overall, { completed: 0, total: 0 });
  assert.equal(byCourse.size, 0);
});

test("the overall count reflects the completed deadlines", () => {
  const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" }), makeTask({ id: "c" }), makeTask({ id: "d" })];

  const { overall } = completionOf(tasks, new Set(["a", "c"]), codeOf);

  assert.deepEqual(overall, { completed: 2, total: 4 });
});

test("a lecture is neither work owed nor work completed", () => {
  const tasks = [
    makeTask({ id: "lecture", kind: "class", course: "NRE 1000E" }),
    makeTask({ id: "quiz", kind: "assignment", course: "NRE 1000E" }),
    makeTask({ id: "plain", course: "STAT 1000Q" }),
  ];

  const { overall, byCourse } = completionOf(tasks, new Set(["quiz"]), codeOf);

  assert.deepEqual(overall, { completed: 1, total: 2 });
  assert.deepEqual(byCourse.get("NRE 1000E"), { completed: 1, total: 1 });
  assert.deepEqual(byCourse.get("STAT 1000Q"), { completed: 0, total: 1 });
});

test("per course counts stay separate, and a task with no course is left out of them", () => {
  const tasks = [
    makeTask({ id: "1", course: "CSE 2050" }),
    makeTask({ id: "2", course: "CSE 2050" }),
    makeTask({ id: "3", course: "MATH 2110Q" }),
    makeTask({ id: "4", course: null }),
  ];

  const { overall, byCourse } = completionOf(tasks, new Set(["1", "4"]), codeOf);

  assert.deepEqual(overall, { completed: 2, total: 4 });
  assert.deepEqual([...byCourse.entries()], [
    ["CSE 2050", { completed: 1, total: 2 }],
    ["MATH 2110Q", { completed: 0, total: 1 }],
  ]);
});

test("the count runs over the whole term, not a window of days", () => {
  // Well before and well after anything the to-do list shows.
  const tasks = [
    makeTask({ id: "long-ago", start: new Date(2025, 0, 10, 12, 0, 0).toISOString() }),
    makeTask({ id: "far-off", start: new Date(2027, 0, 10, 12, 0, 0).toISOString() }),
  ];

  const { overall } = completionOf(tasks, new Set(["long-ago"]), codeOf);

  assert.deepEqual(overall, { completed: 1, total: 2 });
});

test("a task with an unparseable date still counts toward the total", () => {
  const tasks = [makeTask({ id: "broken", start: "not-a-date" })];

  assert.deepEqual(completionOf(tasks, new Set(), codeOf).overall, { completed: 0, total: 1 });
});
