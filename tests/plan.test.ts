import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import {
  buildPlan,
  orderPlannedTasks,
  plannedTask,
} from "../src/lib/plan.ts";

// September 8, 2026 at 10:00 local time.
const NOW = new Date(2026, 8, 8, 10, 0, 0);

function localIso(year: number, month: number, day: number, hours = 12, minutes = 0) {
  return new Date(year, month, day, hours, minutes, 0).toISOString();
}

function makeTask(overrides: Partial<CalendarTask> & { id: string }): CalendarTask {
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

test("plannedTask converts each effort level into sittings", () => {
  const task = makeTask({ id: "a", start: localIso(2026, 8, 8, 23, 0) });

  assert.equal(plannedTask(task, NOW, "quick")?.sessionsNeeded, 1);
  assert.equal(plannedTask(task, NOW, "medium")?.sessionsNeeded, 2);
  assert.equal(plannedTask(task, NOW, "long")?.sessionsNeeded, 3);
});

test("plannedTask counts the days left, and one sitting per day is available", () => {
  const task = makeTask({ id: "a", start: localIso(2026, 8, 11, 9, 0) });
  const planned = plannedTask(task, NOW, "medium");

  assert.equal(planned?.daysLeft, 3);
  assert.equal(planned?.sessionsAvailable, 4);
  assert.equal(planned?.atRisk, false);
});

test("plannedTask flags work that no longer fits in the days remaining", () => {
  // A medium task due today needs two sittings but only one day is left.
  const task = makeTask({ id: "a", start: localIso(2026, 8, 8, 23, 0) });
  const planned = plannedTask(task, NOW, "medium");

  assert.equal(planned?.daysLeft, 0);
  assert.equal(planned?.sessionsAvailable, 1);
  assert.equal(planned?.sessionsNeeded, 2);
  assert.equal(planned?.atRisk, true);
});

test("plannedTask leaves a long task due in three days alone", () => {
  // Three sittings, four days available.
  const task = makeTask({ id: "a", start: localIso(2026, 8, 11, 9, 0) });

  assert.equal(plannedTask(task, NOW, "long")?.atRisk, false);
});

test("plannedTask flags a long task due tomorrow", () => {
  // Three sittings, two days available.
  const task = makeTask({ id: "a", start: localIso(2026, 8, 9, 9, 0) });
  const planned = plannedTask(task, NOW, "long");

  assert.equal(planned?.sessionsAvailable, 2);
  assert.equal(planned?.atRisk, true);
});

test("plannedTask marks a passed deadline as overdue, never at risk", () => {
  const task = makeTask({ id: "a", start: localIso(2026, 8, 7, 9, 0) });
  const planned = plannedTask(task, NOW, "long");

  assert.equal(planned?.overdue, true);
  assert.equal(planned?.atRisk, false);
  assert.ok((planned?.hoursUntilDue ?? 0) < 0);
});

test("plannedTask treats an all-day task as due at the end of its day", () => {
  const task = makeTask({
    id: "a",
    allDay: true,
    dateKey: "2026-09-08",
    start: localIso(2026, 8, 8, 0, 0),
  });
  const planned = plannedTask(task, NOW, "quick");

  assert.equal(planned?.daysLeft, 0);
  assert.equal(planned?.overdue, false);
});

test("plannedTask returns null when the date cannot be parsed", () => {
  assert.equal(plannedTask(makeTask({ id: "bad", start: "nope" }), NOW, "medium"), null);
});

test("orderPlannedTasks puts overdue first, then at risk, then soonest", () => {
  const overdue = plannedTask(makeTask({ id: "overdue", start: localIso(2026, 8, 7, 9, 0) }), NOW, "quick")!;
  const atRisk = plannedTask(makeTask({ id: "at-risk", start: localIso(2026, 8, 8, 23, 0) }), NOW, "long")!;
  const later = plannedTask(makeTask({ id: "later", start: localIso(2026, 8, 20, 9, 0) }), NOW, "quick")!;
  const soon = plannedTask(makeTask({ id: "soon", start: localIso(2026, 8, 12, 9, 0) }), NOW, "quick")!;

  const ordered = orderPlannedTasks([later, soon, atRisk, overdue]).map((item) => item.task.id);

  assert.deepEqual(ordered, ["overdue", "at-risk", "soon", "later"]);
});

test("buildPlan buckets the tasks and totals today's focus", () => {
  const tasks = [
    makeTask({ id: "overdue", start: localIso(2026, 8, 7, 9, 0) }),   // quick -> 15
    makeTask({ id: "at-risk", start: localIso(2026, 8, 8, 23, 0) }),  // long  -> 90
    makeTask({ id: "later", start: localIso(2026, 8, 20, 9, 0) }),    // quick -> upcoming
  ];
  const efforts = { overdue: "quick", "at-risk": "long" } as const;

  const plan = buildPlan(tasks, new Set(), efforts, NOW);

  assert.deepEqual(plan.overdue.map((item) => item.task.id), ["overdue"]);
  assert.deepEqual(plan.atRisk.map((item) => item.task.id), ["at-risk"]);
  assert.deepEqual(plan.upcoming.map((item) => item.task.id), ["later"]);
  assert.equal(plan.focusMinutes, 105);
});

test("buildPlan ignores completed tasks", () => {
  const tasks = [
    makeTask({ id: "done", start: localIso(2026, 8, 7, 9, 0) }),
    makeTask({ id: "todo", start: localIso(2026, 8, 8, 23, 0) }),
  ];

  const plan = buildPlan(tasks, new Set(["done"]), {}, NOW);

  assert.deepEqual(plan.overdue.map((item) => item.task.id), []);
  assert.deepEqual(plan.atRisk.map((item) => item.task.id), ["todo"]);
});

test("buildPlan leaves class meetings out: a lecture is not work you owe", () => {
  const tasks = [
    makeTask({ id: "lecture", kind: "class", start: localIso(2026, 8, 8, 23, 0) }),
    makeTask({ id: "quiz", kind: "assignment", start: localIso(2026, 8, 8, 23, 0) }),
    // A feed that is not Blackboard leaves `kind` unset, and those count.
    makeTask({ id: "unknown" }),
  ];

  const plan = buildPlan(tasks, new Set(), {}, NOW);
  const ids = [...plan.overdue, ...plan.atRisk, ...plan.upcoming].map((item) => item.task.id);

  assert.deepEqual(ids.sort(), ["quiz", "unknown"]);
  // Two deadlines at the default medium (45 each). The lecture would have made
  // it 135, so this also proves it never reached the focus total.
  assert.equal(plan.focusMinutes, 90);
});

test("buildPlan limits the upcoming list but never the urgent ones", () => {
  const tasks = Array.from({ length: 9 }, (_, index) =>
    makeTask({ id: `t${index}`, start: localIso(2026, 8, 20 + index, 9, 0) }),
  );

  const plan = buildPlan(tasks, new Set(), {}, NOW, 3);

  assert.equal(plan.upcoming.length, 3);
  assert.deepEqual(plan.upcoming.map((item) => item.task.id), ["t0", "t1", "t2"]);
});

test("buildPlan drops tasks whose date cannot be parsed", () => {
  const tasks = [
    makeTask({ id: "broken", start: "nope" }),
    makeTask({ id: "fine", start: localIso(2026, 8, 8, 23, 0) }),
  ];

  const plan = buildPlan(tasks, new Set(), {}, NOW);
  const ids = [...plan.overdue, ...plan.atRisk, ...plan.upcoming].map((item) => item.task.id);

  assert.deepEqual(ids, ["fine"]);
});
