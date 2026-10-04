import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import type { GradesSnapshot } from "../src/lib/grades.ts";
import { openGradesStore } from "../src/lib/grades-store.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { t } from "../src/lib/i18n.ts";
import { buildSyncPayload, encodeSyncPayload } from "../src/lib/sync.ts";
import { REOPENED_STORAGE_KEY } from "../src/lib/task-status.ts";
import { installDom } from "./support/dom.ts";

/**
 * The To-do page on the real provider: tasks imported, grades arriving, and
 * what is done worked out from them.
 */
const dom = installDom();
const { createElement, act, Fragment } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CalendarProvider, useCalendar } = await import("../src/components/calendar-provider.tsx");
const { TodoSection } = await import("../src/components/todo-section.tsx");

type Calendar = ReturnType<typeof useCalendar>;
const { window } = dom;
after(() => dom.uninstall());
beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "";
});

const DAY = 86_400_000;
const inDays = (days: number, hour = 20) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

type Event = { id: string; title: string; course: string | null; start: string };
const event = ({ id, title, course, start }: Event) => ({
  id: `${id}:${start}`,
  title,
  course,
  start,
  dateKey: null,
  end: null,
  allDay: false,
  location: null,
  kind: "assignment" as const,
});

const EVENTS: Event[] = [
  { id: "hw41", title: "Section 4.1 Homework", course: "MATH 1070Q", start: inDays(2) }, // handed in
  { id: "hw42", title: "Section 4.2 Homework", course: "MATH 1070Q", start: inDays(3) }, // graded
  { id: "hw43", title: "Section 4.3 Homework", course: "MATH 1070Q", start: inDays(4) }, // not yet
  { id: "essay", title: "Essay draft", course: "SOCI 1501", start: inDays(5) }, // not in the gradebook
  { id: "missed", title: "Reading response", course: "SOCI 1501", start: inDays(-2) }, // overdue
];

const GRADES: GradesSnapshot = {
  version: 1,
  term: "Fall 2026",
  takenAt: new Date().toISOString(),
  courses: [
    {
      id: "_203765_1",
      code: "MATH 1070Q",
      items: [
        { id: "_1_1", title: "Section 4.1 Homework", status: "1 attempt submitted", earned: null, possible: null, label: "Not graded" },
        { id: "_2_1", title: "Section 4.2 Homework", status: "1 attempt submitted", earned: 105, possible: 100, label: null },
        { id: "_3_1", title: "Section 4.3 Homework", status: null, earned: null, possible: null, label: "Not graded" },
      ],
    },
  ],
};

async function mountTodo(options: { grades?: GradesSnapshot | null; extra?: Event[] } = {}) {
  if (options.grades) await (await openGradesStore()).put(options.grades);

  const packed = await encodeSyncPayload(
    buildSyncPayload({
      feeds: [{ name: "HuskyCT to-do", courseId: null, importedAt: new Date().toISOString(), events: [...EVENTS, ...(options.extra ?? [])].map(event) }],
      completedIds: [],
      efforts: {},
      courses: EMPTY_COURSE_BOOK,
    }),
  );

  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  let latest: Calendar | null = null;
  function Probe() {
    latest = useCalendar();
    return null;
  }
  const root = createRoot(container as unknown as Element);
  await act(async () => {
    root.render(
      createElement(CalendarProvider, {
        initialNow: new Date().toISOString(),
        children: createElement(Fragment, null, createElement(Probe), createElement(TodoSection)),
      }),
    );
  });
  await settle();
  await act(async () => {
    window.location.hash = `#sync=${packed}`;
    window.dispatchEvent(new window.Event("hashchange"));
  });
  await settle(50);
  await act(async () => latest!.applyPendingSync());
  await settle(80);

  return {
    get calendar(): Calendar {
      return latest!;
    },
    text: () => container.textContent ?? "",
    button: (label: string) => [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label)),
    checkbox: (title: string) =>
      [...container.querySelectorAll("input[type=checkbox]")].find((i) => (i.getAttribute("aria-label") ?? "").includes(title)) as unknown as HTMLInputElement,
    click: (el: unknown) => act(async () => (el as HTMLElement).click()),
    unmount: () => act(async () => root.unmount()),
  };
}

