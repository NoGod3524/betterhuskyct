import assert from "node:assert/strict";
import { after, test } from "node:test";

import { extractCandidates, isAddable } from "../src/lib/announcement-actions.ts";
import { createDemoTasks } from "../src/lib/calendar-view.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { createDemoAnnouncements, createDemoGrades, createDemoMaterials } from "../src/lib/demo-content.ts";
import { t } from "../src/lib/i18n.ts";
import { buildSyncPayload } from "../src/lib/sync.ts";
import { deliverSync } from "./support/deliver.ts";
import { installDom } from "./support/dom.ts";

/**
 * Before the first sync the Courses pages show examples, so a visitor sees what each is for. They
 * belong to the demo's own courses, show off what the pages do, and give way to the first real data.
 */
const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CalendarProvider } = await import("../src/components/calendar-provider.tsx");
const { AnnouncementsSection } = await import("../src/components/announcements-section.tsx");
const { window } = dom;
after(() => dom.uninstall());

const NOW = new Date("2026-11-15T15:00:00.000Z");

test("the examples belong to the demo's own courses", () => {
  const demoCourses = new Set(createDemoTasks(NOW).map((task) => task.course));
  const codes = [
    ...createDemoAnnouncements(NOW).map((entry) => entry.courseCode),
    ...createDemoMaterials(NOW).courses.map((course) => course.code),
    ...createDemoGrades(NOW).courses.map((course) => course.code),
  ];
  for (const code of codes) assert.ok(demoCourses.has(code), `${code} is not one of the demo's courses`);
});

test("each example announcement has a date the page can offer to add to the calendar", () => {
  for (const entry of createDemoAnnouncements(NOW)) {
    assert.ok(extractCandidates(entry).some(isAddable), `nothing to add in "${entry.title}"`);
  }
});

test("the announcements page shows examples until the first sync, then only what arrived", async () => {
  window.localStorage.clear();
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(createElement(CalendarProvider, { initialNow: NOW.toISOString(), children: createElement(AnnouncementsSection) })));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  const text = () => container.textContent ?? "";
  try {
    assert.ok(text().includes(t("en", "demo.sectionNote")));
    assert.ok(text().includes("Exam 2: time and room"));
    assert.ok(!text().includes(t("en", "announcements.clear")), "examples can be cleared");
    assert.ok(!text().includes(t("en", "ann.openOriginal")), "an example links to HuskyCT");

    const real = { courseCode: "MATH 1070Q", title: "Office hours moved", body: "Now on Fridays.", posted: NOW.toISOString(), announced: NOW.toISOString() };
    const payload = buildSyncPayload({
      feeds: [{ name: "HuskyCT to-do", courseId: null, importedAt: NOW.toISOString(), events: [{ id: "a:1", title: "Homework", course: "MATH 1070Q", start: "2026-11-20T23:59:00.000Z", dateKey: null, end: null, allDay: false, location: null, kind: "assignment" }] }],
      completedIds: [],
      courses: EMPTY_COURSE_BOOK,
      announcements: [{ ...real, id: "real-1", courseId: null }],
    });
    await act(async () => void (await deliverSync(window, payload)));

    assert.ok(text().includes("Office hours moved"));
    assert.ok(!text().includes("Exam 2: time and room"));
    assert.ok(!text().includes(t("en", "demo.sectionNote")));
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
