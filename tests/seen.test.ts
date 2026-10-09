import assert from "node:assert/strict";
import test from "node:test";

import { ensureAnnouncementsBaseline, markAnnouncementsSeen, markFilesSeen, parseSeenFiles, SEEN_ANNOUNCEMENTS_KEY, SEEN_FILES_KEY, unseenAnnouncements, unseenFiles } from "../src/lib/seen.ts";

const entry = (id: string, announced: string) => ({ id, announced });

test("an announcement first seen after the last visit is new, and with no last visit none is", () => {
  const list = [entry("old", "2026-10-01T10:00:00.000Z"), entry("new", "2026-10-05T10:00:00.000Z")];
  assert.deepEqual([...unseenAnnouncements(list, "2026-10-03T00:00:00.000Z")], ["new"]);
  assert.deepEqual([...unseenAnnouncements(list, null)], []);
  assert.deepEqual([...unseenAnnouncements([entry("same", "2026-10-03T00:00:00.000Z")], "2026-10-03T00:00:00.000Z")], []);
  assert.deepEqual([...unseenAnnouncements(list, "not a date")], []);
});

test("a file whose key was not seen is new, and with nothing seen yet none is", () => {
  assert.deepEqual([...unseenFiles(["a", "b", "c"], ["a", "c"])], ["b"]);
  assert.deepEqual([...unseenFiles(["a"], null)], []);
  assert.deepEqual([...unseenFiles(["a"], [])], ["a"]);
});

test("the stored list of keys is read only when it is a list of text", () => {
  assert.deepEqual(parseSeenFiles('["a","b"]'), ["a", "b"]);
  assert.equal(parseSeenFiles("{"), null);
  assert.equal(parseSeenFiles("[1]"), null);
  assert.equal(parseSeenFiles(null), null);
});

test("the baseline is set once, and leaving a page moves it", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  ensureAnnouncementsBaseline(storage, new Date("2026-10-01T00:00:00.000Z"));
  ensureAnnouncementsBaseline(storage, new Date("2026-10-09T00:00:00.000Z"));
  assert.equal(data.get(SEEN_ANNOUNCEMENTS_KEY), "2026-10-01T00:00:00.000Z");
  markAnnouncementsSeen(storage, new Date("2026-10-09T00:00:00.000Z"));
  assert.equal(data.get(SEEN_ANNOUNCEMENTS_KEY), "2026-10-09T00:00:00.000Z");
  markFilesSeen(storage, ["a", "b"]);
  assert.deepEqual(parseSeenFiles(data.get(SEEN_FILES_KEY) ?? null), ["a", "b"]);
});

test("blocked storage is not an error", () => {
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => ensureAnnouncementsBaseline(blocked, new Date()));
  assert.doesNotThrow(() => markAnnouncementsSeen(blocked, new Date()));
  assert.doesNotThrow(() => markFilesSeen(blocked, ["a"]));
});
