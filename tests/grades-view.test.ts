import assert from "node:assert/strict";
import { after, test } from "node:test";

import { GRADES_PROTOCOL, memoryGradesStore, type GradesStore } from "../src/lib/grades.ts";
import { openGradesStore } from "../src/lib/grades-store.ts";
import { t } from "../src/lib/i18n.ts";
import { installDom } from "./support/dom.ts";

/**
 * The Grades page, rendered with the real provider around it and a store in
 * memory in place of localStorage.
 */
const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { GradesSection } = await import("../src/components/grades-section.tsx");
const { CalendarProvider } = await import("../src/components/calendar-provider.tsx");

const { window } = dom;
after(() => dom.uninstall());

const READING = {
  version: 1 as const,
  term: "Fall 2026",
  takenAt: "2026-09-28T18:00:00.000Z",
  courses: [
    {
      id: "_203765_1",
      code: "MATH 1070Q",
      items: [
        { id: "_1_1", title: "Section 4.1 Homework", status: "1 attempt submitted (1 Late)", earned: 81.3, possible: 100, label: null },
        { id: "_2_1", title: "Section 4.2 Homework", status: null, earned: 105, possible: 100, label: null },
        { id: "_3_1", title: "Section 5.3 Homework", status: null, earned: null, possible: null, label: "Not graded" },
      ],
    },
    { id: "_198430_1", code: "ECON 1201", items: [] },
  ],
};

async function seeded(): Promise<GradesStore> {
  const store = memoryGradesStore();
  await store.put(READING);
  return store;
}

