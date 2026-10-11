import assert from "node:assert/strict";
import test from "node:test";

import { localDay } from "../src/lib/date-utils.ts";
import { dueInstant } from "../src/lib/quick-add.ts";

test("today is the reader's local day, with the month and day padded", () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(localDay(new Date(2026, 10, 30, 0, 0)), "2026-11-30");
});

test("a day and a time give that local moment, and no time gives the start of the day", () => {
  const timed = new Date(dueInstant("2026-10-09", "14:30"));
  assert.deepEqual([timed.getFullYear(), timed.getMonth(), timed.getDate(), timed.getHours(), timed.getMinutes()], [2026, 9, 9, 14, 30]);
  const allDay = new Date(dueInstant("2026-10-09", ""));
  assert.deepEqual([allDay.getDate(), allDay.getHours(), allDay.getMinutes()], [9, 0, 0]);
});
