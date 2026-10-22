import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { diffBackgroundSnapshot } from "../tools/extension/background-diff.js";
import type { SyncPayload } from "../src/lib/sync.ts";
import { BACKGROUND_PROTOCOL } from "../src/lib/background-sync.ts";
import { CHANGES_KEY, mergeChangeStores, parseChanges, type ChangeEntry, type ChangesStore } from "../src/lib/changes.ts";
import { buildSyncPayload, serialiseSyncPayload } from "../src/lib/sync.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { openGradesStore, GRADES_STORAGE_KEY } from "../src/lib/grades-store.ts";
import type { GradesSnapshot } from "../src/lib/grades.ts";
import { installDom } from "./support/dom.ts";
import { memoryMaterialsStore } from "./support/memory-stores.ts";

const dom = installDom();
const { window } = dom;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CalendarProvider } = await import("../src/components/calendar-provider.tsx");
const { BackgroundDeliveries } = await import("../src/components/background-deliveries.tsx");
const at = new Date().toISOString();
const originalPost = window.postMessage.bind(window);
const posted: Array<Record<string, unknown>> = [];
window.postMessage = ((message: Record<string, unknown>) => { posted.push(message); }) as typeof window.postMessage;
after(async () => { window.postMessage = originalPost; await dom.uninstall(); });
beforeEach(() => { window.localStorage.clear(); posted.length = 0; });

function reading(score: number): GradesSnapshot {
  return { version: 1, term: null, takenAt: at, courses: [{ id: "_1_1", code: "MATH 1131Q", items: [{ id: "_1_1", title: "Homework", earned: score, possible: 100, status: null, label: null }] }] };
}
const history = (entries: ChangeEntry[] = []): ChangesStore => ({ version: 1, entries, baselines: [] });
const change = (id: string, from: string, to: string): ChangeEntry => ({ id, at, kind: "grade", courseCode: "MATH 1131Q", title: "Homework", detail: { from, to }, ref: { page: "/grades", id: "_1_1" }, read: false });
function offer(changes: ChangesStore = history()) {
  return { protocol: BACKGROUND_PROTOCOL, target: "app", kind: "offer", leaseId: "lease-1", snapshot: {
    version: 1, revision: "revision-1", at,
    tasks: JSON.parse(serialiseSyncPayload(buildSyncPayload({ feeds: [], completedIds: [], courses: EMPTY_COURSE_BOOK, now: new Date(at) }))),
    grades: reading(90), materials: { version: 1, term: null, updatedAt: at, courses: [] },
    status: { dueDates: true, todo: true, courses: [{ id: "_1_1", code: "MATH 1131Q", announcements: true, grades: true, files: true }] },
  }, changes };
}
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
async function mount() {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  let opened = 0;
  let failMaterials = false;
  const materials = memoryMaterialsStore();
  materials.receiveBackground = async (index, incoming) => {
    if (failMaterials) throw new Error("full");
    await materials.putIndex(index);
    const merged = mergeChangeStores(parseChanges(window.localStorage.getItem(CHANGES_KEY)), incoming, new Date());
    window.localStorage.setItem(CHANGES_KEY, JSON.stringify(merged));
  };
  await act(async () => root.render(createElement(CalendarProvider, { initialNow: at, children: createElement(BackgroundDeliveries, {
    openGrades: async () => { opened++; return openGradesStore(); }, openMaterials: async () => { opened++; return materials; },
  }) })));
  await settle();
  return {
    opened: () => opened,
    failMaterials: (value: boolean) => { failMaterials = value; },
    send: async (data: unknown, origin = window.location.origin, source: unknown = window) => {
      await act(async () => { window.dispatchEvent(new window.MessageEvent("message", { data, origin, source: source as never })); });
      await settle();
    },
    unmount: async () => { await act(async () => root.unmount()); container.remove(); },
  };
}

