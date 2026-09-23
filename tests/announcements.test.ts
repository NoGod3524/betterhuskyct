import assert from "node:assert/strict";
import test from "node:test";

import {
  ANNOUNCEMENTS_STORAGE_KEY,
  MAX_ANNOUNCEMENT_BODY,
  computeAnnouncementId,
  isAnnouncement,
  parseAnnouncementCandidates,
  parseStoredAnnouncements,
  restoreAnnouncements,
  saveAnnouncements,
  serializeAnnouncements,
  sortAnnouncements,
  type Announcement,
} from "../src/lib/announcements.ts";

const NOW = new Date("2026-09-23T12:00:00.000Z");

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    courseCode: "NRE 1000E",
    title: "Midterm moved",
    body: "The midterm moves to the 14th.",
    posted: "9/17/26, 4:47 PM",
    announced: "2026-09-23T10:00:00.000Z",
    ...overrides,
  };
}

function taken(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: "abc12345",
    courseId: null,
    courseCode: "NRE 1000E",
    title: "Midterm moved",
    body: "The midterm moves to the 14th.",
    posted: "9/17/26, 4:47 PM",
    announced: "2026-09-23T10:00:00.000Z",
    ...overrides,
  };
}

// ----------------------------------------------------------------- identity

test("the same announcement collected twice keeps one id", () => {
  const first = computeAnnouncementId({
    courseCode: "NRE 1000E",
    title: "Midterm moved",
    posted: "9/17/26, 4:47 PM",
  });
  const second = computeAnnouncementId({
    courseCode: "NRE 1000E",
    title: "Midterm moved",
    posted: "9/17/26, 4:47 PM",
  });

  assert.equal(first, second);
});

test("the id does not depend on which device collected it", () => {
  // Course ids are per-device UUIDs, so the code is the only shared handle. If
  // this ever became id-based, the same announcement would double on sync.
  const here = parseAnnouncementCandidates([candidate()], NOW)[0];
  const there = parseAnnouncementCandidates([candidate()], NOW)[0];

  assert.equal(here.id, there.id);
});

test("a different title or posted time is a different announcement", () => {
  const base = computeAnnouncementId({
    courseCode: "NRE 1000E",
    title: "Midterm moved",
    posted: "9/17/26, 4:47 PM",
  });

  assert.notEqual(
    base,
    computeAnnouncementId({
      courseCode: "NRE 1000E",
      title: "Midterm moved again",
      posted: "9/17/26, 4:47 PM",
    }),
  );
  assert.notEqual(
    base,
    computeAnnouncementId({
      courseCode: "NRE 1000E",
      title: "Midterm moved",
      posted: "9/18/26, 9:00 AM",
    }),
  );
});

// ---------------------------------------------------------------- ingestion

test("a row with no title is dropped, because a title is the whole announcement", () => {
  const parsed = parseAnnouncementCandidates(
    [candidate({ title: "   " }), candidate({ title: "Kept" })],
    NOW,
  );

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, "Kept");
});

test("whitespace is collapsed the way the helper already collapses it", () => {
  const [parsed] = parseAnnouncementCandidates(
    [candidate({ body: "  two\n\nlines   here  " })],
    NOW,
  );

  assert.equal(parsed.body, "two lines here");
});

test("a missing posted time is null rather than an invented date", () => {
  const [parsed] = parseAnnouncementCandidates([candidate({ posted: "" })], NOW);

  assert.equal(parsed.posted, null);
});

test("a missing announced time falls back to the given now, not the wall clock", () => {
  const [parsed] = parseAnnouncementCandidates(
    [{ title: "No timestamp", announced: "not a date" }],
    NOW,
  );

  assert.equal(parsed.announced, NOW.toISOString());
});

test("a body is capped so one long announcement cannot fill the link", () => {
  const [parsed] = parseAnnouncementCandidates(
    [candidate({ body: "x".repeat(MAX_ANNOUNCEMENT_BODY + 500) })],
    NOW,
  );

  assert.equal(parsed.body.length, MAX_ANNOUNCEMENT_BODY);
});

