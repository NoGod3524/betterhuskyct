import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import type { CourseBook } from "../src/lib/courses.ts";
import { LINK_ANNOUNCEMENTS, LINK_BODY_CHARS, LINK_VERSION } from "../src/lib/sync-compact.ts";
import { buildSyncPayload, encodeSyncPayload, decodeSyncPayload, parseSyncPayload, serialiseSyncPayload } from "../src/lib/sync.ts";

const NOW = new Date("2026-09-16T12:00:00.000Z");

function task(id: string, overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id,
    title: id,
    course: null,
    start: "2026-09-18T23:59:00.000Z",
    dateKey: null,
    end: null,
    allDay: false,
    location: null,
    ...overrides,
  };
}

const book = (): CourseBook => ({
  courses: [
    { id: "uuid-a", code: "NRE 1000E", component: "LEC", isDefault: true },
    { id: "uuid-b", code: "MATH 1070Q", component: null, isDefault: false },
  ],
  assignments: {},
});

function link(overrides: Record<string, unknown> = {}) {
  return buildSyncPayload({
    feeds: [{ name: "Term", courseId: null, importedAt: NOW.toISOString(), events: [] }],
    completedIds: [],
    efforts: {},
    courses: book(),
    now: NOW,
    ...overrides,
  } as never);
}

test("a link is the compact shape, marked as version 2", () => {
  const raw = JSON.parse(serialiseSyncPayload(link()));
  assert.equal(raw.version, LINK_VERSION);
});

test("an event whose start is not a whole minute keeps its exact start", () => {
  const payload = link({
    feeds: [{ name: "Term", courseId: null, importedAt: NOW.toISOString(), events: [task("e1", { start: "2026-09-18T23:59:30.500Z" })] }],
  });
  const back = parseSyncPayload(serialiseSyncPayload(payload));
  assert.equal(back?.feeds[0].events[0].start, "2026-09-18T23:59:30.500Z");
});

test("an event whose id is not its UID and start keeps the whole id", () => {
  const payload = link({
    feeds: [{ name: "Term", courseId: null, importedAt: NOW.toISOString(), events: [task("custom-42")] }],
    completedIds: ["custom-42"],
  });
  const back = parseSyncPayload(serialiseSyncPayload(payload));
  assert.equal(back?.feeds[0].events[0].id, "custom-42");
  assert.deepEqual(back?.completedIds, ["custom-42"]);
});

test("an event's UID is put back together with its start into the id", () => {
  const payload = link({
    feeds: [{ name: "Term", courseId: null, importedAt: NOW.toISOString(), events: [task("_123_1@uconn:2026-09-18T23:59:00.000Z")] }],
  });
  const raw = JSON.parse(serialiseSyncPayload(payload));
  // The UID alone is stored, not the whole id.
  assert.equal(raw.events[0][0], "_123_1@uconn");
  const back = parseSyncPayload(serialiseSyncPayload(payload));
  assert.equal(back?.feeds[0].events[0].id, "_123_1@uconn:2026-09-18T23:59:00.000Z");
});

test("a course pick survives: none, no course, and a course", () => {
  const payload = link({
    feeds: [{ name: "Term", courseId: "uuid-b", importedAt: NOW.toISOString(), events: [task("a"), task("b"), task("c")] }],
    courses: {
      courses: book().courses,
      assignments: { a: "uuid-b", b: null },
    },
  });
  const back = parseSyncPayload(serialiseSyncPayload(payload));
  assert.equal(back?.courses.assignments.a, "c1", "a pick is the course by its row");
  assert.equal(back?.courses.assignments.b, null, "a row that shows no course stays so");
  assert.equal("c" in (back?.courses.assignments ?? {}), false, "a row with no pick stays without one");
  assert.equal(back?.feeds[0].courseId, "c1");
});

test("done states and reopenings point at the events by row, and read back by id", () => {
  const payload = link({
    feeds: [{ name: "Term", courseId: null, importedAt: NOW.toISOString(), events: [task("hw-1"), task("hw-2")] }],
    doneByHuskyct: new Map([["hw-1", "graded"], ["hw-2", "submitted"]]),
    reopened: new Set(["hw-2"]),
    efforts: { "hw-2": "long" },
  });
  const back = parseSyncPayload(serialiseSyncPayload(payload));
  assert.deepEqual(back?.doneByHuskyct, { "hw-1": "graded", "hw-2": "submitted" });
  assert.deepEqual(back?.reopened, ["hw-2"]);
  assert.deepEqual(back?.efforts, { "hw-2": "long" });
});

test("an announcement keeps its code, title, a preview of its body and its posting, and not its id", () => {
  const body = "x".repeat(LINK_BODY_CHARS + 50);
  const payload = link({
    announcements: [
      { id: "stored-id", courseId: "uuid-a", courseCode: "NRE 1000E", title: "Lab moved", body, posted: "9/14/26", announced: NOW.toISOString() },
    ],
  });
  const raw = JSON.parse(serialiseSyncPayload(payload));
  assert.equal(raw.announcements.length, 1);
  assert.equal(raw.announcements[0].length, 4, "code, title, preview, posted");

  const back = parseSyncPayload(serialiseSyncPayload(payload));
  assert.equal(back?.announcements[0].courseCode, "NRE 1000E");
  assert.equal(back?.announcements[0].title, "Lab moved");
  assert.equal(back?.announcements[0].body.length, LINK_BODY_CHARS);
  assert.equal(back?.announcements[0].posted, "9/14/26");
});

test("only the newest announcements are carried", () => {
  const many = Array.from({ length: LINK_ANNOUNCEMENTS + 10 }, (_, index) => ({
    id: "x" + index, courseId: null, courseCode: null, title: "T" + index, body: "", posted: null, announced: NOW.toISOString(),
  }));
  const back = parseSyncPayload(serialiseSyncPayload(link({ announcements: many })));
  assert.equal(back?.announcements.length, LINK_ANNOUNCEMENTS);
  assert.equal(back?.announcements[0].title, "T0");
});

test("a term of sixty events, forty ticks and thirty announcements fits well inside a QR code", async () => {
  const events = Array.from({ length: 60 }, (_, index) =>
    task(`_${100000 + index}_1@uconn.edu:${new Date(NOW.getTime() + index * 86_400_000).toISOString()}`, {
      title: `Homework ${index}: problem set section ${index % 7}`,
      course: index % 2 ? "NRE 1000E" : "MATH 1070Q",
      start: new Date(NOW.getTime() + index * 86_400_000).toISOString(),
    }),
  );
  const payload = link({
    feeds: [{ name: "Term", courseId: null, importedAt: NOW.toISOString(), events }],
    completedIds: events.slice(0, 40).map((event) => event.id),
    courses: { courses: book().courses, assignments: Object.fromEntries(events.map((event) => [event.id, "uuid-a"])) },
    announcements: Array.from({ length: 30 }, (_, index) => ({
      id: "a" + index, courseId: null, courseCode: "NRE 1000E", title: `Announcement ${index}`,
      body: "Course news and reminders. ".repeat(40), posted: "9/14/26", announced: NOW.toISOString(),
    })),
  });

  const packed = await encodeSyncPayload(payload);
  assert.ok(packed.length < 2_900, `the link is ${packed.length} characters, over what a QR code carries`);
  const decoded = await decodeSyncPayload(packed);
  assert.equal(decoded?.feeds[0].events.length, 60);
  assert.equal(decoded?.completedIds.length, 40);
});