async function settle(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** The part of the page before "Done (n)", which is where the open work is. */
const openPart = (text: string) => text.split(t("en", "todo.done", { count: 2 }))[0];

test("work HuskyCT says is handed in or graded is done, and the rest is still to do", async () => {
  const view = await mountTodo({ grades: GRADES });
  const text = view.text();

  assert.ok(text.includes(t("en", "todo.summary", { open: 3, done: 2 })), text.slice(0, 400));
  const open = openPart(text);
  assert.ok(open.includes("Section 4.3 Homework"), "work that is not in was hidden");
  assert.ok(open.includes("Essay draft"), "a task the gradebook does not list was marked done");
  assert.ok(open.includes("Reading response") && open.includes(t("en", "todo.overdue")));
  assert.ok(!open.includes("Section 4.1 Homework") && !open.includes("Section 4.2 Homework"), "done work is in the open list");
  await view.unmount();
});

test("done work is kept apart, named for why it is done, and shown on request", async () => {
  const view = await mountTodo({ grades: GRADES });
  assert.ok(!view.text().includes(t("en", "badge.submitted")), "done work showed before it was asked for");

  await view.click(view.button(t("en", "todo.done", { count: 2 })));

  assert.ok(view.text().includes(t("en", "badge.submitted")));
  assert.ok(view.text().includes(t("en", "badge.graded")));
  assert.equal(view.calendar.doneLabelFor(view.calendar.tasks.find((x) => x.title === "Section 4.1 Homework")!.id), "submitted");
  assert.equal(view.calendar.doneLabelFor(view.calendar.tasks.find((x) => x.title === "Section 4.2 Homework")!.id), "graded");
  await view.unmount();
});

test("pressing the tick on work HuskyCT says is done reopens it, and it stays reopened", async () => {
  const view = await mountTodo({ grades: GRADES });
  const id = view.calendar.tasks.find((x) => x.title === "Section 4.1 Homework")!.id;
  await view.click(view.button(t("en", "todo.done", { count: 2 })));

  await view.click(view.checkbox("Section 4.1 Homework"));

  assert.ok(openPart(view.text()).includes("Section 4.1 Homework"), "a reopened task did not return to the list");
  assert.equal(view.calendar.doneIds.has(id), false);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(REOPENED_STORAGE_KEY) ?? "[]"), [id]);
  await view.unmount();

  // A later visit still has it open.
  const again = await mountTodo({ grades: GRADES });
  assert.equal(again.calendar.doneIds.has(id), false);

  // Pressing it once more lets HuskyCT's word stand.
  await again.click(again.checkbox("Section 4.1 Homework"));
  assert.equal(again.calendar.doneIds.has(id), true);
  assert.equal(window.localStorage.getItem(REOPENED_STORAGE_KEY), null);
  await again.unmount();
});

test("a tick of the student's own still works for work the gradebook knows nothing about", async () => {
  const view = await mountTodo({ grades: GRADES });
  const id = view.calendar.tasks.find((x) => x.title === "Essay draft")!.id;

  await view.click(view.checkbox("Essay draft"));

  assert.equal(view.calendar.doneIds.has(id), true);
  assert.equal(view.calendar.doneLabelFor(id), "ticked");
  assert.ok(view.text().includes(t("en", "todo.summary", { open: 2, done: 3 })));
  await view.unmount();
});

test("grades that arrive while the page is open tick the work without a reload", async () => {
  const view = await mountTodo();
  assert.ok(view.text().includes(t("en", "todo.summary", { open: 5, done: 0 })));
  assert.ok(view.text().includes(t("en", "todo.noGradesHint")), "no hint about how to get work ticked");

  await act(async () => {
    await (await openGradesStore()).put(GRADES);
  });
  await settle(80);

  assert.ok(view.text().includes(t("en", "todo.summary", { open: 3, done: 2 })));
  assert.ok(view.text().includes(t("en", "todo.autoHint")));
  assert.ok(!view.text().includes(t("en", "todo.noGradesHint")));
  await view.unmount();
});

test("the course filter narrows the list to one course", async () => {
  const view = await mountTodo({ grades: GRADES });

  await view.click(view.button("SOCI 1501"));

  assert.ok(view.text().includes("Essay draft"));
  assert.ok(!view.text().includes("Section 4.3 Homework"));
  assert.ok(view.text().includes(t("en", "todo.summary", { open: 2, done: 0 })));
  await view.unmount();
});

test("work already handed in is not a reminder, even when it is due in hours", async () => {
  const soon = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
  const grades: GradesSnapshot = {
    ...GRADES,
    courses: [
      {
        ...GRADES.courses[0],
        items: [
          ...GRADES.courses[0].items,
          { id: "_8_1", title: "Quiz tonight", status: "1 attempt submitted", earned: null, possible: null, label: "Not graded" },
        ],
      },
    ],
  };
  const view = await mountTodo({
    grades,
    extra: [
      { id: "quizA", title: "Quiz tonight", course: "MATH 1070Q", start: soon(5) }, // handed in
      { id: "quizB", title: "Lab report", course: "SOCI 1501", start: soon(6) }, // not
    ],
  });

  assert.deepEqual(view.calendar.dueSoon.map((task) => task.title), ["Lab report"]);
  await view.unmount();
});
