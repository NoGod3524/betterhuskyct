import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";

import type { SummarizerApi, SummarizerOptions } from "../src/lib/announcement-summary.ts";
import { ANNOUNCEMENTS_STORAGE_KEY, serializeAnnouncements, type Announcement } from "../src/lib/announcements.ts";
import { t } from "../src/lib/i18n.ts";
import { installDom } from "./support/dom.ts";

/**
 * The summary panel and the announcements page, rendered.
 *
 * The Summarizer is Chrome's own on-device model, which no test can run, so a
 * stand-in takes its place on `globalThis` — the same place the component looks.
 */
const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AnnouncementSummary } = await import("../src/components/announcement-summary.tsx");
const { AnnouncementsSection } = await import("../src/components/announcements-section.tsx");
const { CalendarProvider } = await import("../src/components/calendar-provider.tsx");

const { window } = dom;
const host = globalThis as { Summarizer?: unknown };

after(() => dom.uninstall());
afterEach(() => {
  delete host.Summarizer;
  window.localStorage.clear();
});

function announcement(id: string, patch: Partial<Announcement> = {}): Announcement {
  return {
    id,
    courseId: "course-1",
    courseCode: "MATH 1070Q",
    title: `Title ${id}`,
    body: `Body ${id}`,
    posted: null,
    announced: "2026-09-20T12:00:00.000Z",
    ...patch,
  };
}

function stubSummarizer(options: { availability?: string; createFails?: boolean; output?: string } = {}) {
  const created: SummarizerOptions[] = [];
  const api: SummarizerApi = {
    async availability() {
      return (options.availability ?? "available") as Awaited<ReturnType<SummarizerApi["availability"]>>;
    },
    async create(requested) {
      if (options.createFails) throw new Error("NotAllowedError");
      created.push(requested!);
      return {
        inputQuota: 10_000,
        measureInputUsage: async (input: string) => input.length,
        summarize: async () => options.output ?? "* Quiz 3 moves to Friday.\n* Office hours cancelled.",
        destroy() {},
      };
    },
  };
  host.Summarizer = api;
  return { created };
}

async function render(element: ReturnType<typeof createElement>) {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(element));
  await settle();
  return {
    text: () => container.textContent ?? "",
    button: (label: string) =>
      [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(label)),
    unmount: () => act(async () => root.unmount()),
  };
}

async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function panel(course: { label: string; modelLabel: string } | null, announcements: Announcement[]) {
  return createElement(AnnouncementSummary, { locale: "en", course, announcements });
}

test("a browser without the on-device model gets a reason and no button", async () => {
  const view = await render(panel({ label: "MATH 1070Q", modelLabel: "MATH 1070Q" }, [announcement("a")]));

  assert.ok(view.text().includes(t("en", "summary.unsupported")));
  assert.equal(view.button("Summarize"), undefined, "a button that can only fail was offered");
  await view.unmount();
});

test("a device that has the API but cannot run the model says so", async () => {
  stubSummarizer({ availability: "unavailable" });
  const view = await render(panel({ label: "MATH 1070Q", modelLabel: "MATH 1070Q" }, [announcement("b")]));

  assert.ok(view.text().includes(t("en", "summary.unavailable")));
  assert.equal(view.button("Summarize"), undefined);
  await view.unmount();
});

test("with no course picked, it asks for one", async () => {
  stubSummarizer();
  const view = await render(panel(null, [announcement("c")]));

  assert.ok(view.text().includes(t("en", "summary.pickCourse")));
  assert.equal(view.button("Summarize"), undefined);
  await view.unmount();
});

test("pressing the button shows the summary, how it was made, and keeps it for the session", async () => {
  const { created } = stubSummarizer();
  const course = { label: "MATH 1070Q", modelLabel: "MATH 1070Q" };
  const entries = [announcement("d1"), announcement("d2")];
  const view = await render(panel(course, entries));

  const button = view.button("Summarize MATH 1070Q");
  assert.ok(button, "no summarize button");
  await act(async () => button.click());
  await settle();

  assert.ok(view.text().includes("Quiz 3 moves to Friday."), "the summary did not appear");
  assert.ok(view.text().includes(t("en", "summary.privacy")), "it did not say the summary was made on-device");
  assert.ok(view.text().includes(t("en", "summary.basis", { count: 2 })));
  assert.equal(created[0]?.outputLanguage, "en");
  await view.unmount();

  // Coming back to the same course shows it again without asking the model.
  const again = await render(panel(course, entries));
  assert.ok(again.text().includes("Quiz 3 moves to Friday."), "the summary was not kept");
  assert.equal(created.length, 1, "the model was asked twice for the same announcements");
  await again.unmount();
});

test("a model still to be downloaded says so before the first press", async () => {
  stubSummarizer({ availability: "downloadable" });
  const view = await render(panel({ label: "ENGL 1007", modelLabel: "ENGL 1007" }, [announcement("e")]));

  assert.ok(view.text().includes(t("en", "summary.downloadNote")));
  await act(async () => view.button("Summarize")!.click());
  await settle();
  assert.ok(view.text().includes("Quiz 3 moves to Friday."));
  assert.ok(!view.text().includes(t("en", "summary.downloadNote")), "the download note outlived the download");
  await view.unmount();
});

test("a model that will not start is reported, not left spinning", async () => {
  stubSummarizer({ createFails: true });
  const view = await render(panel({ label: "CSE 2050", modelLabel: "CSE 2050" }, [announcement("f")]));

  await act(async () => view.button("Summarize")!.click());
  await settle();
  assert.ok(view.text().includes(t("en", "summary.errorUnavailable")));
  assert.equal(view.button("Summarize")?.disabled, false, "the button stayed disabled after the failure");
  await view.unmount();
});

test("the 'No course' filter shows the announcements filed under no course", async () => {
  window.localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    serializeAnnouncements([
      announcement("filed", { title: "Filed under a course" }),
      announcement("loose", { courseId: null, courseCode: null, title: "Filed under nothing" }),
    ]),
  );
  const view = await render(
    createElement(CalendarProvider, {
      initialNow: new Date().toISOString(),
      children: createElement(AnnouncementsSection),
    }),
  );

  const chip = view.button(t("en", "announcements.uncoursed"));
  assert.ok(chip, "no 'No course' chip");
  await act(async () => chip.click());

  // The chip matched nothing before: its key was "__none" and the filter
  // compared it with a courseId of null.
  assert.ok(view.text().includes("Filed under nothing"), "the 'No course' filter showed nothing");
  assert.ok(!view.text().includes("Filed under a course"));
  await view.unmount();
});
