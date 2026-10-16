import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";
import { Window } from "happy-dom";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { mergeSyncPayload } from "../src/lib/sync-merge.ts";
import { mergeTasks } from "../src/lib/subscriptions.ts";
import type { SyncPayload } from "../src/lib/sync.ts";

const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");
const COURSE = "_203765_1";
const CODE = "MATH 1070Q";
const NAME = "1268-UCONN-MATH-1070Q-SEC100-1191: MATH-1070Q-Mathematics for Business and Economics-SEC100-1268";
const NOW = new Date("2026-10-16T12:00:00.000Z");
const A_DUE = "2026-11-15T23:59:00.000Z";
const B_DUE = "2026-11-22T23:59:00.000Z";
type RecordRow = { uid: string; title: string; course: string | null; courseId?: string | null; start: string };
type DueRow = Omit<RecordRow, "start"> & { due: Date };
type Basket = { version: number; courses: unknown[]; todos: RecordRow[]; todosAt: string | null; dueDates: RecordRow[]; dueDatesAt: string | null };
type Helper = {
  emptyBasket(): Basket;
  readDueDatesApi(): Promise<DueRow[]>;
  readTodosApi(options: object, codes: Map<string, string>): Promise<DueRow[]>;
  todosToRecords(rows: DueRow[]): RecordRow[];
  rememberDueDates(basket: Basket, rows: RecordRow[], now: Date): { basket: Basket };
  rememberTodos(basket: Basket, rows: RecordRow[], now: Date): { basket: Basket };
  deadlineRecords(basket: Basket): RecordRow[];
  syncPayload(rows: RecordRow[], now: Date, announcements: unknown[], colors: object): SyncPayload;
};
const windows: Window[] = [];
after(async () => { for (const window of windows) await window.happyDOM.close(); });

function page() {
  const window = new Window({ url: "https://lms.uconn.edu/ultra/stream" });
  windows.push(window);
  window.localStorage.setItem("huskypilot.helper.sync.v1", JSON.stringify({ auto: false }));
  vm.runInNewContext(SOURCE, { window, document: window.document, navigator: window.navigator, localStorage: window.localStorage, Blob, Response, TextEncoder, btoa, URL, console, setTimeout, clearTimeout });
  const helper = (window as unknown as { __huskyctHelper: Helper }).__huskyctHelper;
  let calendar: object[] = [];
  let todo: object[] = [];
  window.fetch = (async (url: unknown) => new Response(JSON.stringify(String(url).includes("/todo/")
    ? { overdueItems: [], dueTodayItems: [], futureDueItems: todo }
    : { results: calendar }), { headers: { "content-type": "application/json" } })) as unknown as typeof window.fetch;
  const dates = async () => helper.todosToRecords(await helper.readDueDatesApi());
  const sync = async (basket: Basket) => {
    basket = helper.rememberDueDates(basket, await dates(), NOW).basket;
    basket = helper.rememberTodos(basket, helper.todosToRecords(await helper.readTodosApi({}, new Map([[COURSE, CODE]]))), NOW).basket;
    return { basket, payload: helper.syncPayload(helper.deadlineRecords(basket), NOW, [], {}) };
  };
  return { helper, dates, sync, calendar: (rows: object[]) => { calendar = rows; }, todo: (rows: object[]) => { todo = rows; } };
}

const item = (id: string, title: string, endDate: string) => ({ itemSourceType: "blackboard.platform.gradebook2.GradableItem", itemSourceId: id, calendarId: COURSE, calendarNameLocalizable: { rawValue: NAME }, title, endDate });
const todo = (id: string, title: string, dueDate: string) => ({ title, dueDate, column: { id, courseId: COURSE } });
const emptyLocal = () => ({ courses: EMPTY_COURSE_BOOK, completedIds: new Set<string>(), subscriptions: [] });

test("Calendar -> ToDo -> a deadline outside ToDo keeps one task and its tick", async () => {
  const p = page();
  p.calendar([item("_101_1", "Final Project", A_DUE)]);
  const first = await p.sync(p.helper.emptyBasket());
  let local = mergeSyncPayload(emptyLocal(), first.payload);
  const originalId = first.payload.feeds[0].events[0].id;
  local.completedIds.add(originalId);

  p.todo([todo("_101_1", "Final Project", A_DUE)]);
  const second = await p.sync(first.basket);
  local = mergeSyncPayload(local, second.payload);
  assert.equal(mergeTasks(local.subscriptions).length, 1);
  assert.ok(local.completedIds.has(mergeTasks(local.subscriptions)[0].id));

  p.calendar([item("_101_1", "Final Project (extended)", B_DUE)]);
  p.todo([]);
  const third = await p.sync(second.basket);
  local = mergeSyncPayload(local, third.payload);
  const tasks = mergeTasks(local.subscriptions);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].start, B_DUE);
  assert.equal(tasks[0].title, "Final Project (extended)");
  assert.ok(local.completedIds.has(tasks[0].id));
  assert.equal(local.moves.length, 1);
  assert.equal(third.basket.dueDates[0].courseId, COURSE, "source course identity survives the basket conversion");
});

test("same-title tasks keep their identities when the API order changes and one leaves the window", async () => {
  const p = page();
  const a = item("_101_1", "Weekly Reading", A_DUE);
  const b = item("_102_1", "Weekly Reading", B_DUE);
  p.calendar([a, b]);
  const first = await p.sync(p.helper.emptyBasket());
  let local = mergeSyncPayload(emptyLocal(), first.payload);
  const aId = first.payload.feeds[0].events.find(task => task.start === A_DUE)!.id;
  const bId = first.payload.feeds[0].events.find(task => task.start === B_DUE)!.id;
  local.completedIds.add(aId);

  p.calendar([b, a]);
  const reordered = await p.sync(first.basket);
  local = mergeSyncPayload(local, reordered.payload);
  assert.deepEqual(new Set(mergeTasks(local.subscriptions).map(task => task.id)), new Set([aId, bId]));
  assert.equal(local.moves.length, 0);

  p.calendar([b]);
  const after = await p.sync(reordered.basket);
  local = mergeSyncPayload(local, after.payload);
  assert.deepEqual(new Set(mergeTasks(local.subscriptions).map(task => task.id)), new Set([aId, bId]));
  assert.deepEqual(local.completedIds, new Set([aId]));
  assert.equal(local.moves.length, 0, "A leaving the window is not A moving to B's date");
});

test("Calendar fallback ids are deterministic, distinct from column ids, and never claim a source-less move", async () => {
  const p = page();
  const source = item("_101_1", "Reading", A_DUE);
  const byCalendar = { ...source, itemSourceId: undefined, id: "_101_1" };
  const noId = { ...source, itemSourceId: undefined };
  const punctuation = { ...noId, title: "Reading!" };
  const otherDate = { ...noId, endDate: B_DUE };
  const otherCourse = { ...noId, calendarId: "_203766_1" };
  p.calendar([source, byCalendar, noId, punctuation, otherDate, otherCourse]);
  const first = await p.dates();
  assert.equal(first.length, 6);
  assert.equal(first[0].uid, "huskyct-todo-_101_1");
  assert.equal(first[1].uid, "huskyct-calendar-_101_1");
  assert.equal(new Set(first.map(row => row.uid)).size, 6);

  p.calendar([otherCourse, otherDate, punctuation, noId, byCalendar, source]);
  const second = await p.dates();
  assert.deepEqual(second.map(row => row.uid).reverse(), first.map(row => row.uid));
  assert.notEqual(first[2].uid, first[4].uid, "without a source id, a changed date must not be presented as a proven move");
});