test("without a valid same-window offer, no background store opens and nothing is acknowledged", async () => {
  const view = await mount();
  await view.send(offer(), "https://attacker.example");
  await view.send(offer(), window.location.origin, {});
  await view.send({ ...offer(), snapshot: { bad: true } });
  assert.equal(view.opened(), 0);
  assert.equal(posted.filter(message => message.kind === "ack").length, 0);
  await view.unmount();
});

test("a background 80→85→90 history never gets an invented app-side 80→90 transition", async () => {
  const store = await openGradesStore();
  await store.put(reading(80));
  const view = await mount();
  await view.send(offer(history([change("80-85", "80/100", "85/100"), change("85-90", "85/100", "90/100")])));
  assert.equal(JSON.parse(window.localStorage.getItem(GRADES_STORAGE_KEY)!).courses[0].items[0].earned, 90);
  assert.deepEqual(parseChanges(window.localStorage.getItem(CHANGES_KEY)).entries.map(entry => entry.id).sort(), ["80-85", "85-90"]);
  assert.equal(posted.filter(message => message.kind === "ack").length, 1);
  assert.equal(JSON.parse(window.localStorage.getItem("huskypilot.syncStatus.v1")!).lastSync, at, "delivery time replaced the source reading time");
  await view.unmount();
});

test("a later source failure withholds ACK and a replay preserves saved history and read choices", async () => {
  const view = await mount();
  view.failMaterials(true);
  const incoming = offer(history([change("80-90", "80/100", "90/100")]));
  await view.send(incoming);
  assert.equal(posted.filter(message => message.kind === "ack").length, 0);
  const saved = parseChanges(window.localStorage.getItem(CHANGES_KEY));
  saved.entries[0].read = true;
  window.localStorage.setItem(CHANGES_KEY, JSON.stringify(saved));
  view.failMaterials(false);
  await view.send(incoming);
  assert.equal(posted.filter(message => message.kind === "ack").length, 1);
  const retried = parseChanges(window.localStorage.getItem(CHANGES_KEY));
  assert.equal(retried.entries.length, 1);
  assert.equal(retried.entries[0].read, true);
  await view.unmount();
});

test("an older background cache cannot roll back a newer manually saved grade or moved deadline", async () => {
  const newer = new Date(Date.parse(at) + 60_000).toISOString();
  const latestTask = { id: `huskyct-todo-_2_1:${newer}`, title: "Moved homework", sourceCourseId: "_1_1", course: "MATH 1131Q", start: newer, dateKey: null, end: null, allDay: false, location: null, kind: "assignment" };
  window.localStorage.setItem("huskypilot.subscriptions.v1", JSON.stringify({ version: 1, subscriptions: [{ id: "saved", name: null, courseId: null, importedAt: newer, events: [latestTask] }] }));
  const store = await openGradesStore();
  await store.put({ ...reading(99), takenAt: newer });
  const view = await mount();
  const incoming = offer();
  incoming.snapshot.tasks = JSON.parse(serialiseSyncPayload(buildSyncPayload({ feeds: [{ name: null, courseId: null, importedAt: at, events: [{ ...latestTask, id: `huskyct-todo-_2_1:${at}`, start: at, kind: "assignment" }] }], completedIds: [], courses: EMPTY_COURSE_BOOK, now: new Date(at) })));
  await view.send(incoming);
  assert.equal(JSON.parse(window.localStorage.getItem(GRADES_STORAGE_KEY)!).courses[0].items[0].earned, 99);
  const subscriptions = JSON.parse(window.localStorage.getItem("huskypilot.subscriptions.v1")!).subscriptions;
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].events[0].id, latestTask.id);
  assert.equal(posted.filter(message => message.kind === "ack").length, 1);
  await view.unmount();
});

