import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { localDay, PLAN_STORAGE_KEY } from "../src/lib/ai-plan.ts";
import type { Announcement } from "../src/lib/announcements.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { t } from "../src/lib/i18n.ts";
import { type MaterialsStore } from "../src/lib/materials.ts";
import type { PlanRequest } from "../src/lib/plan-models.ts";
import { buildSyncPayload, encodeSyncPayload } from "../src/lib/sync.ts";
import { UNDATED_TODOS_KEY } from "../src/lib/undated-todos.ts";
import { installDom } from "./support/dom.ts";
import { makePdf } from "./support/pdf.ts";
import { memoryMaterialsStore } from "./support/memory-stores.ts";

/**
 * The To-do page with the AI list on the real providers: a syllabus in the
 * course files, a model behind a stubbed endpoint, and what the student does
 * with the list ending up in the calendar and the to-do list.
 */
const dom = installDom();
const { createElement, act, Fragment } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CalendarProvider, useCalendar } = await import("../src/components/calendar-provider.tsx");
const { AiPlanProvider } = await import("../src/components/ai-plan-provider.tsx");
const { TodoSection } = await import("../src/components/todo-section.tsx");
const { MaterialsSection } = await import("../src/components/materials-section.tsx");

type Calendar = ReturnType<typeof useCalendar>;
const { window } = dom;
after(() => dom.uninstall());
beforeEach(() => window.localStorage.clear());

const inDays = (days: number) => localDay(new Date(Date.now() + days * 86_400_000));
const EXAM_DAY = inDays(20);

async function storeWithSyllabus(): Promise<MaterialsStore> {
  const store = memoryMaterialsStore();
  const key = "https://lms.uconn.edu/bbcswebdav/syllabus.pdf";
  await store.putIndex({
    version: 1,
    term: "Fall 2026",
    updatedAt: new Date().toISOString(),
    courses: [{ id: "_203765_1", code: "MATH 1070Q", files: [{ key, path: [], title: "Syllabus" }], links: [], tools: [] }],
  });
  await store.putFile({
    key,
    name: "MATH1070 Syllabus.pdf",
    type: "application/pdf",
    size: 1,
    blob: new Blob([makePdf([`Midterm 1 on ${EXAM_DAY}`, "Buy the textbook before class"])]),
    savedAt: "2026-09-01T00:00:00.000Z",
  });
  return store;
}

type Answer = (request: PlanRequest) => unknown;

function endpoint(answer: Answer) {
  const requests: PlanRequest[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    assert.equal(url, "/api/plan/extract");
    const request = JSON.parse(String(init.body)) as PlanRequest;
    requests.push(request);
    return Response.json(answer(request));
  };
  return { requests, fetchImpl };
}

const SYLLABUS_ITEMS = {
  items: [
    { title: "Midterm 1", date: EXAM_DAY, time: null, kind: "exam", evidence: `Midterm 1 on ${EXAM_DAY}`, source: null },
    { title: "Buy the textbook", date: null, time: null, kind: "task", evidence: "Buy the textbook before class", source: null },
  ],
  provider: "glm",
};

async function mount(options: { store?: MaterialsStore; answer?: Answer; announcements?: Announcement[]; realWait?: boolean; withMaterials?: boolean } = {}) {
  const store = options.store ?? (await storeWithSyllabus());
  const { requests, fetchImpl } = endpoint(options.answer ?? (() => SYLLABUS_ITEMS));

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
        children: createElement(AiPlanProvider, {
          openMaterials: async () => store,
          fetchImpl,
          // The page itself passes no `wait`; `realWait` mounts it that way.
          ...(options.realWait ? {} : { wait: async () => {} }),
          children: createElement(
            Fragment,
            null,
            createElement(Probe),
            createElement(TodoSection),
            options.withMaterials ? createElement(MaterialsSection, { openStore: async () => store }) : null,
          ),
        }),
      }),
    );
  });
  await settle();

  if (options.announcements) {
    const packed = await encodeSyncPayload(
      buildSyncPayload({ feeds: [], completedIds: [], courses: EMPTY_COURSE_BOOK, announcements: options.announcements }),
    );
    await act(async () => {
      window.location.hash = `#sync=${packed}`;
      window.dispatchEvent(new window.Event("hashchange"));
    });
    await settle(50);
    await act(async () => latest!.applyPendingSync());
    await settle(50);
  }

  const view = {
    requests,
    get calendar(): Calendar {
      return latest!;
    },
    text: () => container.textContent ?? "",
    button: (label: string) => [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label)) as unknown as HTMLElement,
    checkbox: (title: string) =>
      [...container.querySelectorAll("input[type=checkbox]")].find((input) => input.getAttribute("aria-label") === t("en", "aiPlan.pick", { title })) as unknown as HTMLInputElement,
    click: async (element: unknown) => {
      await act(async () => (element as HTMLElement).click());
      await settle();
    },
    unmount: () => act(async () => root.unmount()),
  };
  return view;
}

async function settle(ms = 30) {
  // Reading a PDF takes real time, so settling waits for more than one tick.
  for (let round = 0; round < 6; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }
}

test("nothing is read or sent until it is turned on", async () => {
  const view = await mount();

  assert.ok(view.text().includes(t("en", "aiPlan.offTitle")));
  assert.equal(view.requests.length, 0);
  await view.unmount();
});

