import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackgroundSync, BACKGROUND_KEY, BACKGROUND_PROTOCOL, BACKGROUND_ALARM } from "../tools/extension/background-sync.js";
import { diffBackgroundSnapshot } from "../tools/extension/background-diff.js";
import { recordGradeChanges, recordSyncChanges } from "../src/lib/change-producers.ts";
import { mergeSyncPayload } from "../src/lib/sync-merge.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { recordMaterialChanges } from "../src/lib/materials-changes.ts";
import type { SyncPayload } from "../src/lib/sync.ts";
import type { GradesSnapshot } from "../src/lib/grades.ts";
import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { computeAnnouncementId, isAnnouncement } from "../src/lib/announcements.ts";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const empty = () => ({ version: 1 as const, entries: [], baselines: [] });
const task = (id = "_1_1", start = "2026-10-20T12:00:00.000Z"): CalendarTask & { sourceCourseId?: string } => ({ id: `huskyct-todo-${id}:${start}`, title: "Homework", course: "MATH 1131Q",
  start, dateKey: start.slice(0, 10), end: null, allDay: false, kind: "assignment", location: null });
const announcement = (sourceId = "a", body = "Old text") => ({ id: computeAnnouncementId({ sourceId, sourceCourseId: "_10_1", courseCode: "MATH 1131Q", title: "Announcement " + sourceId, posted: NOW.toISOString() }), sourceId, sourceCourseId: "_10_1", courseId: null, courseCode: "MATH 1131Q",
  title: "Announcement " + sourceId, body, posted: NOW.toISOString(), announced: NOW.toISOString() });
function snapshot(revision = "one") {
  return { version: 1, revision, at: NOW.toISOString(), tasks: { version: 1, exportedAt: NOW.toISOString(),
    feeds: [{ name: "HuskyCT to-do", courseId: null, importedAt: NOW.toISOString(), events: [task()] }], completedIds: [],
    courses: { version: 1, courses: [], assignments: {} }, announcements: [announcement()], doneByHuskyct: {}, reopened: [], courseColors: {},
  }, grades: { version: 1, term: "Fall 2026", takenAt: NOW.toISOString(), courses: [{ id: "_10_1", code: "MATH 1131Q",
    items: [{ id: "_1_1", title: "Homework", status: null, earned: 80, possible: 100, label: null }] }] },
  materials: { version: 1 as const, term: "Fall 2026", updatedAt: NOW.toISOString(), courses: [{ id: "_10_1", code: "MATH 1131Q",
    files: [{ key: "folder:old.pdf", title: "Old.pdf", path: [] }], links: [], tools: [] }] },
  status: { dueDates: true, todo: true, courses: [{ id: "_10_1", code: "MATH 1131Q", announcements: true, grades: true, files: true }] } };
}
const sender = (id = 1, origin = "https://betterhuskyct.vercel.app") => ({ id: "test-extension", url: origin + "/changes", tab: { id }, frameId: 0 });
const popup = { id: "test-extension", url: "chrome-extension://test-extension/popup.html" };
const message = (kind: string, extra = {}) => ({ protocol: BACKGROUND_PROTOCOL, target: "worker", kind, ...extra });
function event() {
  const listeners: Array<(...args: unknown[]) => void> = [];
  return { addListener: (run: (...args: unknown[]) => void) => listeners.push(run), fire: (...args: unknown[]) => listeners.forEach((run) => run(...args)) };
}
function fixture() {
  const data: Record<string, unknown> = {}, alarms = new Map(), notices: Array<{ id: string; options: { title: string; message: string } }> = [];
  const opened: Array<{ url: string }> = [], broadcasts: unknown[] = [], queries: unknown[] = [];
  let at = +NOW, sequence = 0, reads = 0, document = false, permission = false;
  let response: () => unknown = () => ({ ok: true, snapshot: snapshot() });
  const api = {
    storage: { local: {
      get: async (key: string | null) => structuredClone(key === null ? data : { [key]: data[key] }),
      set: async (values: Record<string, unknown>) => { Object.assign(data, structuredClone(values)); },
      setAccessLevel: async (value: { accessLevel: string }) => { assert.equal(value.accessLevel, "TRUSTED_CONTEXTS"); },
    }, onChanged: event() },
    runtime: { id: "test-extension", getURL: (path: string) => "chrome-extension://test-extension/" + path,
      sendMessage: async () => { reads++; return response(); }, onStartup: event(), onInstalled: event() },
    offscreen: { hasDocument: async () => document, createDocument: async () => { document = true; }, closeDocument: async () => { document = false; } },
    alarms: { create: async (name: string, value: unknown) => { alarms.set(name, value); }, get: async (name: string) => alarms.get(name), clear: async (name: string) => alarms.delete(name), onAlarm: event() },
    permissions: { contains: async () => permission },
    notifications: { create: async (id: string, options: { title: string; message: string }) => { notices.push({ id, options }); }, onClicked: event() },
    tabs: { create: async (value: { url: string }) => { opened.push(value); }, query: async (value: unknown) => { queries.push(value); return [{ id: 1 }]; },
      sendMessage: async (...values: unknown[]) => { broadcasts.push(values); }, onUpdated: event(), onRemoved: event() },
  };
  const manager = createBackgroundSync(api, { now: () => new Date(at), uuid: () => "id-" + ++sequence, timeoutMs: 1000, language: "en" });
  return { api, manager, data, alarms, notices, opened, broadcasts, queries, reads: () => reads,
    state: () => JSON.parse(JSON.stringify(data[BACKGROUND_KEY])), response: (next: () => unknown) => { response = next; },
    time: (value: number) => { at = value; }, permission: (value: boolean) => { permission = value; } };
}

