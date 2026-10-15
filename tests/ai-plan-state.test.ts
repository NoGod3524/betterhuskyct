import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { addFound, EMPTY_PLAN_STATE, PLAN_STORAGE_KEY, savePlanState } from "../src/lib/ai-plan.ts";
import { saveCustomEvents } from "../src/lib/custom-events.ts";
import { saveAnnouncements, type Announcement } from "../src/lib/announcements.ts";
import { DECISIONS_KEY } from "../src/lib/announcement-decisions.ts";
import { t } from "../src/lib/i18n.ts";
import { saveUndatedTodos, UNDATED_TODOS_KEY } from "../src/lib/undated-todos.ts";
import type { MaterialsStore } from "../src/lib/materials.ts";
import { installDom } from "./support/dom.ts";
import { memoryMaterialsStore } from "./support/memory-stores.ts";

const dom = installDom();
const { window } = dom;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CalendarProvider, useCalendar } = await import("../src/components/calendar-provider.tsx");
const { AiPlanProvider, useAiPlan } = await import("../src/components/ai-plan-provider.tsx");
const { AiPlanPanel } = await import("../src/components/ai-plan-panel.tsx");
const { CandidateList } = await import("../src/components/announcement-actions-panel.tsx");
after(() => dom.uninstall());
beforeEach(() => window.localStorage.clear());

const AT = "2026-10-15T12:00:00.000Z";
const DAY = "2026-12-01";
const meta = { course: "TEST 1000", from: "syllabus" as const, fromLabel: () => "Syllabus.txt", foundAt: AT };
const dated = { title: "Final exam", date: DAY, time: null, kind: "exam" as const, evidence: "Final exam", source: null };
const undated = { ...dated, title: "Buy book", date: null, kind: "task" as const };
const savedPlan = () => JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY)!);
const savedEvents = () => JSON.parse(window.localStorage.getItem("huskypilot.customEvents.v1") ?? "[]");

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

async function mount(options: { store?: MaterialsStore; announcement?: Announcement; fetchImpl?: (url: string, init: RequestInit) => Promise<Response> } = {}) {
  let calendar!: ReturnType<typeof useCalendar>;
  let plan!: NonNullable<ReturnType<typeof useAiPlan>>;
  function Probe() {
    calendar = useCalendar(); plan = useAiPlan()!;
    return createElement("div", null, createElement(AiPlanPanel), options.announcement ? createElement(CandidateList, { announcement: options.announcement, locale: "en", versionAt: null }) : null);
  }
  const node = window.document.createElement("div");
  window.document.body.appendChild(node);
  const root = createRoot(node as unknown as Element);
  await act(async () => root.render(createElement(CalendarProvider, {
    initialNow: AT,
    children: createElement(AiPlanProvider, {
      openMaterials: async () => options.store ?? memoryMaterialsStore(),
      fetchImpl: options.fetchImpl ?? (async () => Response.json({ items: [] })),
      wait: async () => {},
      children: createElement(Probe),
    }),
  })));
  await settle();
  return { node, get calendar() { return calendar; }, get plan() { return plan; }, alert: () => node.querySelector('[role="alert"]')?.textContent, close: async () => {
    await act(async () => root.unmount()); node.remove();
  } };
}

function failWrites(key: string) {
  const storage = window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: storage.getItem.bind(storage), removeItem: storage.removeItem.bind(storage),
    setItem: (name: string, value: string) => {
      if (name === key) throw new Error("QuotaExceededError");
      storage.setItem(name, value);
    },
  } });
  return () => {
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    else Reflect.deleteProperty(window, "localStorage");
  };
}

test("a full calendar leaves the AI suggestion pending", async () => {
  saveCustomEvents(window.localStorage, Array.from({ length: 500 }, (_, i) => ({
    id: `custom-${i}`, title: "Existing", course: null, start: `${DAY}T00:00:00Z`, dateKey: DAY,
    end: null, allDay: true, location: null, note: null, kind: "assignment",
  })));
  savePlanState(window.localStorage, addFound(EMPTY_PLAN_STATE, [dated], meta));
  const view = await mount();
  try {
    const id = view.plan.pending[0].id;
    await act(async () => { view.plan.resolve([{ id, day: DAY }], []); });
    assert.equal(view.plan.pending.length, 1);
    assert.equal(savedPlan().decided[id], undefined);
    assert.equal(savedEvents().length, 500);
    assert.match(view.alert() ?? "", /could not be saved/);
  } finally { await view.close(); }
});

