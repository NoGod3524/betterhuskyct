import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import {
  parseAnnouncementCandidates,
  type Announcement,
} from "../src/lib/announcements.ts";
import { EMPTY_COURSE_BOOK, addCourse, type CourseBook } from "../src/lib/courses.ts";
import type { Subscription } from "../src/lib/subscriptions.ts";
import {
  buildSyncPayload,
  parseSyncPayload,
  serialiseSyncPayload,
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

    importedAt: "2026-09-16T11:00:00.000Z",
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
    courses: bookWith("NRE 1000E"),
    now: NOW,
    ...overrides,
  });
}

test("a whole dashboard is written out and read back the same", () => {
  const payload = payloadOf();

  const back = parseSyncPayload(serialiseSyncPayload(payload));

  assert.deepEqual(back, payload);
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

test("an older link's effort marks are let go, and the link is still read", () => {
  const raw = JSON.parse(serialiseSyncPayload(payloadOf()));
  raw.efforts = { a: "medium", b: "enormous" };

  const parsed = parseSyncPayload(JSON.stringify(raw));
  assert.ok(parsed, "an older link was refused for carrying effort marks");
  assert.equal("efforts" in parsed, false);
  assert.ok(parseSyncPayload(JSON.stringify({ ...raw, efforts: null })), "a link was refused over a field nothing reads");
});

test("merging adds ticks and never removes one", () => {
  const local = {
    courses: EMPTY_COURSE_BOOK,
    completedIds: new Set(["keep-me"]),
    subscriptions: [],
  };

  const merged = mergeSyncPayload(local, payloadOf({ completedIds: ["a"] }));

  assert.deepEqual([...merged.completedIds].sort(), ["a", "keep-me"]);
});

test("merging brings the calendar across as a new subscription", () => {
  const merged = mergeSyncPayload(
    { courses: EMPTY_COURSE_BOOK, completedIds: new Set(), subscriptions: [] },
    payloadOf(),
  );

  assert.equal(merged.addedFeeds, 1);
  assert.equal(merged.subscriptions.length, 1);
  assert.equal(merged.subscriptions[0].name, "NRE 1000E");
  assert.equal(merged.subscriptions[0].events.length, 2);
  // The password never travels, so the synced copy has no link to refresh.
  assert.ok(!("url" in merged.subscriptions[0]));
});

test("a calendar already on this device keeps its identity and is not duplicated", () => {
  const existing = feed("local-1", [task("a"), task("b")], { name: "Mine" });

  const merged = mergeSyncPayload(
    {
      courses: EMPTY_COURSE_BOOK,
      completedIds: new Set(),
      subscriptions: [existing],
    },
    payloadOf(),
  );

  assert.equal(merged.addedFeeds, 0);
  assert.equal(merged.subscriptions.length, 1);
  assert.equal(merged.subscriptions[0].name, "Mine");
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

// -------------------------------------------------------------- announcements

function announced(title: string, patch: Record<string, unknown> = {}) {
  return {
    courseCode: "NRE 1000E",
    title,
    body: `${title} body`,
    posted: "9/17/26, 4:47 PM",
    announced: "2026-09-23T10:00:00.000Z",
    ...patch,
  };
}

/** One already-held announcement, as the merge would find it on this device. */
function takenAnnouncement(title: string, announcedAt: string): Announcement {
  const [parsed] = parseAnnouncementCandidates(
    [
      {
        courseCode: "NRE 1000E",
        title,
        body: `${title} body`,
        posted: "9/17/26, 4:47 PM",
        announced: announcedAt,
      },
    ],
    NOW,
  );
  return parsed;
}

/**
 * The compatibility case, and the reason `SYNC_VERSION` did not move.
 *
 * Every helper installed before announcements existed sends `version: 1` with no
 * `announcements` key at all. Bumping the version would have made each of those
 * links fail whole. This is the test that keeps that decision honest.
 */
test("a link from a helper written before announcements still reads", () => {
  const legacy = {
    version: 1,
    exportedAt: NOW.toISOString(),
    feeds: [
      {
        name: "HuskyCT to-do",
        courseId: null,
        importedAt: NOW.toISOString(),
        events: [task("a")],
      },
    ],
    completedIds: [],
    courses: { version: 1, courses: [], assignments: {} },
  };

  const parsed = parseSyncPayload(JSON.stringify(legacy));

  assert.ok(parsed, "an older helper's link was rejected");
  assert.deepEqual(parsed.announcements, []);
  assert.equal(parsed.feeds.length, 1);
});

test("announcements survive being written out and read back", () => {
  const payload = payloadOf({ announcements: parseAnnouncementCandidates([announced("Midterm moved")]) });
  const decoded = parseSyncPayload(serialiseSyncPayload(payload));

  assert.equal(decoded?.announcements.length, 1);
  assert.equal(decoded?.announcements[0].title, "Midterm moved");
});

test("a malformed announcement is skipped without taking the term down with it", () => {
  const raw = JSON.parse(serialiseSyncPayload(payloadOf()));
  raw.announcements = [{ title: "Good" }, { body: "no title at all" }, "junk"];

  const parsed = parseSyncPayload(JSON.stringify(raw));

  assert.ok(parsed, "one bad row rejected the whole link");
  assert.equal(parsed.announcements.length, 1);
  assert.equal(parsed.announcements[0].title, "Good");
});

test("merging unions announcements and never removes one already here", () => {
  const localAnnouncement = takenAnnouncement("Older", "2026-09-01T10:00:00.000Z");
  const incoming = parseAnnouncementCandidates([
    announced("Newer", { announced: "2026-09-22T10:00:00.000Z" }),
  ]);

  const merged = mergeSyncPayload(
    {
      courses: EMPTY_COURSE_BOOK,
      completedIds: new Set(),
      subscriptions: [],
      announcements: [localAnnouncement],
    },
    payloadOf({ announcements: incoming }),
  );

  assert.equal(merged.announcements.length, 2);
  assert.equal(merged.addedAnnouncements, 1);
  // Newest first, so the incoming one leads.
  assert.equal(merged.announcements[0].title, "Newer");
});

test("re-syncing the same announcement converges instead of doubling it", () => {
  const incoming = parseAnnouncementCandidates([announced("Midterm moved")]);

  const merged = mergeSyncPayload(
    {
      courses: EMPTY_COURSE_BOOK,
      completedIds: new Set(),
      subscriptions: [],
      announcements: incoming,
    },
    payloadOf({ announcements: incoming }),
  );

  assert.equal(merged.announcements.length, 1);
  assert.equal(merged.addedAnnouncements, 0);
});

test("a fuller second reading replaces the thin first one", () => {
  const first = parseAnnouncementCandidates([announced("Midterm moved", { body: "" })]);
  const second = parseAnnouncementCandidates([
    announced("Midterm moved", { body: "The midterm moves to the 14th." }),
  ]);

  const merged = mergeSyncPayload(
    {
      courses: EMPTY_COURSE_BOOK,
      completedIds: new Set(),
      subscriptions: [],
      announcements: first,
    },
    payloadOf({ announcements: second }),
  );

  assert.equal(merged.announcements.length, 1);
  assert.equal(merged.announcements[0].body, "The midterm moves to the 14th.");
});

test("an announcement finds its course by code, not by id", () => {
  const localBook = bookWith("NRE 1000E");
  const incoming = parseAnnouncementCandidates([announced("Midterm moved")]);

  const merged = mergeSyncPayload(
    {
      courses: localBook,
      completedIds: new Set(),
      subscriptions: [],
      announcements: [],
    },
    payloadOf({ announcements: incoming }),
  );

  assert.equal(merged.announcements[0].courseId, localBook.courses[0].id);
});

test("an ambiguous course code picks nothing rather than guessing", () => {
  // The same code with two different components is a real thing here, and a row
  // that shows the code is honest where a wrong pick is not.
  const localBook = addCourse(addCourse(EMPTY_COURSE_BOOK, "NRE 1000E", "LEC"), "NRE 1000E", "DIS");
  assert.equal(localBook.courses.length, 2);
  const incoming = parseAnnouncementCandidates([announced("Midterm moved")]);

  const merged = mergeSyncPayload(
    {
      courses: localBook,
      completedIds: new Set(),
      subscriptions: [],
      announcements: [],
    },
    payloadOf({ announcements: incoming }),
  );

  assert.equal(merged.announcements[0].courseId, null);
  assert.equal(merged.announcements[0].courseCode, "NRE 1000E");
});

test("an announcement for a course this device has never heard of is still shown", () => {
  const incoming = parseAnnouncementCandidates([
    announced("Midterm moved", { courseCode: "SOCI 1501" }),
  ]);

  const merged = mergeSyncPayload(
    {
      courses: EMPTY_COURSE_BOOK,
      completedIds: new Set(),
      subscriptions: [],
      announcements: [],
    },
    payloadOf({ announcements: incoming }),
  );

  assert.equal(merged.announcements.length, 1);
  assert.equal(merged.announcements[0].courseId, null);
  assert.equal(merged.announcements[0].courseCode, "SOCI 1501");
});

test("a course code matches regardless of case or odd spacing", () => {
  // The catalogue and the page disagree about case, and a code can arrive with a
  // run of whitespace in it. Matching on a bare lowercase comparison would miss
  // the course and show the raw code instead of the user's own name for it.
  const localBook = bookWith("MATH 1070Q");
  const incoming = parseAnnouncementCandidates([
    announced("Midterm moved", { courseCode: "  math   1070q  " }),
  ]);

  const merged = mergeSyncPayload(
    {
      courses: localBook,
      completedIds: new Set(),
      subscriptions: [],
      announcements: [],
    },
    payloadOf({ announcements: incoming }),
  );

  assert.equal(merged.announcements[0].courseId, localBook.courses[0].id);
});