async function render(store: GradesStore | null) {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const openStore = async () => store ?? memoryGradesStore();
  await act(async () =>
    root.render(
      createElement(CalendarProvider, {
        initialNow: new Date().toISOString(),
        children: createElement(GradesSection, { openStore }),
      }),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label));
  return {
    text: () => container.textContent ?? "",
    click: async (label: string) => {
      const target = button(label);
      assert.ok(target, `no button "${label}"`);
      await act(async () => (target as unknown as HTMLButtonElement).click());
    },
    links: () => [...container.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    unmount: () => act(async () => root.unmount()),
  };
}

test("each course shows its points so far, and what they are not", async () => {
  const view = await render(await seeded());
  const text = view.text();

  assert.ok(text.includes("MATH 1070Q"));
  // 186.3 of 200.
  assert.ok(text.includes(t("en", "grades.percent", { percent: "93.2" })));
  assert.ok(text.includes(t("en", "grades.points", { earned: "186.3", possible: 200 })));
  assert.ok(text.includes(t("en", "grades.courseSummary", { graded: 2, total: 3 })));
  assert.ok(text.includes("Section 4.1 Homework"));
  assert.ok(text.includes("81.3 / 100"));
  assert.ok(text.includes("1 attempt submitted (1 Late)"));
  assert.ok(text.includes(t("en", "grades.caveat")), "the page does not say this is not the course grade");
  assert.ok(view.links().includes("https://lms.uconn.edu/ultra/courses/_203765_1/grades"));
  await view.unmount();
});

test("rows without a score stay folded until asked for", async () => {
  const view = await render(await seeded());

  assert.ok(view.text().includes(t("en", "grades.noScore", { count: 1 })));
  assert.ok(!view.text().includes("Section 5.3 Homework"), "an ungraded row showed before it was opened");

  await view.click(t("en", "grades.noScore", { count: 1 }));

  assert.ok(view.text().includes("Section 5.3 Homework"));
  assert.ok(view.text().includes("Not graded"));
  await view.unmount();
});

test("a course with no work says so instead of showing a total", async () => {
  const view = await render(await seeded());

  assert.ok(view.text().includes(t("en", "grades.noWork")));
  assert.equal(view.text().match(/%/g)?.length, 1, "a course with nothing graded showed a percent");
  await view.unmount();
});

test("while the saved grades are being read the page shows placeholders, not the empty state", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const base = await seeded();
  const slow: GradesStore = {
    ...base,
    get: async () => {
      await gate;
      return base.get();
    },
  };
  const view = await render(slow);

  assert.ok(view.text().includes(t("en", "common.loading")), "no placeholder while reading");
  assert.ok(!view.text().includes(t("en", "grades.emptyTitle")), "the empty state flashed before the grades arrived");

  await act(async () => {
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  assert.ok(!view.text().includes(t("en", "common.loading")));
  assert.ok(view.text().includes("MATH 1070Q"));
  await view.unmount();
});

test("with nothing stored, the page says how to get grades here", async () => {
  const view = await render(null);
  assert.ok(view.text().includes(t("en", "grades.emptyTitle")));
  await view.unmount();
});

test("a reading from HuskyCT arrives on the open page and is kept", async () => {
  const store = memoryGradesStore();
  const view = await render(store);
  const replies: unknown[] = [];

  await act(async () => {
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: { protocol: GRADES_PROTOCOL, kind: "grades", grades: READING },
        origin: "https://lms.uconn.edu",
        source: { postMessage: (reply: unknown) => replies.push(reply) } as never,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  assert.deepEqual(replies, [{ protocol: GRADES_PROTOCOL, kind: "stored", ok: true }]);
  assert.ok((await store.get())?.courses.length === 2);
  assert.ok(view.text().includes("Section 4.2 Homework"));
  assert.ok(view.text().includes(t("en", "grades.received", { courses: 2, items: 3 })));
  await view.unmount();
});

// --- what changed since you last looked -------------------------------------------------------

const CHANGED = { courseId: "_203765_1", itemId: "_2_1", kind: "changed" as const, from: { earned: 100, possible: 100 }, at: "2026-09-28T18:00:00.000Z" };
const GRADED = { courseId: "_203765_1", itemId: "_1_1", kind: "graded" as const, from: null, at: "2026-09-28T18:00:00.000Z" };

async function seededWithChanges(changes: Array<typeof CHANGED | typeof GRADED>): Promise<GradesStore> {
  const store = memoryGradesStore();
  await store.put({ ...READING, changes });
  return store;
}

test("a page with nothing new shows no banner and no badges", async () => {
  const view = await render(await seeded());
  assert.ok(!view.text().includes(t("en", "grades.markSeen")));
  assert.ok(!view.text().includes(t("en", "grades.badgeGraded")));
  await view.unmount();
});

test("new and changed scores are announced, badged with what they were, and listed first", async () => {
  const view = await render(await seededWithChanges([CHANGED, GRADED]));
  const text = view.text();

  assert.ok(text.includes(t("en", "grades.changesBanner", { count: 2 })));
  assert.ok(text.includes(t("en", "grades.badgeGraded")));
  assert.ok(text.includes(t("en", "grades.badgeChanged", { earned: 100, possible: 100 })));

  // Only the changed one: it moves ahead of the row that comes first in the course.
  await view.unmount();
  const one = await render(await seededWithChanges([CHANGED]));
  const shown = one.text();
  assert.ok(shown.indexOf("Section 4.2 Homework") < shown.indexOf("Section 4.1 Homework"), "the changed row did not come first");
  await one.unmount();
});

test("marking them seen removes the banner and badges, and keeps the grades", async () => {
  const store = await seededWithChanges([CHANGED, GRADED]);
  const view = await render(store);

  await view.click(t("en", "grades.markSeen"));

  assert.ok(!view.text().includes(t("en", "grades.markSeen")));
  assert.ok(!view.text().includes(t("en", "grades.badgeGraded")));
  assert.ok(view.text().includes("Section 4.2 Homework"), "the grades went with the banner");
  assert.equal((await store.get())?.changes, undefined, "the change was only hidden, not cleared");
  assert.equal((await store.get())?.courses.length, 2);
  await view.unmount();
});

test("two readings through the page: the second shows what moved", async () => {
  const store = memoryGradesStore();
  const view = await render(store);
  const send = (grades: unknown) =>
    act(async () => {
      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: { protocol: GRADES_PROTOCOL, kind: "grades", grades },
          origin: "https://lms.uconn.edu",
          source: { postMessage() {} } as never,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

  await send(READING);
  assert.ok(!view.text().includes(t("en", "grades.markSeen")), "the first reading was reported as changes");

  const later = {
    ...READING,
    takenAt: "2026-09-29T09:00:00.000Z",
    courses: [
      { ...READING.courses[0], items: READING.courses[0].items.map((item) => (item.id === "_3_1" ? { ...item, earned: 88, possible: 100, label: null } : item)) },
      READING.courses[1],
    ],
  };
  await send(later);

  assert.ok(view.text().includes(t("en", "grades.changesBanner", { count: 1 })));
  assert.ok(view.text().includes(t("en", "grades.badgeGraded")));
  assert.ok(view.text().includes("Section 5.3 Homework"), "the newly graded row is not in the graded list");
  await view.unmount();
});

test("the changes survive a reload, because the browser's store keeps them", async () => {
  window.localStorage.clear();
  const first = await openGradesStore();
  await first.put({ ...READING, changes: [CHANGED] });

  const again = await openGradesStore();

  assert.deepEqual((await again.get())?.changes, [CHANGED]);
  window.localStorage.clear();
});

test("clearing asks first, then empties the page", async () => {
  const store = await seeded();
  const view = await render(store);
  const browser = window as unknown as { confirm: () => boolean };
  const confirm = browser.confirm;

  browser.confirm = () => false;
  await view.click(t("en", "grades.clear"));
  assert.ok(await store.get(), "cleared without being confirmed");

  browser.confirm = () => true;
  await view.click(t("en", "grades.clear"));
  browser.confirm = confirm;

  assert.equal(await store.get(), null);
  assert.ok(view.text().includes(t("en", "grades.emptyTitle")));
  await view.unmount();
});