test("once on, the syllabus is read and its dates listed; adding them puts them in the calendar and the to-do list", async () => {
  const view = await mount();
  await view.click(view.button(t("en", "aiPlan.enable")));
  await settle(60);

  assert.equal(view.requests.length, 1);
  const [request] = view.requests;
  assert.equal(request.kind, "syllabus");
  assert.equal(request.courseLabel, "MATH 1070Q");
  assert.equal(request.term, "Fall 2026");
  assert.ok(request.text.includes(`Midterm 1 on ${EXAM_DAY}`), "the PDF's text was not sent");

  assert.ok(view.text().includes(t("en", "aiPlan.toCheck", { count: 2 })), view.text().slice(0, 600));
  assert.equal(view.checkbox("Midterm 1").checked, true);
  assert.equal(view.checkbox("Buy the textbook").checked, true);

  await view.click(view.button(t("en", "aiPlan.add", { count: 2 })));

  const midterm = view.calendar.tasks.find((task) => task.title === "Midterm 1");
  assert.ok(midterm, "the dated find did not reach the calendar");
  assert.equal(midterm.course, "MATH 1070Q");
  assert.equal(midterm.allDay, true);
  const undated = JSON.parse(window.localStorage.getItem(UNDATED_TODOS_KEY) ?? "[]");
  assert.deepEqual(undated.map((todo: { title: string }) => todo.title), ["Buy the textbook"]);
  assert.ok(view.text().includes(t("en", "todo.undated")));
  assert.ok(!view.text().includes(t("en", "aiPlan.toCheck", { count: 2 })), "the list was not emptied");

  // Read once: checking again sends nothing more for the same file.
  await view.click(view.button(t("en", "aiPlan.checkNow")));
  await settle(60);
  assert.equal(view.requests.length, 1, "the same syllabus was sent again");
  await view.unmount();
});

test("a row left unticked is let go, and is not offered again by a later read", async () => {
  const view = await mount();
  await view.click(view.button(t("en", "aiPlan.enable")));
  await settle(60);

  await act(async () => view.checkbox("Buy the textbook").click());
  await view.click(view.button(t("en", "aiPlan.add", { count: 1 })));

  const state = JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY) ?? "{}");
  assert.deepEqual(Object.values(state.decided).sort(), ["added", "dismissed"]);
  assert.equal(JSON.parse(window.localStorage.getItem(UNDATED_TODOS_KEY) ?? "[]").length, 0, "an unticked row was added");
  await view.unmount();
});

test("a busy model leaves nothing marked read, so the syllabus is tried again later", async () => {
  const view = await mount({ answer: () => ({ problem: "busy" }) });
  await view.click(view.button(t("en", "aiPlan.enable")));
  await settle(60);

  assert.ok(view.text().includes(t("en", "aiPlan.problem.busy")), view.text().slice(0, 600));
  const state = JSON.parse(window.localStorage.getItem(PLAN_STORAGE_KEY) ?? "{}");
  assert.deepEqual(state.read, {});
  await view.unmount();
});

test("new announcements are read by course and what they ask is listed with where it came from", async () => {
  const announced = new Date().toISOString();
  const view = await mount({
    store: memoryMaterialsStore(),
    answer: (request) =>
      request.kind === "announcements"
        ? { items: [{ title: "Exam 2", date: inDays(10), time: "18:30", kind: "exam", evidence: "Exam 2 moves", source: 1 }] }
        : { items: [] },
    announcements: [{ id: "a1", courseId: null, courseCode: "SOCI 1501", title: "Exam 2 moved", body: "Exam 2 moves to next week.", posted: "Oct 1", announced }],
  });
  await view.click(view.button(t("en", "aiPlan.enable")));
  await settle(60);

  const sent = view.requests.filter((request) => request.kind === "announcements");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].courseLabel, "SOCI 1501");
  assert.ok(view.text().includes(t("en", "aiPlan.fromAnnouncement", { title: "Exam 2 moved" })), view.text().slice(0, 800));
  await view.unmount();
});

test("on the page as it is mounted for real, a service that is not set up is asked once, not again on every render", { timeout: 30_000 }, async () => {
  const view = await mount({ answer: () => ({ problem: "not-configured" }), realWait: true });
  await view.click(view.button(t("en", "aiPlan.enable")));
  await settle(60);

  assert.equal(view.requests.length, 1, `asked ${view.requests.length} times`);
  assert.ok(view.text().includes(t("en", "aiPlan.problem.unavailable")), view.text().slice(0, 600));
  await view.unmount();
});

test("each syllabus is summed up at the top of its course on the Materials page, once the reading is on", async () => {
  const view = await mount({
    withMaterials: true,
    answer: () => ({ ...SYLLABUS_ITEMS, summary: "- Grading: exams 60%, homework 40%\n- Late work loses 10% a day" }),
  });
  assert.ok(view.text().includes(t("en", "materials.syllabusHint")), "nothing said where summaries come from");

  await view.click(view.button(t("en", "aiPlan.enable")));
  await settle(60);
  assert.ok(!view.text().includes(t("en", "materials.syllabusHint")), "the hint stayed once it was on");

  const course = [...window.document.querySelectorAll("article button")].find((b) => (b.textContent ?? "").includes("MATH 1070Q"));
  await view.click(course);
  const card = window.document.querySelector("[data-syllabus-summary]");
  assert.ok(card, "no summary on the course");
  assert.ok((card.textContent ?? "").includes("Grading: exams 60%, homework 40%"));
  assert.ok((card.textContent ?? "").includes(t("en", "materials.syllabusFrom", { files: "MATH1070 Syllabus.pdf" })));
  assert.equal(view.requests[0].locale, "en", "the page's language was not sent");
  await view.unmount();
});