for (const dated of [true, false]) {
  test(`a failed announcement ${dated ? "event" : "undated to-do"} stays editable with an error`, async () => {
    const view = await mount({ announcement: { id: "a1", courseId: null, courseCode: "TEST 1000", title: dated ? "Homework due December 1, 2026" : "Homework due", body: "", posted: null, announced: AT } });
    const restore = failWrites(dated ? "huskypilot.customEvents.v1" : UNDATED_TODOS_KEY);
    try {
      await act(async () => { (view.node.querySelector('[aria-expanded]') as unknown as HTMLElement).click(); });
      const row = view.node.querySelector('[data-candidate]')!;
      const title = row.querySelector("input")!.value;
      const button = [...row.querySelectorAll("button")].find((button) => button.textContent === t("en", dated ? "ann.add" : "ann.addNoDay"))!;
      await act(async () => button.click());
      assert.equal(row.querySelector('[role="alert"]')?.textContent, t("en", "errors.saveFailed"));
      assert.equal(row.querySelector("input")!.value, title);
      assert.equal(window.localStorage.getItem(DECISIONS_KEY), null);
    } finally { restore(); await view.close(); }
  });
}

test("mixed acceptance keeps only the unsaved undated suggestion pending", async () => {
  saveUndatedTodos(window.localStorage, Array.from({ length: 300 }, (_, i) => ({
    id: `old-${i}`, title: "Existing", course: null, note: null, done: false, addedAt: AT,
  })));
  savePlanState(window.localStorage, addFound(EMPTY_PLAN_STATE, [dated, undated], meta));
  const view = await mount();
  try {
    await act(async () => { view.plan.resolve(view.plan.pending.map((item) => ({ id: item.id, day: item.date })), []); });
    assert.deepEqual(view.plan.pending.map((item) => item.title), ["Buy book"]);
    assert.equal(view.plan.undated.length, 300);
    assert.equal(JSON.parse(window.localStorage.getItem(UNDATED_TODOS_KEY)!).length, 300);
    assert.equal(savedEvents().length, 1);
    assert.equal(Object.values(savedPlan().decided).length, 1);
  } finally { await view.close(); }
});

test("a failed undated write neither consumes the suggestion nor changes the visible list", async () => {
  savePlanState(window.localStorage, addFound(EMPTY_PLAN_STATE, [undated], meta));
  const view = await mount();
  const restore = failWrites(UNDATED_TODOS_KEY);
  try {
    await act(async () => { view.plan.resolve([{ id: view.plan.pending[0].id, day: null }], []); });
    assert.equal(view.plan.pending.length, 1);
    assert.equal(view.plan.undated.length, 0);
    assert.equal(window.localStorage.getItem(UNDATED_TODOS_KEY), null);
    assert.deepEqual(savedPlan().decided, {});
    assert.match(view.alert() ?? "", /could not be saved/);
  } finally { restore(); await view.close(); }
});

for (const retryDay of ["2026-12-02", null]) {
  test(`a failed dated decision rolls back before retrying ${retryDay ?? "without a date"}`, async () => {
    savePlanState(window.localStorage, addFound(EMPTY_PLAN_STATE, [dated], meta));
    let view = await mount();
    const id = view.plan.pending[0].id;
    const restore = failWrites(PLAN_STORAGE_KEY);
    try {
      await act(async () => { view.plan.resolve([{ id, day: DAY }], []); });
      assert.equal(view.plan.pending.length, 1);
      assert.equal(savedEvents().length, 0);
      assert.equal(view.calendar.tasks.some((task) => task.id === `custom-${id}`), false);
      assert.equal(savedPlan().decided[id], undefined);
    } finally { restore(); await view.close(); }
    view = await mount();
    try {
      await act(async () => { view.plan.resolve([{ id, day: retryDay }], []); });
      assert.equal(savedEvents().length, retryDay ? 1 : 0);
      if (retryDay) assert.equal(savedEvents()[0].dateKey, retryDay);
      assert.equal(view.plan.undated.length, retryDay ? 0 : 1);
      assert.equal(view.plan.pending.length, 0);
      assert.equal(savedPlan().decided[id], "added");
    } finally { await view.close(); }
  });
}

