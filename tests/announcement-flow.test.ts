import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { computeAnnouncementId, type Announcement } from "../src/lib/announcements.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { t } from "../src/lib/i18n.ts";
import { buildSyncPayload, encodeSyncPayload } from "../src/lib/sync.ts";
import { installDom } from "./support/dom.ts";

/**
 * The announcements page used the way a student uses it: a sync brings announcements, the rules find
 * what may be a to-do, the student confirms one, the announcement is changed by the teacher and synced
 * again, and the page asks the student to look before anything is moved. Run on the real providers
 * with the helper's own sync link as the way in. All text here is made up for the test.
 */
const dom = installDom();
const { createElement, act, Fragment } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CalendarProvider, useCalendar } = await import("../src/components/calendar-provider.tsx");
const { AiPlanProvider, useAiPlan } = await import("../src/components/ai-plan-provider.tsx");
const { AnnouncementsSection } = await import("../src/components/announcements-section.tsx");
const { TodoSection } = await import("../src/components/todo-section.tsx");
const { recordAnnouncementVersions } = await import("../src/components/use-announcement-state.ts");

type Calendar = ReturnType<typeof useCalendar>;
const { window } = dom;
after(() => dom.uninstall());
beforeEach(() => window.localStorage.clear());

const settle = (ms = 30) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))));

const POSTED = "10/5/26, 4:00 PM";
const announcement = (body: string, title = "Quiz 3 and Homework 5 (made-up demo)"): Announcement => ({
  id: computeAnnouncementId({ courseCode: "STAT 1000Q", title, posted: POSTED }),
  courseId: null,
  courseCode: "STAT 1000Q",
  title,
  body,
  posted: POSTED,
  announced: "2026-10-05T21:00:00.000Z",
});

async function mount(page: "announcements" | "todo" = "announcements") {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  let latest: Calendar | null = null;
  let plan: ReturnType<typeof useAiPlan> = null;
  function Probe() {
    latest = useCalendar();
    plan = useAiPlan();
    // What the app's shell does for every page: save each announcement as it arrives.
    recordAnnouncementVersions(latest.announcements);
    return null;
  }
  const root = createRoot(container as unknown as Element);
  await act(async () =>
    root.render(
      createElement(CalendarProvider, {
        initialNow: new Date(2026, 9, 6, 12, 0).toISOString(),
        children: createElement(AiPlanProvider, {
          wait: async () => {},
          children: createElement(Fragment, null, createElement(Probe), page === "announcements" ? createElement(AnnouncementsSection) : createElement(TodoSection)),
        }),
      }),
    ),
  );
  await settle();
  const view = {
    get calendar(): Calendar {
      return latest!;
    },
    get plan() {
      return plan!;
    },
    text: () => container.textContent ?? "",
    button: (label: string) => [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label)) as unknown as HTMLElement | undefined,
    buttons: (label: string) => [...container.querySelectorAll("button")].filter((b) => (b.textContent ?? "").includes(label)) as unknown as HTMLElement[],
    click: async (element: unknown) => {
      assert.ok(element, "nothing to click");
      await act(async () => (element as HTMLElement).click());
      await settle();
    },
    /** A sync that brings these announcements, as the helper's link does. */
    sync: async (list: Announcement[]) => {
      const packed = await encodeSyncPayload(buildSyncPayload({ feeds: [], completedIds: [], courses: EMPTY_COURSE_BOOK, announcements: list }));
      await act(async () => {
        window.location.hash = `#sync=${packed}`;
        window.dispatchEvent(new window.Event("hashchange"));
      });
      await settle(50);
      await act(async () => latest!.applyPendingSync());
      await settle(50);
    },
    /** Opens every collapsed to-do panel, as the student does with the chevron. */
    expand: async () => {
      const heads = [...container.querySelectorAll("button[aria-expanded=false]")].filter((b) => (b.textContent ?? "").includes(t("en", "ann.panelTitle", { count: 0 }).split("(")[0]));
      for (const head of heads) await act(async () => (head as unknown as HTMLElement).click());
      await settle();
    },
    unmount: () => act(async () => root.unmount()),
  };
  return view;
}

const BODY = "Quiz 3 is due Friday, October 9 at 11:59 PM. Homework 5 is due next class. Welcome to the course.";
const customTitles = (view: Awaited<ReturnType<typeof mount>>) => view.calendar.tasks.filter((task) => task.id.startsWith("custom-")).map((task) => task.title);

test("what the rules find is shown with its sentence and why, and nothing is added until the student says so", async () => {
  const view = await mount();
  await view.sync([announcement(BODY)]);

  assert.ok(view.text().includes(t("en", "ann.panelTitle", { count: 2 })), view.text());
  assert.ok(!view.text().includes(t("en", "ann.panelNote")), "the panel starts open");
  await view.expand();
  assert.ok(view.text().includes("Quiz 3 is due Friday, October 9 at 11:59 PM."), "the sentence it came from is not shown");
  assert.ok(view.text().includes(t("en", "annBasis.year-from-posting")), "the reason for the year is not shown");
  assert.ok(view.text().includes(t("en", "annBasis.no-date")), "the reason there is no day is not shown");
  assert.ok(view.text().includes(t("en", "ann.check")), "the one with no day is not marked to check");
  assert.deepEqual(customTitles(view), [], "something was added before the student asked");
  await view.unmount();
});

