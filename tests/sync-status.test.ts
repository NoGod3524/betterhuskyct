import assert from "node:assert/strict";
import test from "node:test";

import { agoUnit, applyReadReport, missedParts, parseReadReport, parseSyncStatus, recordReadReport, readSyncStatus } from "../src/lib/sync-status.ts";

const course = (id: string, code: string, read = true) => ({ id, code, announcements: read, grades: read, files: read });
const T1 = new Date("2026-10-13T12:00:00.000Z");
const T2 = new Date("2026-10-14T12:00:00.000Z");

test("only a report of the right shape is taken", () => {
  assert.deepEqual(parseReadReport({ dueDates: true, todo: false, courses: [course("_1_1", "MATH 1131Q")] }), { dueDates: true, todo: false, courses: [course("_1_1", "MATH 1131Q")] });
  assert.equal(parseReadReport({ dueDates: true, todo: false }), null);
  assert.equal(parseReadReport({ dueDates: "yes", todo: false, courses: [] }), null);
  assert.equal(parseReadReport({ dueDates: true, todo: true, courses: [{ id: "_1_1", announcements: true }] }), null);
  assert.equal(parseReadReport(null), null);
});

test("a part the latest sync missed keeps the time it was last read, and says it was missed", () => {
  const first = applyReadReport(null, { dueDates: true, todo: true, courses: [course("_1_1", "MATH 1131Q"), course("_2_1", "ECON 1201")] }, T1);
  const second = applyReadReport(first, { dueDates: false, todo: true, courses: [course("_1_1", "MATH 1131Q"), { ...course("_2_1", "ECON 1201"), grades: false }] }, T2);

  assert.equal(second.lastSync, T2.toISOString());
  assert.deepEqual(second.dueDates, { lastRead: T1.toISOString(), missed: true });
  assert.deepEqual(second.todo, { lastRead: T2.toISOString(), missed: false });
  const econ = second.courses.find((c) => c.id === "_2_1")!;
  assert.deepEqual(econ.grades, { lastRead: T1.toISOString(), missed: true });
  assert.deepEqual(econ.files, { lastRead: T2.toISOString(), missed: false });
  assert.deepEqual(missedParts(second), [{ course: null, part: "dueDates" }, { course: "ECON 1201", part: "grades" }]);
});

test("a course never read says so, and a course from an earlier sync that is gone drops out", () => {
  const first = applyReadReport(null, { dueDates: true, todo: true, courses: [course("_old_1", "HIST 1100"), course("_new_1", "CHEM 1127Q", false)] }, T1);
  assert.deepEqual(first.courses.find((c) => c.id === "_new_1")!.files, { lastRead: null, missed: true });
  const second = applyReadReport(first, { dueDates: true, todo: true, courses: [course("_new_1", "CHEM 1127Q")] }, T2);
  assert.deepEqual(second.courses.map((c) => c.id), ["_new_1"]);
});

test("what is stored reads back, and a damaged value reads as nothing", () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  const written = recordReadReport(storage, { dueDates: true, todo: false, courses: [course("_1_1", "MATH 1131Q")] }, T1);
  assert.deepEqual(readSyncStatus(storage), written);
  assert.equal(parseSyncStatus({ version: 1, lastSync: "x" }), null);
  map.set("huskypilot.syncStatus.v1", "{oops");
  assert.equal(readSyncStatus(storage), null);
});

test("how long ago is said in the largest whole unit", () => {
  const at = "2026-10-13T12:00:00.000Z";
  const after = (minutes: number) => new Date(Date.parse(at) + minutes * 60_000);
  assert.deepEqual(agoUnit(at, after(0.5)), { unit: "now", count: 0 });
  assert.deepEqual(agoUnit(at, after(5)), { unit: "minutes", count: 5 });
  assert.deepEqual(agoUnit(at, after(130)), { unit: "hours", count: 2 });
  assert.deepEqual(agoUnit(at, after(3 * 24 * 60 + 5)), { unit: "days", count: 3 });
});
