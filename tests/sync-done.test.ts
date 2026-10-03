import assert from "node:assert/strict";
import test from "node:test";

import { doneLabels, mergeDone, restoreSyncedDone, saveSyncedDone, SYNCED_DONE_STORAGE_KEY } from "../src/lib/task-status.ts";
import { buildSyncPayload, parseSyncPayload, parseSyncPayloadValue, serialiseSyncPayload } from "../src/lib/sync.ts";

// The shape a link carries once serialised: the course book with its version.
const EMPTY_COURSES = { version: 1, courses: [], assignments: {} };

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    raw: data,
  };
}

test("a link carries what HuskyCT says is done, and what was reopened, and reads them back", () => {
  const built = buildSyncPayload({
    feeds: [],
    completedIds: ["tick-1"],
    efforts: {},
    courses: EMPTY_COURSES,
    doneByHuskyct: new Map([["hw-1", "submitted"], ["hw-2", "graded"]]),
    reopened: new Set(["hw-2"]),
  });
  // The real path: the link is written by serialiseSyncPayload and read back as text.
  const parsed = parseSyncPayload(serialiseSyncPayload(built));

  assert.ok(parsed);
  assert.deepEqual(parsed.doneByHuskyct, { "hw-1": "submitted", "hw-2": "graded" });
  assert.deepEqual(parsed.reopened, ["hw-2"]);
});

test("a link made before these fields existed reads as saying nothing about them", () => {
  const old = {
    version: 1,
    exportedAt: new Date().toISOString(),
    feeds: [],
    completedIds: [],
    efforts: {},
    courses: EMPTY_COURSES,
  };
  const parsed = parseSyncPayloadValue(old);

  assert.ok(parsed);
  assert.deepEqual(parsed.doneByHuskyct, {});
  assert.deepEqual(parsed.reopened, []);
});

test("a malformed reason in a link is dropped, not trusted", () => {
  const parsed = parseSyncPayloadValue({
    version: 1,
    exportedAt: new Date().toISOString(),
    feeds: [],
    completedIds: [],
    efforts: {},
    courses: EMPTY_COURSES,
    doneByHuskyct: { "hw-1": "submitted", "hw-2": "definitely", "hw-3": 7 },
    reopened: ["hw-1", 42, ""],
  });

  assert.ok(parsed);
  assert.deepEqual(parsed.doneByHuskyct, { "hw-1": "submitted" });
  assert.deepEqual(parsed.reopened, ["hw-1"]);
});

test("merging adds what the other device knows and keeps the stronger reason, never removing one", () => {
  const here = new Map([["hw-1", "submitted" as const], ["hw-2", "graded" as const]]);
  const merged = mergeDone(here, [["hw-1", "graded"], ["hw-3", "submitted"]]);

  assert.equal(merged.get("hw-1"), "graded");
  assert.equal(merged.get("hw-2"), "graded", "a task only this device knows about is kept");
  assert.equal(merged.get("hw-3"), "submitted");
});

test("a phone with no gradebook shows the work the computer's gradebook marked done", () => {
  // No local gradebook: the only auto-done entries come from the synced set.
  const synced = mergeDone(new Map(), [["hw-1", "submitted"]]);
  const labels = doneLabels(new Set(), synced, new Set());

  assert.equal(labels.get("hw-1"), "submitted");
});

test("a task the student reopened stays open even when the synced set says it is done", () => {
  const synced = mergeDone(new Map(), [["hw-1", "graded"]]);
  const labels = doneLabels(new Set(), synced, new Set(["hw-1"]));

  assert.equal(labels.has("hw-1"), false);
});

test("the synced set survives a reload, and a corrupt entry reads as nothing", () => {
  const storage = memoryStorage();
  saveSyncedDone(storage, new Map([["hw-1", "graded"]]));
  assert.equal(restoreSyncedDone(storage).get("hw-1"), "graded");

  storage.setItem(SYNCED_DONE_STORAGE_KEY, "{not json");
  assert.equal(restoreSyncedDone(storage).size, 0);

  saveSyncedDone(storage, new Map());
  assert.equal(storage.raw.has(SYNCED_DONE_STORAGE_KEY), false, "an empty set is removed, not stored");
});
