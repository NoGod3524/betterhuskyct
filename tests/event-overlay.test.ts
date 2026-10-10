import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import {
  applyOverlay,
  deleteEvent,
  EMPTY_OVERLAY,
  noteFor,
  parseEventOverlay,
  restoreEvent,
  setEventEdit,
  type EventOverlay,
} from "../src/lib/event-overlay.ts";

function task(id: string, overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id,
    title: id,
    course: "MATH 1070Q",
    start: "2026-09-18T23:59:00.000Z",
    dateKey: null,
    end: null,
    allDay: false,
    location: null,
    kind: "assignment",
    ...overrides,
  };
}

test("with no overlay, the feed's tasks pass through untouched", () => {
  const tasks = [task("a"), task("b")];
  assert.equal(applyOverlay(tasks, EMPTY_OVERLAY), tasks);
});

test("an edit changes only the fields it names", () => {
  const overlay = setEventEdit(EMPTY_OVERLAY, "a", { title: "Renamed" });
  const [out] = applyOverlay([task("a", { location: "Room 101" })], overlay);
  assert.equal(out.title, "Renamed");
  assert.equal(out.location, "Room 101", "an untouched field was overwritten");
});

test("moving a timed task to all-day sets its date key from the new start", () => {
  const overlay = setEventEdit(EMPTY_OVERLAY, "a", { start: "2026-09-20T00:00:00.000Z", allDay: true });
  const [out] = applyOverlay([task("a")], overlay);
  assert.equal(out.allDay, true);
  assert.equal(out.dateKey, "2026-09-20");
});

test("an all-day edit keeps the day it names, whatever zone its start falls in", () => {
  // The 16th, as an editor in Auckland saves it: local midnight, which is the 15th in UTC.
  const edit = { start: "2026-10-15T11:00:00.000Z", dateKey: "2026-10-16", allDay: true };
  const [out] = applyOverlay([task("a", { start: "2026-10-15T00:00:00.000Z", dateKey: "2026-10-15", allDay: true })], setEventEdit(EMPTY_OVERLAY, "a", edit));
  assert.equal(out.dateKey, "2026-10-16");
  // An edit that only retitles an all-day event leaves its day alone.
  const [kept] = applyOverlay([task("a", { start: "2026-10-15T00:00:00.000Z", dateKey: "2026-10-15", allDay: true })], setEventEdit(EMPTY_OVERLAY, "a", { title: "New name", allDay: true }));
  assert.equal(kept.dateKey, "2026-10-15");
  // A timed event has no day key, even if the edit carried one.
  const [timed] = applyOverlay([task("a")], setEventEdit(EMPTY_OVERLAY, "a", { dateKey: "2026-10-16", allDay: false }));
  assert.equal(timed.dateKey, null);
});

test("an edit's day key is kept by the parser, and one that is not a day is a malformed edit", () => {
  const ok = parseEventOverlay({ edits: { a: { dateKey: "2026-10-16", allDay: true } }, deletedIds: [] });
  assert.equal(ok?.edits.a.dateKey, "2026-10-16");
  assert.equal(parseEventOverlay({ edits: { a: { dateKey: "Oct 16" } }, deletedIds: [] })?.edits.a, undefined);
});

test("a deleted task is dropped, an untouched one is not", () => {
  const overlay = deleteEvent(EMPTY_OVERLAY, "a");
  const out = applyOverlay([task("a"), task("b")], overlay);
  assert.deepEqual(out.map((t) => t.id), ["b"]);
});

test("deleting the same task twice stays one entry", () => {
  const overlay = deleteEvent(deleteEvent(EMPTY_OVERLAY, "a"), "a");
  assert.deepEqual(overlay.deletedIds, ["a"]);
});

test("restoring a task clears both its edit and its deletion", () => {
  let overlay = setEventEdit(EMPTY_OVERLAY, "a", { title: "Renamed" });
  overlay = deleteEvent(overlay, "a");
  overlay = restoreEvent(overlay, "a");

  const [out] = applyOverlay([task("a")], overlay);
  assert.equal(out.title, "a");
  assert.equal(noteFor(overlay, "a"), null);
});

test("a note rides along with an edit and is read back by id", () => {
  const overlay = setEventEdit(EMPTY_OVERLAY, "a", { note: "bring a calculator" });
  assert.equal(noteFor(overlay, "a"), "bring a calculator");
  // A note alone is not a visible field change, so the task itself is untouched.
  const [out] = applyOverlay([task("a")], overlay);
  assert.equal(out.title, "a");
});

// --- what is accepted from storage --------------------------------------------------

test("a well-formed overlay round-trips through the parser", () => {
  const overlay: EventOverlay = {
    edits: { a: { title: "Renamed", note: "bring ID" } },
    deletedIds: ["b"],
  };
  assert.deepEqual(parseEventOverlay(JSON.parse(JSON.stringify(overlay))), overlay);
});

test("a shape that is not an overlay at all reads as nothing", () => {
  assert.equal(parseEventOverlay(null), null);
  assert.equal(parseEventOverlay({ edits: {}, deletedIds: [1, 2] }), null);
});

test("one malformed edit is dropped on its own, not the whole overlay", () => {
  const parsed = parseEventOverlay({
    edits: { a: { start: "not a date" }, b: { title: "Renamed" } },
    deletedIds: ["c"],
  });
  assert.deepEqual(parsed, { edits: { b: { title: "Renamed" } }, deletedIds: ["c"] });
});

test("duplicate deleted ids from an older write collapse to one", () => {
  const parsed = parseEventOverlay({ edits: {}, deletedIds: ["a", "a", "b"] });
  assert.deepEqual(parsed?.deletedIds.sort(), ["a", "b"]);
});
