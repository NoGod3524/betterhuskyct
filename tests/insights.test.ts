import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { computeInsights } from "../src/lib/insights.ts";

// September 8, 2026 at 10:00 local time.
const NOW = new Date(2026, 8, 8, 10, 0, 0);

function localIso(
  year: number,
  month: number,
  day: number,
  hours = 12,
  minutes = 0,
) {
  return new Date(year, month, day, hours, minutes, 0).toISOString();
}

function makeTask(
  overrides: Partial<CalendarTask> & { id: string },
): CalendarTask {
  return {
    title: overrides.id,
    course: null,
    start: localIso(2026, 8, 8, 12),
    dateKey: null,
    end: null,
    allDay: false,
    location: null,
    ...overrides,
  };
}

test("computeInsights returns empty zeros for no tasks", () => {
  const insights = computeInsights([], new Set(), NOW);

  assert.equal(insights.total, 0);
  assert.equal(insights.completed, 0);
  assert.equal(insights.completionRate, 0);
  assert.deepEqual(insights.byCourse, []);
  assert.deepEqual(insights.byWeek, [0, 0, 0, 0]);
  assert.deepEqual(insights.nextSevenDays, [0, 0, 0, 0, 0, 0, 0]);
});

test("completionRate reflects the completed subset", () => {
  const tasks = [
    makeTask({ id: "a" }),
    makeTask({ id: "b" }),
    makeTask({ id: "c" }),
    makeTask({ id: "d" }),
  ];

  const insights = computeInsights(tasks, new Set(["a", "c"]), NOW);

  assert.equal(insights.total, 4);
  assert.equal(insights.completed, 2);
  assert.equal(insights.completionRate, 0.5);
});

test("computeInsights counts deadlines only, so a lecture cannot skew them", () => {
  const tasks = [
    makeTask({ id: "lecture", kind: "class", course: "NRE 1000E" }),
    makeTask({ id: "quiz", kind: "assignment", course: "NRE 1000E" }),
    makeTask({ id: "plain", course: "STAT 1000Q" }),
  ];

  const insights = computeInsights(tasks, new Set(["quiz"]), NOW);

  // The lecture is neither work owed nor work completed.
  assert.equal(insights.total, 2);
  assert.equal(insights.completed, 1);
  assert.equal(insights.completionRate, 0.5);
  assert.deepEqual(
    insights.byCourse.map((row) => [row.course, row.total]),
    [
      ["NRE 1000E", 1],
      ["STAT 1000Q", 1],
    ],
  );
});

test("completionRate is 1 when every task is complete", () => {
  const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];

  assert.equal(computeInsights(tasks, new Set(["a", "b"]), NOW).completionRate, 1);
});

test("byCourse groups, counts completions, and sorts busiest first with null last", () => {
  const tasks = [
    makeTask({ id: "1", course: "CSE 2050" }),
    makeTask({ id: "2", course: "CSE 2050" }),
    makeTask({ id: "3", course: "MATH 2110Q" }),
    makeTask({ id: "4", course: null }),
  ];

  const insights = computeInsights(tasks, new Set(["1"]), NOW);

  assert.deepEqual(insights.byCourse, [
    { course: "CSE 2050", total: 2, completed: 1 },
    { course: "MATH 2110Q", total: 1, completed: 0 },
    { course: null, total: 1, completed: 0 },
  ]);
});

test("nextSevenDays buckets by local day and ignores past and out-of-range tasks", () => {
  const tasks = [
    makeTask({ id: "today", start: localIso(2026, 8, 8, 23, 0) }),
    makeTask({ id: "day6", start: localIso(2026, 8, 14, 9, 0) }),
    makeTask({ id: "day7", start: localIso(2026, 8, 15, 9, 0) }),
    makeTask({ id: "yesterday", start: localIso(2026, 8, 7, 9, 0) }),
  ];

  const insights = computeInsights(tasks, new Set(), NOW);

  assert.deepEqual(insights.nextSevenDays, [1, 0, 0, 0, 0, 0, 1]);
  // Past tasks still count toward the totals shown in the summary cards.
  assert.equal(insights.total, 4);
});

test("byWeek rolls forward in 7-day windows and stops after week 4", () => {
  const tasks = [
    makeTask({ id: "week0", start: localIso(2026, 8, 8, 9, 0) }),
    makeTask({ id: "week0b", start: localIso(2026, 8, 14, 9, 0) }),
    makeTask({ id: "week3", start: localIso(2026, 8, 29, 9, 0) }),
    makeTask({ id: "week4", start: localIso(2026, 9, 6, 9, 0) }),
  ];

  const insights = computeInsights(tasks, new Set(), NOW);

  assert.deepEqual(insights.byWeek, [2, 0, 0, 1]);
});

test("all-day tasks are bucketed by their dateKey, not their start timestamp", () => {
  const tasks = [
    makeTask({
      id: "all-day",
      allDay: true,
      dateKey: "2026-09-09",
      start: localIso(2026, 8, 8, 0, 0),
    }),
  ];

  const insights = computeInsights(tasks, new Set(), NOW);

  // Today (day 0) stays empty; the all-day task lands on day 1 via its dateKey.
  assert.deepEqual(insights.nextSevenDays, [0, 1, 0, 0, 0, 0, 0]);
});

test("tasks with an unparseable start date count in totals but never in a bucket", () => {
  const tasks = [makeTask({ id: "broken", start: "not-a-date" })];

  const insights = computeInsights(tasks, new Set(), NOW);

  assert.equal(insights.total, 1);
  assert.deepEqual(insights.nextSevenDays, [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(insights.byWeek, [0, 0, 0, 0]);
});
