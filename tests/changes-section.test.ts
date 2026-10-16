import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { CHANGES_CHANGED, CHANGES_KEY, parseChanges, saveChanges, type ChangeEntry } from "../src/lib/changes.ts";
import { LOCALE_STORAGE_KEY, t } from "../src/lib/i18n.ts";
import { installDom } from "./support/dom.ts";

const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { renderToString } = await import("react-dom/server");
const { ChangesSection } = await import("../src/components/changes-section.tsx");
const { CalendarProvider } = await import("../src/components/calendar-provider.tsx");
const { window } = dom;
after(() => dom.uninstall());
beforeEach(() => window.localStorage.clear());

const day = new Date();
day.setHours(12, 0, 0, 0);
const TODAY = day.toISOString();
const LATER = new Date(day.valueOf() + 3_600_000).toISOString();
const previousDay = new Date(day);
previousDay.setDate(previousDay.getDate() - 1);
const YESTERDAY = previousDay.toISOString();

function entry(id: string, patch: Partial<ChangeEntry> = {}): ChangeEntry {
  return { id, at: TODAY, kind: "grade", courseCode: "MATH 1131Q", title: `Homework ${id}`, read: false, ...patch };
}

function seed(entries: ChangeEntry[]) {
  saveChanges(window.localStorage as unknown as Storage, { version: 1, entries, baselines: ["grades"] });
}

function page() {
  return createElement(CalendarProvider, { initialNow: "2026-10-16T12:00:00.000Z", children: createElement(ChangesSection) });
}

async function mount() {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(page()));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  return {
    container,
    text: () => container.textContent ?? "",
    unread: () => container.querySelectorAll(`[aria-label="${t("en", "changes.unread")}"]`).length,
    click: async (label: string) => {
      const button = [...container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === label || button.textContent === label);
      assert.ok(button, `no button ${label}`);
      await act(async () => (button as unknown as HTMLButtonElement).click());
    },
    changed: (type = CHANGES_CHANGED) => act(async () => { window.dispatchEvent(new window.Event(type)); }),
    unmount: async () => { await act(async () => root.unmount()); container.remove(); },
  };
}

test("server markup waits for this browser's changes, even when the test browser has data", () => {
  seed([entry("private-title")]);
  const html = renderToString(page());
  assert.ok(html.includes(t("en", "common.loading")));
  assert.ok(!html.includes("Homework private-title"));
  assert.ok(!html.includes(t("en", "changes.emptyTitle")));
});

test("changes are grouped by local day, newest first, with course, detail and related page", async () => {
  seed([
    entry("old", { at: YESTERDAY, read: true }),
    entry("middle"),
    entry("new", { at: LATER, detail: { from: "18/20", to: "20/20", text: "Feedback added" }, ref: { page: "/grades", id: "item-1" } }),
  ]);
  const view = await mount();
  assert.deepEqual([...view.container.querySelectorAll("h3")].map((node) => node.textContent), ["Homework new", "Homework middle", "Homework old"]);
  assert.equal(view.container.querySelectorAll("h2").length, 2);
  assert.equal(view.unread(), 2);
  assert.ok(view.text().includes("MATH 1131Q"));
  assert.ok(view.text().includes(t("en", "changes.kind.grade")));
  assert.ok(view.text().includes("18/20 → 20/20"));
  assert.ok(view.text().includes("Feedback added"));
  assert.ok(view.container.querySelector('a[href="/grades"]'));
  assert.equal(view.container.querySelector("time")?.getAttribute("datetime"), LATER);
  await view.unmount();
});

test("empty Changes explains the baseline and later syncs", async () => {
  const view = await mount();
  assert.ok(view.text().includes(t("en", "changes.emptyTitle")));
  assert.ok(view.text().includes(t("en", "changes.emptyBody")));
  assert.equal(view.container.querySelector("button"), null);
  await view.unmount();
});

test("an all-day deadline move keeps its calendar dates without a midnight time", async () => {
  seed([entry("all-day", {
    kind: "deadline-moved",
    detail: { from: "2026-10-17", to: "2026-10-19" },
    ref: { page: "/tasks" },
  })]);
  const view = await mount();
  assert.equal(view.container.querySelector("li p")?.textContent, "Oct 17, 2026 → Oct 19, 2026");
  await view.unmount();
});

