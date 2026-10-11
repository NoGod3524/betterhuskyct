import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { groupTasks } from "../src/lib/calendar-view.ts";

function at(now: Date, days: number, hour: number) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour);
}

function task(id: string, start: Date, course: string, overrides: Partial<CalendarTask> = {}): CalendarTask {
  return { id, title: id, course, start: start.toISOString(), dateKey: null, end: null, allDay: false, location: null, kind: "assignment", ...overrides };
}

test("tasks are grouped into today, tomorrow and later this week, each in time order", () => {
  const now = new Date(2026, 8, 1, 9, 0, 0);
  const groups = groupTasks(
    [
      task("later", at(now, 6, 18), "ECON 1201"),
      task("this-afternoon", at(now, 0, 14), "CSE 2050"),
      task("tomorrow", at(now, 1, 16), "ENGL 1007"),
      task("three-days", at(now, 3, 16), "ECON 1201"),
      task("a-month-away", at(now, 30, 12), "MATH 2110Q"),
    ],
    now,
  );

  assert.deepEqual(
    groups.map((group) => group.tasks.map((entry) => entry.id)),
    [["this-afternoon"], ["tomorrow"], ["three-days", "later"]],
  );
});

test("hides timed events earlier today but keeps all-day events for today", () => {
  const now = new Date(2026, 8, 1, 9, 0, 0);
  const events = [
    {
      id: "timed-earlier-today",
      title: "Already happened today",
      course: "MATH 2110Q",
      start: new Date(2026, 8, 1, 7, 30).toISOString(),
      dateKey: null,
      end: null,
      allDay: false,
      location: null,
    },
    {
      id: "all-day-today",
      title: "All-day reminder",
      course: "BIO 1000",
      start: new Date(2026, 8, 1, 0, 0).toISOString(),
      dateKey: "2026-09-01",
      end: null,
      allDay: true,
      location: null,
    },
  ];

  const groups = groupTasks(events, now);

  assert.deepEqual(
    groups.map((group) => group.tasks.map((event) => event.id)),
    [["all-day-today"], [], []],
  );
  assert.equal(groups[0].tasks.some((event) => event.id === "timed-earlier-today"), false);
  assert.equal(groups[0].tasks.some((event) => event.id === "all-day-today"), true);
});