test("background and notifications start off; manual reads establish a silent baseline", async () => {
  const f = fixture();
  const state = await f.manager.handle(message("status"), popup);
  assert.equal(state.settings.enabled, false); assert.equal(state.settings.notifications, false);
  assert.equal(f.reads(), 0); assert.equal(f.alarms.size, 0);
  assert.deepEqual(await f.manager.run(), { ok: true });
  assert.equal(f.state().pendingChanges.entries.length, 0); assert.equal(f.notices.length, 0);
  assert.equal(f.state().snapshot.revision, "one");
  assert.deepEqual(f.queries, [{ url: ["https://betterhuskyct.vercel.app/*"] }]);
  const signal = f.broadcasts[0] as [number, { kind: string; target: string; snapshot?: unknown }];
  assert.equal(signal[1].kind, "available"); assert.equal(signal[1].target, "relay"); assert.equal(signal[1].snapshot, undefined);
});

test("real helper announcement candidates without ids are normalized before caching or diffing", async () => {
  const f = fixture(), wire = snapshot();
  wire.tasks.announcements = [announcement("a"), announcement("b")].map((item) => {
    const candidate = { ...item };
    Reflect.deleteProperty(candidate, "id"); Reflect.deleteProperty(candidate, "courseId");
    return candidate;
  });
  f.response(() => ({ ok: true, snapshot: wire })); await f.manager.run();
  const entries = f.state().snapshot.tasks.announcements;
  assert.equal(entries.length, 2); assert.ok(entries.every(isAnnouncement));
  assert.equal(new Set(entries.map((item: { id: string }) => item.id)).size, 2);
});

test("HuskyCT and iframes cannot claim cache, while GM access only exposes gm-prefixed storage", async () => {
  const f = fixture(); await f.manager.run();
  const huskyct = sender(2, "https://lms.uconn.edu");
  assert.deepEqual(await f.manager.handle(message("claim"), huskyct), { ok: false, reason: "forbidden" });
  assert.deepEqual(await f.manager.handle(message("claim"), { ...sender(), frameId: 1 }), { ok: false, reason: "forbidden" });
  assert.deepEqual(await f.manager.handle(message("gm-write", { key: BACKGROUND_KEY, value: "bad" }), huskyct), { ok: false, reason: "invalid" });
  assert.deepEqual(await f.manager.handle(message("gm-write", { key: "gm:setting", value: 7 }), huskyct), { ok: true });
  assert.deepEqual(await f.manager.handle(message("gm-read"), huskyct), { ok: true, values: { setting: 7 } });
  assert.equal(f.state().snapshot.revision, "one");
});

