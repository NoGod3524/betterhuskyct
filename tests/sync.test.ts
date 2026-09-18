import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { EMPTY_COURSE_BOOK, addCourse, type CourseBook } from "../src/lib/courses.ts";
import type { Subscription } from "../src/lib/subscriptions.ts";
import {
  SYNC_FRAGMENT,
  buildSyncPayload,
  decodeSyncPayload,
  describeSync,
  encodeSyncPayload,
  packSync,
  parseSyncPayload,
  readSyncFragment,
  serialiseSyncPayload,
  syncLink,
  unpackSync,
} from "../src/lib/sync.ts";
import { mergeSyncPayload } from "../src/lib/sync-merge.ts";

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
    kind: "assignment",
    ...overrides,
  };
}

function bookWith(...codes: string[]): CourseBook {
  return codes.reduce(
    (book, code) => addCourse(book, code, "LEC"),
    EMPTY_COURSE_BOOK,
  );
}

function feed(id: string, events: CalendarTask[], patch: Partial<Subscription> = {}): Subscription {
  return {
    id,
    name: `Calendar ${id}`,
    courseId: null,
    url: null,
    importedAt: "2026-09-16T11:00:00.000Z",
    lastError: null,
    events,
    ...patch,
  };
}

function payloadOf(overrides: Partial<Parameters<typeof buildSyncPayload>[0]> = {}) {
  return buildSyncPayload({
    feeds: [
      {
        name: "NRE 1000E",
        courseId: null,
        importedAt: "2026-09-16T11:00:00.000Z",
        events: [task("a"), task("b")],
      },
    ],
    completedIds: ["a"],
    efforts: { a: "medium" },
    courses: bookWith("NRE 1000E"),
    now: NOW,
    ...overrides,
  });
}

test("pack and unpack survive a round trip", async () => {
  const text = JSON.stringify({ hello: "world", repeated: "x".repeat(500) });

  const packed = await packSync(text);

  assert.ok(packed.length > 0);
  assert.ok(!/[+/=]/.test(packed), "packed data must be URL-safe");
  assert.equal(await unpackSync(packed), text);
});

test("a whole dashboard encodes and decodes", async () => {
  const payload = payloadOf();

  const packed = await encodeSyncPayload(payload);
  const back = await decodeSyncPayload(packed);

  assert.deepEqual(back, payload);
});

test("a full dashboard stays small enough to send", async () => {
  const events = Array.from({ length: 60 }, (_, index) =>
    task(`_blackboard.platform.gradebook2.GradableItem-_${index}_1`),
  );
  const payload = payloadOf({
    feeds: [
      {
        name: "NRE 1000E",
        courseId: null,
        importedAt: "2026-09-16T11:00:00.000Z",
        events,
      },
    ],
    completedIds: events.slice(0, 20).map((event) => event.id),
  });

  const packed = await encodeSyncPayload(payload);

  // The whole point of the design: it fits in a URL with room to spare.
  assert.ok(packed.length < 8000, `packed payload was ${packed.length} characters`);
});

test("a payload from a different version is refused", () => {
  const raw = JSON.parse(serialiseSyncPayload(payloadOf()));
  raw.version = 99;

  assert.equal(parseSyncPayload(JSON.stringify(raw)), null);
});

test("a malformed payload is refused rather than half-applied", () => {
  const good = JSON.parse(serialiseSyncPayload(payloadOf()));

  assert.equal(parseSyncPayload("{not json"), null);
  assert.equal(parseSyncPayload(JSON.stringify({ ...good, exportedAt: "nope" })), null);
  assert.equal(parseSyncPayload(JSON.stringify({ ...good, feeds: "no" })), null);
  assert.equal(parseSyncPayload(JSON.stringify({ ...good, completedIds: [1, 2] })), null);
  assert.equal(parseSyncPayload(JSON.stringify({ ...good, efforts: null })), null);
  assert.equal(parseSyncPayload(JSON.stringify({ ...good, courses: null })), null);
  assert.equal(
    parseSyncPayload(JSON.stringify({ ...good, courses: { version: 1, courses: "no" } })),
    null,
  );
});

test("a feed with no events is dropped", () => {
  const raw = JSON.parse(serialiseSyncPayload(payloadOf()));
  raw.feeds = [
    { name: "empty", courseId: null, importedAt: raw.feeds[0].importedAt, events: [] },
    raw.feeds[0],
  ];

  const parsed = parseSyncPayload(JSON.stringify(raw));

  assert.equal(parsed?.feeds.length, 1);
  assert.equal(parsed?.feeds[0].name, "NRE 1000E");
});

test("an unknown effort level in a payload is ignored, not copied", () => {
  const raw = JSON.parse(serialiseSyncPayload(payloadOf()));
  raw.efforts = { a: "medium", b: "enormous", c: "quick" };

  assert.deepEqual(parseSyncPayload(JSON.stringify(raw))?.efforts, {
    a: "medium",
    c: "quick",
  });
});

test("a corrupt link decodes to null instead of throwing", async () => {
  assert.equal(await decodeSyncPayload("not-base64-at-all!!"), null);
  // Valid base64url, but not gzip.
  assert.equal(await decodeSyncPayload("aGVsbG8"), null);
  assert.equal(await decodeSyncPayload(""), null);
  assert.equal(await decodeSyncPayload("x".repeat(40_000)), null);
});

test("the fragment helpers only accept our own fragment", () => {
  assert.equal(readSyncFragment("#something-else"), null);
  assert.equal(readSyncFragment(""), null);
  assert.equal(readSyncFragment(SYNC_FRAGMENT), null);
  assert.equal(readSyncFragment(`${SYNC_FRAGMENT}abc`), "abc");

  assert.equal(
    syncLink("https://example.com", "/", "abc"),
    `https://example.com/${SYNC_FRAGMENT}abc`,
  );
});