test("a batch that repeats itself collapses to one row", () => {
  const parsed = parseAnnouncementCandidates([candidate(), candidate()], NOW);

  assert.equal(parsed.length, 1);
});

test("a later copy of a row in the same batch wins, because it is the fuller one", () => {
  const parsed = parseAnnouncementCandidates(
    [candidate({ body: "" }), candidate({ body: "Filled in" })],
    NOW,
  );

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].body, "Filled in");
});

test("anything that is not an array of records reads as nothing at all", () => {
  assert.deepEqual(parseAnnouncementCandidates(undefined, NOW), []);
  assert.deepEqual(parseAnnouncementCandidates("nope", NOW), []);
  assert.deepEqual(parseAnnouncementCandidates([null, 7, "x"], NOW), []);
});

// ------------------------------------------------------------------ storage

test("saved announcements come back", () => {
  const storage = new MemoryStorage();
  saveAnnouncements(storage, [taken()]);

  const restored = restoreAnnouncements(storage);

  assert.equal(restored.recoveredFromCorruptData, false);
  assert.equal(restored.announcements.length, 1);
  assert.equal(restored.announcements[0].title, "Midterm moved");
});

test("unreadable saved announcements are cleared, not left to fail every load", () => {
  const storage = new MemoryStorage();
  storage.setItem(ANNOUNCEMENTS_STORAGE_KEY, "{ not json");

  const restored = restoreAnnouncements(storage);

  assert.equal(restored.recoveredFromCorruptData, true);
  assert.equal(storage.getItem(ANNOUNCEMENTS_STORAGE_KEY), null);
});

test("a stored row missing a required field invalidates the whole store", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      announcements: [{ id: "x", title: "No body, no course, no date" }],
    }),
  );

  assert.equal(parseStoredAnnouncements(storage.getItem(ANNOUNCEMENTS_STORAGE_KEY)!), null);
});

test("the stored version is checked, so a future shape is not half-read", () => {
  const raw = JSON.stringify({ version: 2, announcements: [taken()] });

  assert.equal(parseStoredAnnouncements(raw), null);
});

test("a round trip through the serialiser is unchanged", () => {
  const list = [taken(), taken({ id: "def67890", title: "Second" })];
  const raw = serializeAnnouncements(list);

  assert.deepEqual(parseStoredAnnouncements(raw), list);
});

// ------------------------------------------------------------------ ordering

test("newest first", () => {
  const sorted = sortAnnouncements([
    taken({ id: "old", announced: "2026-09-01T10:00:00.000Z" }),
    taken({ id: "new", announced: "2026-09-20T10:00:00.000Z" }),
  ]);

  assert.deepEqual(
    sorted.map((entry) => entry.id),
    ["new", "old"],
  );
});

test("rows collected in the same millisecond still have one fixed order", () => {
  // One page read stamps every row identically, so the sort has to break the tie
  // itself or the list reshuffles between loads and reads as a bug.
  const same = "2026-09-23T10:00:00.000Z";
  const forwards = sortAnnouncements([
    taken({ id: "b", title: "Beta", announced: same }),
    taken({ id: "a", title: "Alpha", announced: same }),
  ]);
  const backwards = sortAnnouncements([
    taken({ id: "a", title: "Alpha", announced: same }),
    taken({ id: "b", title: "Beta", announced: same }),
  ]);

  assert.deepEqual(
    forwards.map((entry) => entry.title),
    ["Alpha", "Beta"],
  );
  assert.deepEqual(
    backwards.map((entry) => entry.title),
    ["Alpha", "Beta"],
  );
});

test("the guard accepts what the parser produces and rejects a half row", () => {
  const [good] = parseAnnouncementCandidates([candidate()], NOW);

  assert.equal(isAnnouncement(good), true);
  assert.equal(isAnnouncement({ ...good, announced: "whenever" }), false);
  assert.equal(isAnnouncement({ ...good, id: "" }), false);
});