test("a failed undated decision rolls back before retrying with a date", async () => {
  savePlanState(window.localStorage, addFound(EMPTY_PLAN_STATE, [undated], meta));
  const view = await mount();
  const id = view.plan.pending[0].id;
  const restore = failWrites(PLAN_STORAGE_KEY);
  try {
    await act(async () => { view.plan.resolve([{ id, day: null }], []); });
    assert.equal(view.plan.pending.length, 1);
    assert.equal(view.plan.undated.length, 0);
    assert.equal(window.localStorage.getItem(UNDATED_TODOS_KEY), null);
    assert.equal(savedPlan().decided[id], undefined);
    restore();
    await act(async () => { view.plan.resolve([{ id, day: DAY }], []); });
    assert.equal(view.plan.undated.length, 0);
    assert.equal(savedEvents().length, 1);
    assert.equal(view.plan.pending.length, 0);
    assert.equal(savedPlan().decided[id], "added");
  } finally { restore(); await view.close(); }
});

async function syllabus() {
  const store = memoryMaterialsStore();
  const key = "https://lms.uconn.edu/bbcswebdav/syllabus.txt";
  await store.putIndex({ version: 1, term: "Fall 2026", updatedAt: AT, courses: [{
    id: "_1_1", code: "TEST 1000", files: [{ key, title: "Syllabus", path: [] }], links: [], tools: [],
  }] });
  await store.putFile({ key, name: "Syllabus.txt", type: "text/plain", size: 10, blob: new Blob(["Final exam on December 1"]), savedAt: AT });
  return store;
}

for (const action of ["disable", "clear"] as const) {
  test(`a late syllabus answer is ignored after ${action}`, async () => {
    const store = await syllabus();
    let finish!: (response: Response) => void;
    const answer = new Promise<Response>((resolve) => { finish = resolve; });
    let calls = 0;
    const view = await mount({ store, fetchImpl: async () => { calls++; return answer; } });
    try {
      await act(async () => view.plan.enable());
      await settle();
      assert.equal(calls, 1);
      await act(async () => { if (action === "disable") view.plan.disable(); else await store.clear(); });
      await act(async () => { finish(Response.json({ items: [dated], summary: "- Exam on December 1" })); });
      await settle();
      assert.equal(view.plan.pending.length, 0);
      assert.deepEqual(view.plan.summaries, {});
      assert.deepEqual(savedPlan().read, {});
    } finally { await view.close(); }
  });
}

test("clearing announcements while a request is pending discards its answer", async () => {
  saveAnnouncements(window.localStorage, [{ id: "a1", courseId: null, courseCode: "TEST 1000", title: "Exam", body: "Final exam", posted: null, announced: new Date().toISOString() }]);
  let finish!: (response: Response) => void;
  const answer = new Promise<Response>((resolve) => { finish = resolve; });
  let calls = 0;
  const view = await mount({ fetchImpl: async () => { calls++; return answer; } });
  try {
    await act(async () => view.plan.enable());
    await settle();
    assert.equal(calls, 1);
    await act(async () => view.calendar.clearAnnouncements());
    await act(async () => { finish(Response.json({ items: [{ ...dated, source: 1 }] })); });
    await settle();
    assert.equal(view.plan.pending.length, 0);
    assert.deepEqual(savedPlan().read, {});
  } finally { await view.close(); }
});

test("a replaced syllabus cannot save the old file's suggestions or summary", async () => {
  const store = await syllabus();
  let finish!: (response: Response) => void;
  const answer = new Promise<Response>((resolve) => { finish = resolve; });
  const view = await mount({ store, fetchImpl: async () => answer });
  try {
    await act(async () => view.plan.enable());
    await settle();
    const [file] = await store.files();
    await store.putFile({ ...file, savedAt: "2026-10-16T00:00:00Z", blob: new Blob(["New exam date"]) });
    await act(async () => { finish(Response.json({ items: [dated], summary: "- Old exam date" })); });
    await settle();
    assert.equal(view.plan.pending.length, 0);
    assert.deepEqual(view.plan.summaries, {});
    assert.deepEqual(savedPlan().read, {});
  } finally { await view.close(); }
});
