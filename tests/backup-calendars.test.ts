import assert from "node:assert/strict";
import test from "node:test";
import { createBackup, restoreBackup } from "../src/lib/backup.ts";
import { MAX_CUSTOM_EVENTS, restoreCustomEvents } from "../src/lib/custom-events.ts";
import { MAX_UNDATED_TODOS } from "../src/lib/undated-todos.ts";
import { MAX_SUBSCRIPTIONS, mergeTasks, parseStoredSubscriptions } from "../src/lib/subscriptions.ts";
import { COURSES_STORAGE_KEY, EMPTY_COURSE_BOOK, addCourse, parseStoredCourseBook, saveCourseBook } from "../src/lib/courses.ts";
import { ANNOUNCEMENTS_STORAGE_KEY, parseAnnouncementCandidates, saveAnnouncements } from "../src/lib/announcements.ts";

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}
const SUBS = "huskypilot.subscriptions.v1";
const TICKS = "huskypilot.completedTasks.imported.v1";
const CUSTOM = "huskypilot.customEvents.v1";
const NOW = new Date("2026-10-16T12:00:00.000Z");
const BEFORE = "2026-10-17T03:59:00.000Z";
const AFTER = "2026-10-19T03:59:00.000Z";
const task = (uid: string, start = BEFORE) => ({ id: `${uid}:${start}`, title: "Reading", course: "MATH 1070Q", start, end: null, dateKey: null, allDay: false, location: null, kind: "assignment" as const });
const save = (storage: MemoryStorage, key: string, data: unknown) => storage.setItem(key, JSON.stringify(data));
const read = (storage: MemoryStorage, key: string) => JSON.parse(storage.getItem(key) ?? "null");
const feed = (id: string, events: ReturnType<typeof task>[]) => ({ id, name: "My deadlines", courseId: null, importedAt: NOW.toISOString(), events });

test("merging the same six courses from two devices keeps six and leaves room for another course", () => {
  const codes = ["MATH 1070Q", "STAT 1000Q", "NRE 1000E", "ECON 1201", "SOCI 1501", "ENGL 1007"];
  const makeBook = () => codes.reduce((book, code) => addCourse(book, code, "LEC"), EMPTY_COURSE_BOOK);
  const local = new MemoryStorage(), source = new MemoryStorage();
  const original = makeBook();
  saveCourseBook(local, original);
  saveCourseBook(source, makeBook());
  const backup = createBackup(source, NOW, "2.1.0");
  for (let repeat = 0; repeat < 2; repeat++) {
    assert.deepEqual(restoreBackup(local, backup, "merge"), { ok: true });
    const saved = parseStoredCourseBook(local.getItem(COURSES_STORAGE_KEY)!)!;
    assert.deepEqual(saved.courses, original.courses);
    assert.equal(addCourse(saved, "CSE 1010", "LEC").courses.length, 7);
  }
});

test("course reconciliation remaps backup assignments, feeds and announcements while keeping local choices", () => {
  for (const withLocalCalendar of [false, true]) {
    const local = new MemoryStorage(), source = new MemoryStorage();
    const here = addCourse(EMPTY_COURSE_BOOK, "MATH 1070Q", "LEC");
    const there = addCourse(addCourse(EMPTY_COURSE_BOOK, "math 1070q", "LEC"), "MATH 1070Q", "DIS");
    const localId = here.courses[0].id, remoteId = there.courses[0].id;
    saveCourseBook(local, { ...here, assignments: { chosen: null } });
    saveCourseBook(source, { ...there, assignments: { chosen: remoteId, extra: remoteId, discussion: there.courses[1].id } });
    if (withLocalCalendar) save(local, SUBS, { version: 1, subscriptions: [feed("local", [task("local")])] });
    save(source, SUBS, { version: 1, subscriptions: [{ ...feed("remote", [task("remote")]), courseId: remoteId }] });
    const announcements = parseAnnouncementCandidates([{ title: "Exam update", body: "Bring a calculator", courseCode: "MATH 1070Q" }], NOW);
    saveAnnouncements(source, announcements.map(item => ({ ...item, courseId: remoteId })));
    const backup = createBackup(source, NOW, "2.1.0");
    assert.deepEqual(restoreBackup(local, backup, "merge"), { ok: true });
    const saved = parseStoredCourseBook(local.getItem(COURSES_STORAGE_KEY)!)!;
    assert.deepEqual(saved.courses.map(course => course.id), [localId, there.courses[1].id]);
    assert.deepEqual(saved.assignments, { chosen: null, extra: localId, discussion: there.courses[1].id });
    assert.equal(read(local, SUBS).subscriptions.find((entry: { id: string }) => entry.id === "remote").courseId, localId);
    assert.equal(read(local, ANNOUNCEMENTS_STORAGE_KEY).announcements[0].courseId, localId);
    const restored = new MemoryStorage();
    assert.deepEqual(restoreBackup(restored, backup, "replace"), { ok: true });
    assert.deepEqual(parseStoredCourseBook(restored.getItem(COURSES_STORAGE_KEY)!)!.courses, there.courses);
    assert.equal(read(restored, SUBS).subscriptions[0].courseId, remoteId);
  }
});