test("real helper retention cannot roll a foreground deadline back, while a fresh partial read can move it", async () => {
  type RecordRow = { uid: string; title: string; course: string; courseId: string; start: string; observedAt?: string };
  type Basket = { todos: RecordRow[]; dueDates: RecordRow[] };
  type Helper = {
    emptyBasket(): Basket;
    rememberDueDates(basket: Basket, records: RecordRow[], now: Date): { basket: Basket };
    rememberTodos(basket: Basket, records: RecordRow[], now: Date): { basket: Basket };
    basketContents(basket: Basket): { records: RecordRow[] };
    syncPayload(records: RecordRow[], now: Date): SyncPayload;
  };
  const helperWindow = { location: { protocol: "chrome-extension:" }, __huskyctHelper: undefined as Helper | undefined,
    __bhcHelperRuntime: { headless: true, origin: "https://lms.uconn.edu", credentials: "include", storage: { getItem: () => null, setItem: () => {} } } };
  vm.runInNewContext(readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8"), { window: helperWindow, navigator: { language: "en" }, Date, URL, console });
  const helper = helperWindow.__huskyctHelper!;
  const times = [0, 60_000, 120_000, 180_000].map(offset => new Date(Date.parse(at) + offset));
  const record = { uid: "huskyct-todo-_2_1", title: "Homework", course: "MATH 1131Q", courseId: "_1_1", start: "2026-10-21T18:00:00.000Z" };
  let basket = helper.rememberDueDates(helper.emptyBasket(), [record], times[0]).basket;
  const collected = (now: Date) => {
    const incoming = offer();
    incoming.snapshot.at = now.toISOString();
    incoming.snapshot.tasks = JSON.parse(JSON.stringify({ ...helper.syncPayload(helper.basketContents(basket).records, now), doneByHuskyct: {}, reopened: [] }));
    return incoming.snapshot;
  };
  const baseline = diffBackgroundSnapshot(null, collected(times[0]), history(), times[0]);
  const corrected = { ...baseline.snapshot.tasks.feeds[0].events[0], start: "2026-10-21T20:00:00.000Z", observedAt: times[1].toISOString() };
  corrected.id = `${record.uid}:${corrected.start}`;
  window.localStorage.setItem("huskypilot.subscriptions.v1", JSON.stringify({ version: 1, subscriptions: [{ id: "saved", name: null, courseId: null, importedAt: times[1].toISOString(), events: [corrected] }] }));
  const view = await mount();
  const saved = () => JSON.parse(window.localStorage.getItem("huskypilot.subscriptions.v1")!).subscriptions[0].events;
  try {
    // Both APIs succeeded, but neither returned the submitted/past assignment.
    basket = helper.rememberDueDates(basket, [], times[2]).basket;
    basket = helper.rememberTodos(basket, [], times[2]).basket;
    const retained = diffBackgroundSnapshot(baseline.snapshot, collected(times[2]), baseline.changes, times[2]);
    assert.equal(retained.snapshot.tasks.feeds[0].events[0].observedAt, times[0].toISOString());
    await view.send({ ...offer(), snapshot: retained.snapshot, changes: retained.changes });
    assert.equal(saved()[0].start, corrected.start);
    assert.equal(posted.filter(message => message.kind === "ack").length, 1);

    // Calendar genuinely sees a new time; a failing ToDo API must not hide that evidence.
    basket = helper.rememberDueDates(basket, [{ ...record, start: "2026-10-23T22:00:00.000Z" }], times[3]).basket;
    const partial = collected(times[3]);
    partial.status.todo = false;
    const fresh = diffBackgroundSnapshot(retained.snapshot, partial, retained.changes, times[3]);
    await view.send({ ...offer(), snapshot: fresh.snapshot, changes: fresh.changes });
    assert.equal(saved()[0].start, "2026-10-23T22:00:00.000Z");
    assert.equal(saved()[0].observedAt, times[3].toISOString());
    assert.equal(posted.filter(message => message.kind === "ack").length, 2);
  } finally { await view.unmount(); }
});

test("a refused history save rolls back grades and withholds acknowledgement", async () => {
  const store = await openGradesStore();
  await store.put(reading(80));
  const before = window.localStorage.getItem(GRADES_STORAGE_KEY);
  const view = await mount();
  const storage = window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: storage.getItem.bind(storage), removeItem: storage.removeItem.bind(storage),
    setItem(key: string, value: string) { if (key === CHANGES_KEY) throw new Error("full"); storage.setItem(key, value); },
  } });
  try {
    await view.send(offer(history([change("80-90", "80/100", "90/100")])));
    assert.equal(storage.getItem(GRADES_STORAGE_KEY), before);
    assert.equal(posted.filter(message => message.kind === "ack").length, 0);
  } finally {
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    else Reflect.deleteProperty(window, "localStorage");
    await view.unmount();
  }
});