test("a run is single-flight, disabling it cancels its result, and failures retain successful cache", async () => {
  const f = fixture(); await f.manager.run();
  f.response(() => ({ ok: false, reason: "failed" })); await f.manager.run();
  assert.equal(f.state().snapshot.revision, "one");
  let release!: (value: unknown) => void, entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  f.response(() => { entered(); return new Promise((resolve) => { release = resolve; }); });
  const a = f.manager.run(), b = f.manager.run(); assert.equal(a, b); await started;
  await f.manager.handle(message("settings", { settings: { enabled: false } }), popup);
  release({ ok: true, snapshot: snapshot("ignored") });
  assert.deepEqual(await a, { ok: false, reason: "cancelled" }); assert.equal(f.state().snapshot.revision, "one");
});

test("401 pauses alarms, a manual retry can resume, and the login notification appears once", async () => {
  const f = fixture(); f.permission(true);
  await f.manager.handle(message("settings", { settings: { enabled: true, notifications: true, locale: "zh-CN" } }), popup);
  await f.manager.run(); assert.equal(f.alarms.has(BACKGROUND_ALARM), true);
  f.response(() => ({ ok: false, reason: "signedout" }));
  await f.manager.run(); await f.manager.run();
  assert.equal(f.state().needsLogin, true); assert.equal(f.alarms.size, 0);
  assert.equal(f.notices.length, 1); assert.ok(f.notices[0].options.title.includes("登录"));
  const count = f.reads(); assert.deepEqual(await f.manager.run("alarm"), { ok: false, reason: "paused" }); assert.equal(f.reads(), count);
  f.response(() => ({ ok: true, snapshot: snapshot("resumed") })); await f.manager.run();
  assert.equal(f.state().needsLogin, false); assert.equal(f.alarms.has(BACKGROUND_ALARM), true);
});

test("notification permission is optional and selected kinds aggregate once per actual changed reading", async () => {
  const f = fixture();
  assert.deepEqual(await f.manager.handle(message("settings", { settings: { notifications: true } }), popup), { ok: false, reason: "permission" });
  f.permission(true); await f.manager.handle(message("settings", { settings: { notifications: true, kinds: { "announcement-new": false } } }), popup);
  await f.manager.run(); const next = snapshot("two"); next.grades.courses[0].items[0].earned = 90; next.tasks.announcements.push(announcement("b"));
  f.response(() => ({ ok: true, snapshot: next })); await f.manager.run(); await f.manager.run();
  assert.equal(f.notices.length, 1); assert.ok(f.notices[0].options.title.startsWith("1 "));
  assert.ok(f.notices[0].options.message.includes("Homework"));
});

test("turning off while notification permission is pending cancels the late notification", async () => {
  const f = fixture(); f.permission(true); await f.manager.run();
  await f.manager.handle(message("settings", { settings: { notifications: true } }), popup);
  const next = snapshot("two"); next.grades.courses[0].items[0].earned = 90;
  f.response(() => ({ ok: true, snapshot: next }));
  let entered!: () => void, release!: (value: boolean) => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  f.api.permissions.contains = () => { entered(); return new Promise<boolean>((resolve) => { release = resolve; }); };
  const running = f.manager.run(); await started;
  await f.manager.handle(message("settings", { settings: { enabled: false, notifications: false } }), popup);
  release(true); await running;
  assert.equal(f.notices.length, 0);
});