test("backup merge keeps the local source deadline and aligns the backup's saved decisions", () => {
  for (const backupFeedId of ["local-feed", "other-device-feed"]) {
    const local = new MemoryStorage(), source = new MemoryStorage();
    const old = task("huskyct-todo-_101_1"), current = { ...task("huskyct-todo-_101_1", AFTER), title: "My updated title" };
    const extra = task("huskyct-todo-_102_1");
    save(local, SUBS, { version: 1, subscriptions: [feed("local-feed", [current])] });
    save(source, SUBS, { version: 1, subscriptions: [feed(backupFeedId, [old, extra])] });
    save(source, TICKS, { version: 1, completedIds: [old.id] });
    save(source, "huskypilot.eventOverlay.v1", { edits: { [old.id]: { note: "saved note", start: BEFORE, allDay: false } }, deletedIds: [] });
    save(source, "huskypilot.reopened.v1", [old.id]);
    save(source, "huskypilot.syncedDone.v1", { [old.id]: "submitted" });
    save(source, "huskypilot.courses.v1", { version: 1, courses: [], assignments: { [old.id]: null } });
    save(source, "huskypilot.moves.v1", { version: 1, notices: { [old.id]: { from: "2026-10-15T03:59:00.000Z", to: BEFORE, at: NOW.toISOString() } } });

    assert.deepEqual(restoreBackup(local, createBackup(source, NOW, "1.39.1"), "merge"), { ok: true });
    const subscriptions = parseStoredSubscriptions(local.getItem(SUBS)!)!;
    assert.equal(subscriptions.length, 1);
    assert.equal(subscriptions[0].id, "local-feed");
    assert.deepEqual(mergeTasks(subscriptions), [current, extra]);
    assert.deepEqual(read(local, TICKS).completedIds, [current.id]);
    assert.deepEqual(read(local, "huskypilot.eventOverlay.v1").edits, { [current.id]: { note: "saved note" } });
    assert.deepEqual(read(local, "huskypilot.reopened.v1"), [current.id]);
    assert.deepEqual(read(local, "huskypilot.syncedDone.v1"), { [current.id]: "submitted" });
    assert.deepEqual(read(local, "huskypilot.courses.v1").assignments, { [current.id]: null });
    assert.deepEqual(read(local, "huskypilot.moves.v1").notices, {}, "a notice ending at the backup's old date is obsolete");
  }
});

test("backup merge never guesses legacy Calendar moves or collapses recurring instances", () => {
  for (const [uid, localHasBoth] of [["huskyct-due-Reading", false], ["recurring-reading", true], ["recurring-reading", false]] as const) {
    const local = new MemoryStorage(), source = new MemoryStorage();
    const first = task(uid), second = task(uid, AFTER);
    const localEvents = localHasBoth ? [first, second] : [second];
    save(local, SUBS, { version: 1, subscriptions: [feed("feed", localEvents)] });
    save(source, SUBS, { version: 1, subscriptions: [feed("feed", [first])] });
    save(source, TICKS, { version: 1, completedIds: [first.id] });
    assert.deepEqual(restoreBackup(local, createBackup(source, NOW, "1.39.1"), "merge"), { ok: true });
    assert.equal(mergeTasks(parseStoredSubscriptions(local.getItem(SUBS)!)!).length, 2);
    assert.deepEqual(read(local, TICKS).completedIds, [first.id]);
  }
});

test("backup restore refuses task and subscription overflow before changing any key", () => {
  const own = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => ({ ...task(prefix + i), id: `custom-${prefix}${i}`, note: null }));
  const cases = [
    { key: CUSTOM, local: own("a", 300), incoming: own("b", 300) },
    { key: "huskypilot.undatedTodos.v1", local: Array.from({ length: 200 }, (_, id) => ({ id: "a" + id })), incoming: Array.from({ length: 200 }, (_, id) => ({ id: "b" + id })) },
    { key: SUBS, local: { version: 1, subscriptions: Array.from({ length: MAX_SUBSCRIPTIONS }, (_, i) => feed("a" + i, [task("a" + i)])) }, incoming: { version: 1, subscriptions: [feed("extra", [task("extra")])] } },
  ];
  for (const row of cases) {
    const local = new MemoryStorage(), source = new MemoryStorage();
    save(local, row.key, row.local);
    save(local, TICKS, { version: 1, completedIds: ["kept"] });
    save(source, row.key, row.incoming);
    save(source, TICKS, { version: 1, completedIds: ["new"] });
    const before = new Map(local.map);
    assert.deepEqual(restoreBackup(local, createBackup(source, NOW, "1.39.1"), "merge"), { ok: false });
    assert.deepEqual(local.map, before);
  }
  for (const [key, data] of [
    [CUSTOM, own("a", MAX_CUSTOM_EVENTS + 1)],
    ["huskypilot.undatedTodos.v1", Array.from({ length: MAX_UNDATED_TODOS + 1 }, (_, id) => ({ id }))],
    [SUBS, { version: 1, subscriptions: Array.from({ length: MAX_SUBSCRIPTIONS + 1 }, (_, i) => feed("s" + i, [task("t" + i)])) }],
  ] as const) {
    const local = new MemoryStorage(), source = new MemoryStorage();
    save(source, key, data);
    assert.deepEqual(restoreBackup(local, createBackup(source, NOW, "1.39.1"), "replace"), { ok: false });
    assert.equal(local.map.size, 0);
  }
});

test("an exact-capacity backup merge survives the next read and save", () => {
  const local = new MemoryStorage(), source = new MemoryStorage();
  const own = (offset: number, count: number) => Array.from({ length: count }, (_, i) => ({ ...task("a" + (offset + i)), id: `custom-${offset + i}`, note: null }));
  save(local, CUSTOM, own(0, 300));
  save(source, CUSTOM, own(300, 200));
  assert.deepEqual(restoreBackup(local, createBackup(source, NOW, "1.39.1"), "merge"), { ok: true });
  assert.equal(restoreCustomEvents(local as unknown as Storage).length, MAX_CUSTOM_EVENTS);
  assert.equal(read(local, CUSTOM).length, MAX_CUSTOM_EVENTS);
});