test("adding one makes a to-do on that day, remembers it, and a second sync of the same text makes nothing twice", async () => {
  const view = await mount();
  await view.sync([announcement(BODY)]);
  await view.expand();

  await view.click(view.button(t("en", "ann.add")));
  assert.deepEqual(customTitles(view), ["Quiz 3"]);
  const quiz = view.calendar.tasks.find((task) => task.title === "Quiz 3")!;
  assert.equal(quiz.allDay, false);
  assert.equal(new Date(quiz.start).getDate(), 9);
  assert.ok(view.text().includes(t("en", "ann.added", { title: "Quiz 3" })));

  // The same announcement arrives again: no new candidate to add, no second task, no second version.
  await view.sync([announcement(BODY)]);
  await view.expand();
  assert.equal(view.buttons(t("en", "ann.add")).length, 0, "the added one is offered again");
  assert.deepEqual(customTitles(view), ["Quiz 3"]);
  const versions = JSON.parse(window.localStorage.getItem("huskypilot.announcementVersions.v1") ?? "{}");
  assert.equal(Object.values(versions as Record<string, unknown[]>)[0].length, 1);
  await view.unmount();
});

test("a sentence with no day can be added without one, and turned down, and brought back", async () => {
  const view = await mount();
  await view.sync([announcement(BODY)]);
  await view.expand();

  await view.click(view.button(t("en", "ann.addNoDay")));
  assert.deepEqual(view.plan.undated.map((todo) => todo.title), ["Homework 5"]);

  await view.click(view.button(t("en", "ann.dismiss")));
  assert.ok(view.text().includes(t("en", "ann.dismissedCount", { count: 1 })));
  await view.click(view.button(t("en", "ann.dismissedCount", { count: 1 })));
  await view.click(view.button(t("en", "ann.restore")));
  assert.ok(view.buttons(t("en", "ann.add")).length + view.buttons(t("en", "ann.addNoDay")).length > 0, "the turned down one did not come back");
  await view.unmount();
});

test("when the teacher moves the day, the page shows the change and asks about the to-do, and the student's own edits are kept", async () => {
  const view = await mount();
  await view.sync([announcement(BODY)]);
  await view.expand();
  await view.click(view.button(t("en", "ann.add")));
  const quiz = view.calendar.tasks.find((task) => task.title === "Quiz 3")!;
  // The student renames it.
  await act(async () => view.calendar.editEvent(quiz.id, { title: "Quiz 3 (bring calculator)" }));

  await view.sync([announcement(BODY.replace("Friday, October 9", "Monday, October 12"))]);
  await view.expand();

  assert.ok(view.text().includes(t("en", "ann.changedHeading")));
  assert.ok(view.text().includes(t("en", "ann.datesRemoved", { days: "2026/10/09 Fri" })), view.text());
  assert.ok(view.text().includes(t("en", "ann.datesAdded", { days: "2026/10/12 Mon" })));
  assert.ok(view.text().includes(t("en", "ann.noticeNothingChanged")));
  // Nothing was moved on its own.
  assert.equal(new Date(view.calendar.tasks.find((task) => task.id === quiz.id)!.start).getDate(), 9);

  await view.click(view.button(t("en", "ann.moveTo", { day: "2026/10/12 Mon" })));
  const moved = view.calendar.tasks.find((task) => task.id === quiz.id)!;
  assert.equal(new Date(moved.start).getDate(), 12);
  assert.equal(new Date(moved.start).getHours(), 23, "the time was lost");
  assert.equal(moved.title, "Quiz 3 (bring calculator)", "the student's rename was overwritten");
  assert.equal(view.buttons(t("en", "ann.moveTo", { day: "2026/10/12 Mon" })).length, 0, "it asked again after it was done");
  await view.unmount();
});

test("the to-do page says when to-dos made from announcements may be out of date, and the changed ones can be picked out", async () => {
  const view = await mount();
  await view.sync([announcement(BODY)]);
  await view.expand();
  await view.click(view.button(t("en", "ann.add")));
  await view.sync([announcement(BODY.replace("Friday, October 9", "Monday, October 12"))]);
  await view.expand();
  assert.ok(view.text().includes(t("en", "ann.filter.changed") + " (1)"));
  await view.unmount();

  const todo = await mount("todo");
  assert.ok(todo.text().includes(t("en", "ann.stale", { count: 1 })), todo.text());
  await todo.unmount();
});

test("the filters narrow the list and say when nothing is left", async () => {
  const view = await mount();
  await view.sync([announcement(BODY), announcement("Welcome to the course.", "Hello (made-up demo)")]);
  await view.expand();
  assert.ok(view.text().includes(t("en", "announcements.count", { count: 2 })));

  await view.click(view.button(t("en", "ann.filter.changed")));
  assert.ok(view.text().includes(t("en", "ann.filter.none")));
  await view.click(view.button(t("en", "ann.filter.clear")));
  await view.click(view.button(t("en", "ann.filter.actions")));
  assert.ok(view.text().includes(t("en", "announcements.count", { count: 1 })));
  await view.unmount();
});

test("an announcement the rules cannot make anything of is still read whole, and its link works", async () => {
  const view = await mount();
  const odd = "Das ist ein Test 🎓 ✨ " + "wörter ".repeat(40) + "Mehr: https://example.com/info.";
  await view.sync([announcement(odd, "Nur Text (made-up demo)")]);
  await view.expand();
  assert.ok(view.text().includes("🎓"));
  assert.ok(!view.text().includes(t("en", "ann.panelTitle", { count: 0 })));
  const link = [...window.document.querySelectorAll("a")].find((a) => (a.getAttribute("href") ?? "").startsWith("https://example.com/info"));
  assert.ok(link, "the address in the text is not a link");
  await view.unmount();
});