test("leases survive retry and acknowledge only their captured pending IDs", async () => {
  const f = fixture(); await f.manager.run();
  const second = snapshot("two"); second.tasks.announcements.push(announcement("b"));
  f.response(() => ({ ok: true, snapshot: second })); await f.manager.run();
  const claim = await f.manager.handle(message("claim"), sender());
  assert.equal(claim.snapshot.revision, "two");
  assert.equal((await f.manager.handle(message("claim"), sender())).leaseId, claim.leaseId);
  assert.deepEqual(await f.manager.handle(message("claim"), sender(2)), { ok: false, reason: "leased" });
  const third = snapshot("three"); third.tasks.announcements.push(announcement("b"), announcement("c"));
  f.response(() => ({ ok: true, snapshot: third })); await f.manager.run();
  assert.deepEqual(await f.manager.handle(message("ack", { leaseId: claim.leaseId, revision: "wrong" }), sender()), { ok: false, reason: "invalid-lease" });
  assert.deepEqual(await f.manager.handle(message("ack", { leaseId: claim.leaseId, revision: "two" }), sender()), { ok: true });
  assert.equal(f.state().pendingChanges.entries.length, 1); assert.equal(f.state().pendingChanges.entries[0].title, "Announcement c");
  assert.equal((await f.manager.handle(message("claim"), sender(2))).snapshot.revision, "three");
});

test("expired or closed-tab leases can retry without losing cache", async () => {
  const f = fixture(); await f.manager.run();
  const first = await f.manager.handle(message("claim"), sender());
  f.time(+NOW + 61_000);
  const retry = await f.manager.handle(message("claim"), sender(2));
  assert.notEqual(first.leaseId, retry.leaseId); assert.equal(retry.snapshot.revision, "one");
  assert.equal((await f.manager.handle(message("status"), popup)).pending, 0);
});

test("worker restarts preserve an existing alarm and a lost overdue alarm is restored soon", async () => {
  const f = fixture(); await f.manager.handle(message("settings", { settings: { enabled: true } }), popup); await f.manager.run();
  const initial = f.alarms.get(BACKGROUND_ALARM);
  f.time(+NOW + 60 * 60_000);
  const restarted = createBackgroundSync(f.api, { now: () => new Date(+NOW + 60 * 60_000), uuid: () => "restart" });
  restarted.install(); await restarted.handle(message("status"), popup);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(f.alarms.get(BACKGROUND_ALARM), initial, "opening a popup postponed the six-hour alarm");
  f.alarms.clear(); f.time(+NOW + 7 * 60 * 60_000);
  const late = createBackgroundSync(f.api, { now: () => new Date(+NOW + 7 * 60 * 60_000), uuid: () => "late" });
  late.install(); await late.handle(message("status"), popup);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.alarms.get(BACKGROUND_ALARM).when, +NOW + 7 * 60 * 60_000 + 60_000);
});

test("an old disabled schedule cannot clear a newer enabled alarm", async () => {
  const f = fixture();
  let entered!: () => void, release!: () => void, calls = 0;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const clear = f.api.alarms.clear;
  f.api.alarms.clear = async (name) => { if (++calls === 1) { entered(); await gate; } return clear(name); };
  f.manager.install(); await started;
  let settingsSaved = false;
  const enabling = f.manager.handle(message("settings", { settings: { enabled: true } }), popup).then((value) => { settingsSaved = true; return value; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settingsSaved, false, "the old alarm operation ran outside the state queue");
  release(); await enabling; await f.manager.run();
  assert.equal(f.alarms.has(BACKGROUND_ALARM), true);
});

test("opening HuskyCT checks a paused session once, and GM broadcasts never include the private cache", async () => {
  const f = fixture(); f.manager.install();
  await f.manager.handle(message("settings", { settings: { enabled: true } }), popup); await f.manager.run();
  f.response(() => ({ ok: false, reason: "signedout" })); await f.manager.run();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  f.response(() => { entered(); return { ok: true, snapshot: snapshot("resumed") }; });
  f.api.tabs.onUpdated.fire(1, { status: "complete" }, { url: "https://lms.uconn.edu/ultra" });
  await started; await f.manager.run();
  assert.equal(f.state().needsLogin, false);
  f.broadcasts.length = 0;
  f.api.storage.onChanged.fire({ [BACKGROUND_KEY]: { newValue: { private: "cache" } }, "gm:choice": { newValue: true } }, "local");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.broadcasts.length, 1);
  const broadcast = f.broadcasts[0] as [number, { kind: string; key: string; value: unknown }];
  assert.equal(broadcast[1].kind, "gm-changed"); assert.equal(broadcast[1].key, "choice"); assert.equal(broadcast[1].value, true);
  f.api.notifications.onClicked.fire("betterhuskyct-login"); f.api.notifications.onClicked.fire("betterhuskyct-changes");
  assert.deepEqual(f.opened.map((tab) => tab.url), ["https://lms.uconn.edu/", "https://betterhuskyct.vercel.app/changes"]);
});