test("all change types and actions are translated into Chinese", async () => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
  const kinds = ["grade", "announcement-new", "announcement-edited", "deadline-moved", "deadline-added", "file-new", "done-by-huskyct"] as const;
  seed(kinds.map((kind) => entry(kind, { kind, ...(kind === "deadline-moved" ? { detail: { from: TODAY, to: LATER } } : {}) })));
  const view = await mount();
  for (const kind of kinds) assert.ok(view.text().includes(t("zh-CN", `changes.kind.${kind}`)));
  assert.ok(view.text().includes(t("zh-CN", "changes.markAllRead")));
  assert.ok(view.text().includes(t("zh-CN", "changes.markRead")));
  await view.unmount();
});

test("marking one entry reads current storage, preserves another tab's new entry, and notifies the page", async () => {
  seed([entry("old")]);
  const view = await mount();
  // The other tab wrote after this render, before its storage event reaches us.
  seed([entry("old"), entry("other-tab", { at: LATER })]);
  await view.click(t("en", "changes.markReadLabel", { title: "Homework old" }));
  const saved = parseChanges(window.localStorage.getItem(CHANGES_KEY));
  assert.equal(saved.entries.find((row) => row.id === "old")?.read, true);
  assert.equal(saved.entries.find((row) => row.id === "other-tab")?.read, false);
  assert.deepEqual(saved.baselines, ["grades"]);
  assert.ok(view.text().includes("Homework other-tab"));
  assert.equal(view.unread(), 1);
  await view.click(t("en", "changes.markAllRead"));
  assert.equal(view.unread(), 0);
  assert.ok(parseChanges(window.localStorage.getItem(CHANGES_KEY)).entries.every((row) => row.read));
  await view.unmount();
});

test("cross-tab storage events refresh the list and unread dots", async () => {
  const view = await mount();
  seed([entry("arrived")]);
  await view.changed("storage");
  assert.ok(view.text().includes("Homework arrived"));
  assert.equal(view.unread(), 1);
  seed([entry("arrived", { read: true })]);
  await view.changed("storage");
  assert.equal(view.unread(), 0);
  await view.unmount();
});

test("returning to a tab after 31 days removes expired entries and unread dots without a storage write", async () => {
  seed([entry("expires")]);
  const view = await mount();
  const raw = window.localStorage.getItem(CHANGES_KEY);
  assert.equal(view.unread(), 1);
  const RealDate = Date;
  const elapsed = 31 * 86_400_000;
  try {
    globalThis.Date = class extends RealDate {
      constructor(...args: ConstructorParameters<DateConstructor> | []) {
        if (args.length === 0) super(RealDate.now() + elapsed);
        else super(...(args as ConstructorParameters<DateConstructor>));
      }
      static now() { return RealDate.now() + elapsed; }
    } as DateConstructor;
    await act(async () => { window.dispatchEvent(new window.Event("focus")); });
    assert.ok(!view.text().includes("Homework expires"));
    assert.equal(view.unread(), 0);
    assert.ok(view.text().includes(t("en", "changes.emptyTitle")));
    assert.equal(window.localStorage.getItem(CHANGES_KEY), raw);
  } finally {
    globalThis.Date = RealDate;
    await view.unmount();
  }
});

test("a failed write keeps the entry unread and displays an error; retry clears it", async () => {
  seed([entry("saved")]);
  const view = await mount();
  const storage = window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: storage.getItem.bind(storage),
    setItem() { throw new Error("Full"); },
  } });
  try {
    await view.click(t("en", "changes.markAllRead"));
    assert.equal(view.unread(), 1);
    assert.equal(parseChanges(storage.getItem(CHANGES_KEY)).entries[0].read, false);
    assert.equal(view.container.querySelector('[role="alert"]')?.textContent, t("en", "errors.saveFailed"));
  } finally {
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    else Reflect.deleteProperty(window, "localStorage");
  }
  await view.click(t("en", "changes.markAllRead"));
  assert.equal(view.unread(), 0);
  assert.equal(view.container.querySelector('[role="alert"]'), null);
  await view.unmount();
});

test("blocked storage is reported without claiming that there are no changes", async () => {
  const view = await mount();
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("Blocked"); } });
  try {
    await view.changed();
    assert.equal(view.container.querySelector('[role="alert"]')?.textContent, t("en", "changes.unavailable"));
    assert.ok(!view.text().includes(t("en", "changes.emptyTitle")));
  } finally {
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    else Reflect.deleteProperty(window, "localStorage");
    await view.unmount();
  }
});
