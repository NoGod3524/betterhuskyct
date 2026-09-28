import assert from "node:assert/strict";
import { after, test } from "node:test";

import { GRADES_PROTOCOL, memoryGradesStore, type GradesStore } from "../src/lib/grades.ts";
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

test("work not graded yet stays folded until asked for", async () => {
  const view = await render(await seeded());

  assert.ok(view.text().includes(t("en", "grades.notGraded", { count: 1 })));
  assert.ok(!view.text().includes("Section 5.3 Homework"), "an ungraded row showed before it was opened");

  await view.click(t("en", "grades.notGraded", { count: 1 }));

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