test("background diff uses the app's task, announcement, grade and file event IDs", () => {
  const old = snapshot(), incoming = snapshot("two");
  incoming.tasks.exportedAt = "2026-10-18T13:00:00.000Z"; incoming.grades.takenAt = incoming.tasks.exportedAt;
  incoming.tasks.feeds[0].events = [task("_1_1", "2026-10-22T12:00:00.000Z"), task("_2_1")];
  incoming.tasks.announcements = [announcement("a", "Edited text"), announcement("b")];
  incoming.grades.courses[0].items[0].earned = 90;
  incoming.materials.courses[0].files.push({ key: "folder:new.pdf", title: "New.pdf", path: [] });
  const before = { subscriptions: [{ id: "local", name: null, courseId: null, importedAt: old.at, events: old.tasks.feeds[0].events }],
    announcements: old.tasks.announcements, courses: EMPTY_COURSE_BOOK, completedIds: new Set<string>(), doneByHuskyct: new Map() };
  const wire = incoming.tasks as SyncPayload;
  const app = recordSyncChanges(empty(), before, mergeSyncPayload(before, wire), wire, NOW);
  const grades = recordGradeChanges(empty(), old.grades as GradesSnapshot, incoming.grades as GradesSnapshot, NOW);
  const files = recordMaterialChanges(old.materials, incoming.materials, null, NOW).pending;
  const actual = diffBackgroundSnapshot(old, incoming, empty(), NOW);
  assert.deepEqual(new Set(actual.changes.entries.map((item: { id: string }) => item.id)), new Set([...app.entries, ...grades.entries, ...files].map((item) => item.id)));
  assert.equal(diffBackgroundSnapshot(actual.snapshot, incoming, actual.changes, NOW).added.length, 0);
});

test("new source courses get silent baselines even when course codes match; failed parts keep old success", () => {
  const old = snapshot(), incoming = snapshot("two");
  incoming.tasks.feeds[0].events = [
    { ...task("_2_1"), sourceCourseId: "_20_1" }, { ...task("_3_1"), sourceCourseId: "_20_1" },
  ];
  incoming.status.courses.push({ id: "_20_1", code: "MATH 1131Q", announcements: true, grades: true, files: true });
  assert.equal(diffBackgroundSnapshot(old, incoming, empty(), NOW).added.length, 0);
  const partial = snapshot("partial"); partial.status.courses[0] = { ...partial.status.courses[0], grades: false, files: false, announcements: false };
  partial.grades.courses = []; partial.materials.courses = []; partial.tasks.announcements = [];
  const result = diffBackgroundSnapshot(old, partial, empty(), NOW);
  assert.deepEqual(result.snapshot.grades.courses, old.grades.courses);
  assert.deepEqual(result.snapshot.materials.courses, old.materials.courses);
  assert.deepEqual(result.snapshot.tasks.announcements, old.tasks.announcements);
  assert.equal(result.added.length, 0);
});
