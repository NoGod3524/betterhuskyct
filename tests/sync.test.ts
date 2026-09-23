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
    announcements: 0,
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
    efforts: {},
    courses: { version: 1, courses: [], assignments: {} },
  };

  const parsed = parseSyncPayload(JSON.stringify(legacy));

  assert.ok(parsed, "an older helper's link was rejected");
  assert.deepEqual(parsed.announcements, []);
  assert.equal(parsed.feeds.length, 1);
});

test("announcements survive a round trip through a link", async () => {
  const payload = payloadOf({ announcements: parseAnnouncementCandidates([announced("Midterm moved")]) });
  const packed = await encodeSyncPayload(payload);
  const decoded = await decodeSyncPayload(packed);

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
      efforts: {},
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
      efforts: {},
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
      efforts: {},
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
      efforts: {},
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
      efforts: {},
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
      efforts: {},
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

test("the outgoing summary counts announcements", () => {
  const summary = describeSync(
    payloadOf({ announcements: parseAnnouncementCandidates([announced("One"), announced("Two")]) }),
  );

  assert.equal(summary.announcements, 2);
});

/**
 * The caps exist for this, and nothing else asserted them at the boundary.
 *
 * 400 announcements of 1,200 characters is the most this can ever be asked to
 * carry. Measured, that packs to 8,968 characters against a 32,768 guard, so
 * there is room — but the guard is the thing that keeps a link openable, and a
 * future cap change should have to fail here rather than in someone's browser.
 */
test("the caps keep a worst-case link inside the fragment guard", async () => {
  const at = new Date("2026-09-23T12:00:00Z");
  const full = parseAnnouncementCandidates(
    Array.from({ length: 400 }, (_, index) => ({
      courseCode: "MATH 1070Q",
      title: "Announcement " + index,
      body: "A paragraph of course news. ".repeat(60),
      posted: "9/17/26, 4:47 PM",
      announced: at.toISOString(),
    })),
    at,
  );

  assert.equal(full.length, 400);
  assert.equal(full[0].body.length, 1_200, "the body cap did not apply");

  const payload = buildSyncPayload({
    feeds: [
      {
        name: "HuskyCT to-do",
        courseId: null,
        importedAt: at.toISOString(),
        events: Array.from({ length: 120 }, (_, index) =>
          task("deadline-" + index, {
            start: new Date(Date.UTC(2026, 8, 20 + (index % 30), 3, 59)).toISOString(),
          }),
        ),
      },
    ],
    completedIds: [],
    efforts: {},
    courses: bookWith("MATH 1070Q", "STAT 1000Q", "SOCI 1501", "NRE 1000E", "ECON 1201"),
    announcements: full,
    now: at,
  });

  const packed = await encodeSyncPayload(payload);

  assert.ok(
    packed.length < 32_768,
    "worst case is over the dashboard's guard: " + packed.length,
  );
  // And it still reads back, which is the point of staying under the guard.
  const decoded = await decodeSyncPayload(packed);
  assert.equal(decoded?.announcements.length, 400);
  assert.equal(decoded?.feeds.flatMap((feed) => feed.events).length, 120);
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
      efforts: {},
      completedIds: new Set(),
      subscriptions: [],
      announcements: [],
    },
    payloadOf({ announcements: incoming }),
  );

  assert.equal(merged.announcements[0].courseId, localBook.courses[0].id);
});
