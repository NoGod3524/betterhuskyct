import assert from "node:assert/strict";
import { test } from "node:test";
import { recordGradeChanges, recordSyncChanges } from "../src/lib/change-producers.ts";
import { parseChanges, type ChangesStore } from "../src/lib/changes.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { mergeSyncPayload } from "../src/lib/sync-merge.ts";
import { buildSyncPayload, type SyncPayload } from "../src/lib/sync.ts";
import type { CalendarTask } from "../src/lib/calendar-types.ts";
import type { Announcement } from "../src/lib/announcements.ts";
import type { GradesSnapshot } from "../src/lib/grades.ts";
import type { Subscription } from "../src/lib/subscriptions.ts";

const NOW = new Date(2026, 9, 16, 12);
const empty = (): ChangesStore => ({ version: 1, entries: [], baselines: [] });
const task = (uid: string, start = "2026-10-20T12:00:00"): CalendarTask => ({
  id: `${uid}:${start}`, title: "Homework 4", course: "MATH 1131Q", start,
  dateKey: start.slice(0, 10), end: null, allDay: false, location: null, kind: "assignment",
});
const before = (events: CalendarTask[] = [], announcements: Announcement[] = []) => ({
  subscriptions: events.length ? [{ id: "local", name: "Course deadlines", courseId: null, importedAt: NOW.toISOString(), events }] as Subscription[] : [],
  announcements, courses: EMPTY_COURSE_BOOK, doneByHuskyct: new Map(), completedIds: new Set<string>(),
});
const payload = (events: CalendarTask[], announcements: Announcement[] = [], seconds = 0) => buildSyncPayload({
  feeds: [{ name: "Course deadlines", courseId: null, importedAt: NOW.toISOString(), events }],
  completedIds: [], courses: EMPTY_COURSE_BOOK, announcements, now: new Date(+NOW + seconds * 1000),
});
const apply = (store: ChangesStore, local: ReturnType<typeof before>, incoming: SyncPayload) => {
  const merged = mergeSyncPayload(local, incoming);
  return recordSyncChanges(store, local, merged, incoming, NOW);
};

test("a course's first deadline reading is a baseline, a second records additions and moves once", () => {
  const first = task("huskyct-todo-_1_1");
  const baseline = apply(empty(), before(), payload([first, task("huskyct-todo-_99_1")]));
  assert.equal(baseline.entries.length, 0);
  const moved = task("huskyct-todo-_1_1", "2026-10-22T12:00:00");
  const added = task("huskyct-todo-_2_1");
  const incoming = payload([moved, added], [], 60);
  const changes = apply(baseline, before([first]), incoming);
  assert.deepEqual(changes.entries.map((entry) => entry.kind).sort(), ["deadline-added", "deadline-moved"]);
  const repeated = apply(changes, before([moved, added]), incoming);
  assert.equal(repeated.entries.length, 2);
  const newCourse = { ...added, id: "huskyct-todo-_3_1:2026-10-20T12:00:00", course: "ECON 1201" };
  assert.equal(apply(changes, before([moved, added]), payload([moved, added, newCourse], [], 120)).entries.length, 2);
});

test("an empty successful course reading establishes a baseline, a failed one does not", () => {
  const incoming = payload([]);
  const local = before();
  const report = { dueDates: true, todo: true, courses: [{ id: "_1_1", code: "MATH 1131Q", announcements: true, grades: false, files: false }] };
  const baseline = recordSyncChanges(empty(), local, mergeSyncPayload(local, incoming), incoming, NOW, report);
  const next = payload([task("huskyct-todo-_1_1")], [announcement("one")], 60);
  assert.deepEqual(apply(baseline, local, next).entries.map((entry) => entry.kind).sort(), ["announcement-new", "deadline-added"]);
  const failed = recordSyncChanges(empty(), local, mergeSyncPayload(local, incoming), incoming, NOW,
    { ...report, dueDates: false, todo: false, courses: [{ ...report.courses[0], announcements: false }] });
  assert.equal(apply(failed, local, next).entries.length, 0);
});

test("all-day deadline history keeps the calendar date rather than a timezone-shifted midnight", () => {
  const original = { ...task("huskyct-todo-_4_1", "2026-10-20T00:00:00.000Z"), allDay: true };
  const moved = { ...task("huskyct-todo-_4_1", "2026-10-22T00:00:00.000Z"), allDay: true };
  const changes = apply(empty(), before([original]), payload([moved], [], 60));
  assert.deepEqual(changes.entries[0].detail, { from: "2026-10-20", to: "2026-10-22" });
});

function announcement(id: string, body = "Homework opens on October 20."): Announcement {
  return { id, sourceId: id, sourceCourseId: "_1_1", courseId: null, courseCode: "MATH 1131Q", title: "Homework details", body,
    posted: NOW.toISOString(), announced: NOW.toISOString() };
}

test("announcement edits keep their identity and repeated sync does not make another entry", () => {
  const old = announcement("one");
  const changed = announcement("one", "Homework now opens on October 22.");
  const incoming = payload([], [changed, announcement("two")], 60);
  const changes = apply(empty(), before([], [old]), incoming);
  assert.deepEqual(changes.entries.map((entry) => entry.kind).sort(), ["announcement-edited", "announcement-new"]);
  assert.equal(apply(changes, before([], incoming.announcements), incoming).entries.length, 2);
});

function grades(score: number | null, revision: number, status: string | null = null): GradesSnapshot {
  return { version: 1, term: "Fall 2026", takenAt: new Date(+NOW + revision * 1000).toISOString(), courses: [{
    id: "_10_1", code: "MATH 1131Q", items: [{ id: "_1_1", title: "Homework 4", status,
      earned: score, possible: score === null ? null : 100, label: null }],
  }] };
}

test("grades record actual transitions rather than replaying accumulated unseen changes", () => {
  let store = recordGradeChanges(empty(), null, grades(80, 1), NOW);
  assert.equal(store.entries.length, 0);
  let previous = grades(80, 1);
  for (const [i, score] of [90, 80, 90].entries()) {
    const next = grades(score, i + 2);
    store = recordGradeChanges(store, previous, next, NOW);
    previous = next;
  }
  assert.equal(store.entries.filter((entry) => entry.kind === "grade").length, 3);
  assert.equal(recordGradeChanges(store, previous, { ...previous, changes: [] }, NOW).entries.length, 3);
  assert.equal(recordGradeChanges(store, previous, { ...previous, courses: [{ ...previous.courses[0], id: "_20_1" }] }, NOW).entries.length, 3);
});

test("grade and deadline deliveries describe one HuskyCT completion", () => {
  const first = task("huskyct-todo-_1_1");
  const old = grades(null, 1);
  const next = grades(null, 2, "Submitted");
  const fromGrade = recordGradeChanges(empty(), old, next, NOW);
  assert.equal(fromGrade.entries.length, 1);
  const incoming = { ...payload([first], [], 3), doneByHuskyct: { [first.id]: "submitted" as const } };
  const together = apply(fromGrade, before([first]), incoming);
  assert.equal(together.entries.filter((entry) => entry.kind === "done-by-huskyct").length, 1);
  assert.equal(parseChanges(JSON.stringify(together), NOW).entries.length, 1);
});