test("describeSync counts what the user is being offered", () => {
  const summary = describeSync(
    payloadOf({
      feeds: [
        {
          name: "one",
          courseId: null,
          importedAt: "2026-09-16T11:00:00.000Z",
          events: [task("a"), task("lecture", { kind: "class" })],
        },
      ],
      completedIds: ["a", "b", "c"],
    }),
  );

  assert.deepEqual(summary, {
    feeds: 1,
    events: 2,
    deadlines: 1,
    completed: 3,
    courses: 1,
    efforts: 1,
  });
});

test("merging adds ticks and never removes one", () => {
  const local = {
    courses: EMPTY_COURSE_BOOK,
    efforts: {},
    completedIds: new Set(["keep-me"]),
    subscriptions: [],
  };

  const merged = mergeSyncPayload(local, payloadOf({ completedIds: ["a"] }));

  assert.deepEqual([...merged.completedIds].sort(), ["a", "keep-me"]);
});

test("merging brings the calendar across as a new subscription", () => {
  const merged = mergeSyncPayload(
    { courses: EMPTY_COURSE_BOOK, efforts: {}, completedIds: new Set(), subscriptions: [] },
    payloadOf(),
  );

  assert.equal(merged.addedFeeds, 1);
  assert.equal(merged.subscriptions.length, 1);
  assert.equal(merged.subscriptions[0].name, "NRE 1000E");
  assert.equal(merged.subscriptions[0].events.length, 2);
  // The password never travels, so the synced copy has no link to refresh.
  assert.equal(merged.subscriptions[0].url, null);
});

test("a calendar already on this device is left alone", () => {
  const existing = feed("local-1", [task("a"), task("b")], { name: "Mine" });

  const merged = mergeSyncPayload(
    {
      courses: EMPTY_COURSE_BOOK,
      efforts: {},
      completedIds: new Set(),
      subscriptions: [existing],
    },
    payloadOf(),
  );

  assert.equal(merged.addedFeeds, 0);
  assert.equal(merged.subscriptions.length, 1);
  assert.equal(merged.subscriptions[0].name, "Mine");
});

test("effort marks come from the link, because importing is a deliberate act", () => {
  const merged = mergeSyncPayload(
    {
      courses: EMPTY_COURSE_BOOK,
      efforts: { a: "long", untouched: "quick" },
      completedIds: new Set(),
      subscriptions: [],
    },
    payloadOf({ efforts: { a: "quick", b: "medium" } }),
  );

  assert.deepEqual(merged.efforts, {
    a: "quick",
    b: "medium",
    untouched: "quick",
  });
});

test("incoming courses are remapped onto the local course with the same code", () => {
  const localBook = bookWith("NRE 1000E");
  const incomingBook = bookWith("NRE 1000E");
  const incomingCourseId = incomingBook.courses[0].id;
  const localCourseId = localBook.courses[0].id;
  assert.notEqual(incomingCourseId, localCourseId);

  const merged = mergeSyncPayload(
    {
      courses: localBook,
      efforts: {},
      completedIds: new Set(),
      subscriptions: [],
    },
    payloadOf({
      courses: incomingBook,
      feeds: [
        {
          name: "NRE 1000E",
          courseId: incomingCourseId,
          importedAt: "2026-09-16T11:00:00.000Z",
          events: [task("a")],
        },
      ],
    }),
  );

  // No duplicate course, and the new calendar points at the local copy.
  assert.equal(merged.courses.courses.length, 1);
  assert.equal(merged.courses.courses[0].id, localCourseId);
  assert.equal(merged.subscriptions[0].courseId, localCourseId);
});

test("a course that is new here is added, but does not steal the default", () => {
  const localBook = bookWith("NRE 1000E");
  const incomingBook = bookWith("STAT 1000Q");

  const merged = mergeSyncPayload(
    {
      courses: localBook,
      efforts: {},
      completedIds: new Set(),
      subscriptions: [],
    },
    payloadOf({ courses: incomingBook }),
  );

  assert.equal(merged.courses.courses.length, 2);
  assert.equal(
    merged.courses.courses.find((course) => course.isDefault)?.code,
    "NRE 1000E",
  );
});

test("the incoming default is adopted when this device has none", () => {
  const incomingBook = bookWith("STAT 1000Q");

  const merged = mergeSyncPayload(
    {
      courses: { courses: [], assignments: {} },
      efforts: {},
      completedIds: new Set(),
      subscriptions: [],
    },
    payloadOf({ courses: incomingBook }),
  );

  assert.equal(merged.courses.courses[0].isDefault, true);
});

test("per-task course choices survive with the right course id", () => {
  const localBook = bookWith("NRE 1000E");
  const incomingBook = bookWith("NRE 1000E", "STAT 1000Q");
  const statIncomingId = incomingBook.courses[1].id;

  const incoming = payloadOf({ courses: incomingBook });
  const merged = mergeSyncPayload(
    {
      courses: localBook,
      efforts: {},
      completedIds: new Set(),
      subscriptions: [],
    },
    {
      ...incoming,
      courses: {
        ...incoming.courses,
        assignments: { a: statIncomingId, b: null },
      },
    },
  );

  const statLocalId = merged.courses.courses.find(
    (course) => course.code === "STAT 1000Q",
  )?.id;
  assert.equal(merged.courses.assignments.a, statLocalId);
  assert.equal(merged.courses.assignments.b, null);
});
