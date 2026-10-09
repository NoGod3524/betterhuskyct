import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { groupTasks, summarizeDays } from "../src/lib/calendar-view.ts";

const now = new Date(2026, 8, 1, 9, 0, 0);

function task(id: string, dayOffset: number, hour: number, extra: Partial<CalendarTask> = {}): CalendarTask {
  const start = new Date(2026, 8, 1 + dayOffset, hour);
  return { id, title: id, course: null, start: start.toISOString(), dateKey: null, end: null, allDay: false, location: null, ...extra };
}

test("it counts the deadlines left today, tomorrow and later in the week, and names the first", () => {
  const groups = groupTasks([task("a", 0, 14), task("b", 0, 18), task("c", 1, 10), task("d", 3, 10), task("e", 5, 10)], now);

  const summary = summarizeDays(groups, new Set());

  assert.deepEqual([summary.today, summary.tomorrow, summary.later], [2, 1, 2]);
  assert.equal(summary.next?.task.id, "a");
  assert.equal(summary.next?.group, "today");
});

test("what is done and what is a class meeting are not counted, and the first moves on", () => {
  const groups = groupTasks([task("done", 0, 14), task("lecture", 0, 15, { kind: "class" }), task("todo", 1, 10)], now);

  const summary = summarizeDays(groups, new Set(["done"]));

  assert.deepEqual([summary.today, summary.tomorrow, summary.later], [0, 1, 0]);
  assert.equal(summary.next?.task.id, "todo");
  assert.equal(summary.next?.group, "tomorrow");
});

test("with nothing left there is no first one", () => {
  const summary = summarizeDays(groupTasks([task("done", 0, 14)], now), new Set(["done"]));
  assert.deepEqual([summary.today, summary.tomorrow, summary.later, summary.next], [0, 0, 0, null]);
});
