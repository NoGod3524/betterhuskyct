import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { deadlinesToRemind, foldLine, icsFileName, icsText, tasksToIcs } from "../src/lib/ics.ts";

// Local noon, so "today" is the 13th in every time zone the tests run in.
const NOW = new Date(2026, 9, 13, 12, 0, 0);
const task = (over: Partial<CalendarTask>): CalendarTask => ({
  id: "t1",
  title: "Homework 5",
  course: "MATH 1131Q",
  start: "2026-10-14T03:59:00.000Z",
  dateKey: null,
  end: null,
  allDay: false,
  location: null,
  kind: "assignment",
  ...over,
});

test("only open deadlines still ahead are exported: no class, nothing ticked off, nothing past", () => {
  const tasks = [
    task({ id: "ahead" }),
    task({ id: "done" }),
    task({ id: "past", start: "2026-10-12T03:59:00.000Z" }),
    task({ id: "class", kind: "class" }),
    task({ id: "today-all-day", allDay: true, dateKey: "2026-10-13", start: "2026-10-13T04:00:00.000Z" }),
    task({ id: "yesterday-all-day", allDay: true, dateKey: "2026-10-12", start: "2026-10-12T04:00:00.000Z" }),
  ];
  assert.deepEqual(deadlinesToRemind(tasks, new Set(["done"]), NOW).map((t) => t.id), ["ahead", "today-all-day"]);
});

test("a timed deadline ends at its due time, carries two alarms, and keeps its id across exports", () => {
  const ics = tasksToIcs([task({})], NOW);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "a line ends without CR");
  assert.match(ics, /\r\nUID:t1@betterhuskyct\r\n/);
  assert.match(ics, /\r\nSUMMARY:Due: Homework 5 \(MATH 1131Q\)\r\n/);
  assert.match(ics, /\r\nDTSTART:20261014T032900Z\r\nDTEND:20261014T035900Z\r\n/);
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 2);
  assert.match(ics, /TRIGGER;RELATED=END:-P1D/);
  assert.match(ics, /TRIGGER;RELATED=END:-PT2H/);
});

test("an all-day deadline takes its day, and is reminded the morning before", () => {
  const ics = tasksToIcs([task({ allDay: true, dateKey: "2026-10-31", start: "2026-10-31T04:00:00.000Z" })], NOW);
  assert.match(ics, /DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261101\r\n/);
  assert.match(ics, /TRIGGER:-PT15H/);
});

test("text is escaped, and long lines are folded without splitting a character", () => {
  assert.equal(icsText("a, b; c\\d\ne"), "a\\, b\\; c\\\\d\\ne");
  const long = "SUMMARY:" + "期中".repeat(40);
  const folded = foldLine(long);
  for (const line of folded.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal(folded.replace(/\r\n /g, ""), long);
  assert.equal(icsFileName(NOW), "betterhuskyct-deadlines-2026-10-13.ics");
});

test("the due time is the one the app shows, the start, even where a feed gives an end", () => {
  const ics = tasksToIcs([task({ start: "2026-10-14T02:00:00.000Z", end: "2026-10-14T02:30:00.000Z" })], NOW);
  assert.match(ics, /DTSTART:20261014T013000Z\r\nDTEND:20261014T020000Z\r\n/);
});

const exportedUids = (tasks: CalendarTask[]) => tasksToIcs(tasks, NOW).replace(/\r\n /g, "").split("\r\n").filter((line) => line.startsWith("UID:"));

test("a source-identified helper deadline keeps its export UID when renamed and rescheduled", () => {
  for (const source of ["huskyct-todo-_101_1", "huskyct-calendar-_101_1"]) {
    const first = task({ id: `${source}:2026-10-14T03:59:00.000Z` });
    const later = task({ id: `${source}:2026-10-18T03:59:00.000Z`, start: "2026-10-18T03:59:00.000Z", title: "Homework 5 (extended)" });
    assert.deepEqual(exportedUids([later]), exportedUids([first]));
    assert.deepEqual(exportedUids([{ ...later, id: first.id }]), exportedUids([first]), "a local time edit keeps the original task id");
    assert.deepEqual(exportedUids([first]), [`UID:${source}@betterhuskyct`]);
  }
});

test("same-title deadlines with distinct helper source ids stay separate export events", () => {
  const first = task({ id: "huskyct-todo-_101_1:2026-10-14T03:59:00.000Z" });
  const second = task({ id: "huskyct-todo-_102_1:2026-10-14T03:59:00.000Z" });
  assert.equal(new Set(exportedUids([first, second])).size, 2);
});

test("recurring source instances keep independent UIDs when reordered or exported alone", () => {
  const first = task({ id: "weekly-reading:2026-10-14T03:59:00.000Z" });
  const next = task({ id: "weekly-reading:2026-10-21T03:59:00.000Z", start: "2026-10-21T03:59:00.000Z" });
  const together = exportedUids([first, next]);
  assert.equal(new Set(together).size, 2);
  assert.deepEqual(exportedUids([next, first]), [...together].reverse());
  assert.deepEqual(exportedUids([next]), [together[1]]);
});

test("legacy Calendar title identities never imply that different dates are one export event", () => {
  const uid = "huskyct-due-_203765_1-Weekly-Reading";
  const first = task({ id: `${uid}:2026-10-14T03:59:00.000Z` });
  const next = task({ id: `${uid}:2026-10-21T03:59:00.000Z`, start: "2026-10-21T03:59:00.000Z" });
  assert.notDeepEqual(exportedUids([first]), exportedUids([next]));
  assert.equal(new Set(exportedUids([first, next])).size, 2);
});