test("old or unchanged background grades keep the page's unseen score badges", async () => {
  const store = await openGradesStore();
  await store.put(reading(80));
  const newer = new Date(Date.parse(at) + 60_000).toISOString();
  await store.receive!({ ...reading(99), takenAt: newer });
  const unseen = (await store.get())!.changes;
  assert.ok(unseen?.length);
  await store.receiveBackground!(reading(80), history());
  assert.deepEqual((await store.get())!.changes, unseen);
  await store.receiveBackground!({ ...reading(99), takenAt: newer }, history());
  assert.deepEqual((await store.get())!.changes, unseen);
  await store.receiveBackground!({ ...reading(80), takenAt: new Date(Date.parse(at) + 120_000).toISOString() }, history(), {
    dueDates: true, todo: true, courses: [{ id: "_1_1", code: "MATH 1131Q", announcements: false, grades: false, files: false }],
  });
  assert.equal((await store.get())!.courses[0].items[0].earned, 99);
  assert.deepEqual((await store.get())!.changes, unseen);
});

test("partial runs cannot disguise an old cached announcement or deadline as a fresh source", async () => {
  const newer = new Date(Date.parse(at) + 60_000).toISOString();
  const latestTask = { id: `huskyct-todo-_2_1:${newer}`, title: "Moved homework", sourceCourseId: "_1_1", course: "MATH 1131Q", start: newer, dateKey: null, end: null, allDay: false, location: null, kind: "assignment" };
  window.localStorage.setItem("huskypilot.subscriptions.v1", JSON.stringify({ version: 1, subscriptions: [{ id: "saved", name: null, courseId: null, importedAt: newer, events: [latestTask] }] }));
  const announcement = { id: "one", sourceId: "_2_1", sourceCourseId: "_1_1", courseId: null, courseCode: "MATH 1131Q", title: "Homework", body: "Newest body", posted: at, announced: newer };
  window.localStorage.setItem("huskypilot.announcements.v1", JSON.stringify({ version: 1, announcements: [announcement] }));
  const view = await mount();
  const incoming = offer();
  const disguisedAt = new Date(Date.parse(at) + 120_000).toISOString();
  incoming.snapshot.tasks = JSON.parse(serialiseSyncPayload(buildSyncPayload({ feeds: [{ name: null, courseId: null, importedAt: disguisedAt, events: [{ ...latestTask, id: `huskyct-todo-_2_1:${at}`, start: at, kind: "assignment" }] }], completedIds: [], courses: EMPTY_COURSE_BOOK, announcements: [{ ...announcement, body: "Old cached body", announced: at }], now: new Date(disguisedAt) })));
  incoming.snapshot.status.todo = false;
  await view.send(incoming);
  assert.equal(JSON.parse(window.localStorage.getItem("huskypilot.subscriptions.v1")!).subscriptions[0].events[0].id, latestTask.id);
  assert.equal(JSON.parse(window.localStorage.getItem("huskypilot.announcements.v1")!).announcements[0].body, "Newest body");
  assert.equal(posted.filter(message => message.kind === "ack").length, 1);
  await view.unmount();
});

test("an old cached report cannot roll a newer source read status back", async () => {
  const view = await mount();
  const incoming = offer();
  const future = new Date(Date.parse(at) + 60_000).toISOString();
  incoming.snapshot.tasks.exportedAt = future;
  await view.send(incoming);
  assert.equal(JSON.parse(window.localStorage.getItem("huskypilot.syncStatus.v1")!).lastSync, future);
  await view.send(offer());
  assert.equal(JSON.parse(window.localStorage.getItem("huskypilot.syncStatus.v1")!).lastSync, future);
  await view.unmount();
});
