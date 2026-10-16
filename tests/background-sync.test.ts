import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_MAX_BYTES, historyForSource, parseBackgroundOffer, parseBackgroundStatus } from "../src/lib/background-sync.ts";
import { buildSyncPayload, serialiseSyncPayload } from "../src/lib/sync.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import type { ChangeEntry } from "../src/lib/changes.ts";
import { adoptMaterialChanges } from "../src/lib/materials-changes.ts";
import { isCalendarTask } from "../src/lib/calendar-task.ts";

const at = new Date().toISOString();
function offer() {
  return { leaseId: "lease-1", snapshot: { version: 1, revision: "revision-1", at,
    tasks: JSON.parse(serialiseSyncPayload(buildSyncPayload({ feeds: [], completedIds: [], courses: EMPTY_COURSE_BOOK, now: new Date(at) }))),
    grades: null, materials: null, status: { dueDates: true, todo: true, courses: [] },
  }, changes: { version: 1, entries: [] as ChangeEntry[], baselines: [] as string[] } };
}
const row = (kind: ChangeEntry["kind"], id: string = kind, ref?: ChangeEntry["ref"]): ChangeEntry => ({ id, at, kind, courseCode: null, title: id, read: false, ...(ref ? { ref } : {}) });

test("a complete empty snapshot is valid; null optional sources mean not read", () => {
  const parsed = parseBackgroundOffer(offer());
  assert.ok(parsed);
  assert.equal(parsed.snapshot.grades, null);
  assert.equal(parsed.snapshot.materials, null);
  assert.deepEqual(parsed.changes.entries, []);
});

test("a missing optional source cannot consume pending history belonging to that source", () => {
  for (const entry of [row("grade"), row("done-by-huskyct", "graded", { page: "/tasks" }), row("file-new")]) {
    const raw = offer();
    raw.changes.entries = [entry];
    assert.equal(parseBackgroundOffer(raw), null, entry.kind);
  }
});

test("a malformed source, history row or route rejects the entire offer rather than silently acknowledging it", () => {
  const invalid = [
    { ...offer(), leaseId: "" },
    { ...offer(), snapshot: { ...offer().snapshot, grades: {} } },
    { ...offer(), snapshot: { ...offer().snapshot, materials: {} } },
    { ...offer(), snapshot: { ...offer().snapshot, tasks: { ...offer().snapshot.tasks, feeds: [{ importedAt: at, events: [{ id: "broken" }] }] } } },
    { ...offer(), snapshot: { ...offer().snapshot, tasks: { ...offer().snapshot.tasks, announcements: [{ id: "broken" }] } } },
    { ...offer(), changes: { version: 1, entries: [{ ...row("grade"), ref: { page: "https://attacker.example" } }], baselines: [] } },
    { ...offer(), changes: { version: 1, entries: [{ ...row("grade"), read: "false" }], baselines: [] } },
  ];
  for (const raw of invalid) assert.equal(parseBackgroundOffer(raw), null);
});

test("prototypes, getters, dangerous keys and oversized snapshots do not enter storage", () => {
  assert.equal(parseBackgroundOffer(Object.assign(Object.create({ inherited: true }), offer())), null);
  const accessor = offer();
  Object.defineProperty(accessor.snapshot, "at", { get() { throw new Error("must not invoke"); } });
  assert.equal(parseBackgroundOffer(accessor), null);
  assert.equal(parseBackgroundOffer(JSON.parse(JSON.stringify(offer()).replace('"leaseId":', '"__proto__":{},"leaseId":'))), null);
  assert.equal(parseBackgroundOffer({ ...offer(), snapshot: { ...offer().snapshot, extra: "x".repeat(BACKGROUND_MAX_BYTES) } }), null);
});

test("each source owns only its pending changes, including the two completion paths", () => {
  const store = { version: 1 as const, entries: [row("grade"), row("file-new"), row("deadline-moved"), row("done-by-huskyct", "task-done", { page: "/tasks", id: "item" }), row("done-by-huskyct", "grade-done", { page: "/tasks" })], baselines: ["grades:1", "files:id:1", "deadlines:id:1", "announcements:id:1"] };
  assert.deepEqual(historyForSource(store, "grades").entries.map(entry => entry.id), ["grade", "grade-done"]);
  assert.deepEqual(historyForSource(store, "tasks").entries.map(entry => entry.id), ["deadline-moved", "task-done"]);
  assert.deepEqual(historyForSource(store, "materials").entries.map(entry => entry.id), ["file-new"]);
});

test("adopting a newer background directory never synthesizes a notice the extension did not send", () => {
  const index = (names: string[]) => ({ version: 1 as const, term: null, updatedAt: at, courses: [{ id: "_1_1", code: "MATH 1131Q", files: names.map(title => ({ key: `folder:${title}`, title, path: [] })), links: [], tools: [] }] });
  const old = index(["Old.pdf"]), next = index(["Old.pdf", "New.pdf"]);
  const silent = adoptMaterialChanges(old, next, null, [], new Date(at));
  assert.deepEqual(silent.pending, []);
  assert.deepEqual(silent.seen["id:_1_1"], ["folder:Old.pdf", "folder:New.pdf"]);
  const history = row("file-new", "extension-file", { page: "/materials", id: "folder:New.pdf" });
  assert.deepEqual(adoptMaterialChanges(old, next, null, [history], new Date(at)).pending.map(entry => entry.id), ["extension-file"]);
});

test("optional sourceCourseId validates independently of a locally renamed course", () => {
  const task = { id: "task", title: "Homework", course: "My label", start: at, dateKey: null, end: null, allDay: false, location: null };
  assert.ok(isCalendarTask(task));
  assert.ok(isCalendarTask({ ...task, sourceCourseId: "_100_1" }));
  assert.equal(isCalendarTask({ ...task, sourceCourseId: "arbitrary" }), false);
});

test("status accepts only typed settings and timestamps", () => {
  const status = { ok: true, settings: { enabled: false, notifications: false, locale: null, kinds: { grade: true } }, lastAttempt: null, lastSuccess: null, needsLogin: false, lastError: null, running: false, pending: 0, cachedAt: null };
  assert.ok(parseBackgroundStatus(status));
  assert.equal(parseBackgroundStatus({ ...status, pending: -1 }), null);
  assert.equal(parseBackgroundStatus({ ...status, lastSuccess: "yesterday" }), null);
});
