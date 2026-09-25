import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";

import { SUMMARY_ENDPOINT } from "../src/lib/announcement-summary.ts";
import { ANNOUNCEMENTS_STORAGE_KEY, serializeAnnouncements, type Announcement } from "../src/lib/announcements.ts";
import { t } from "../src/lib/i18n.ts";
import { installDom } from "./support/dom.ts";

/**
 * The summary panel and the announcements page, rendered.
 *
 * The app's summarise endpoint is replaced by a stubbed `fetch`, so these
 * check what the page sends, shows and says — not the model.
 */
const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AnnouncementSummary } = await import("../src/components/announcement-summary.tsx");
const { AnnouncementsSection } = await import("../src/components/announcements-section.tsx");
const { CalendarProvider } = await import("../src/components/calendar-provider.tsx");

const { window } = dom;
const realFetch = globalThis.fetch;

after(() => dom.uninstall());
afterEach(() => {
  globalThis.fetch = realFetch;
  window.localStorage.clear();
});

let unique = 0;
function announcement(id: string, patch: Partial<Announcement> = {}): Announcement {
  return {
    id: `${id}-${unique}`,
    courseId: "course-1",
    courseCode: "MATH 1070Q",
    title: `Title ${id}`,
    body: `Body ${id}`,
    posted: null,
    announced: "2026-09-20T12:00:00.000Z",
    ...patch,
  };
}

/** Stands in for the app's endpoint; records every request the page makes. */
function stubEndpoint(
  answer: () => Response = () =>
    Response.json({ summary: "- Quiz 3 moves to Friday.\n- Office hours cancelled.", provider: "glm" }),
) {
  const sent: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return answer();
  }) as typeof fetch;
  return sent;
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
    rerender: (next: ReturnType<typeof createElement>) => act(async () => root.render(next)),
    unmount: () => act(async () => root.unmount()),
  };
}

async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

type Locale = "en" | "zh-CN";
function panel(locale: Locale, course: { label: string; modelLabel: string } | null, announcements: Announcement[]) {
  return createElement(AnnouncementSummary, { locale, course, announcements });
}
const MATH = { label: "MATH 1070Q", modelLabel: "MATH 1070Q" };

test("with no course picked, it asks for one and offers no button", async () => {
  unique += 1;
  const view = await render(panel("en", null, [announcement("a")]));

  assert.ok(view.text().includes(t("en", "summary.pickCourse")));
  assert.equal(view.button("Summarize"), undefined);
  await view.unmount();
});

test("where the announcements go is said before anything is sent", async () => {
  unique += 1;
  const sent = stubEndpoint();
  const view = await render(panel("en", MATH, [announcement("b")]));

  assert.ok(view.button("Summarize MATH 1070Q"));
  assert.ok(view.text().includes(t("en", "summary.disclosure")), "the page did not say the text leaves the device");
  // Both services, and the one that may train on it, are named before the press.
  assert.match(t("en", "summary.disclosure"), /Z\.ai.*Gemini.*improve its models/);
  assert.equal(sent.length, 0, "something was sent before the button was pressed");
  await view.unmount();
});

test("pressing the button sends the course, newest first, and shows the summary once", async () => {
  unique += 1;
  const sent = stubEndpoint();
  const entries = [
    announcement("old", { announced: "2026-09-01T12:00:00.000Z", title: "Older" }),
    announcement("new", { announced: "2026-09-20T12:00:00.000Z", title: "Newer" }),
  ];
  const view = await render(panel("en", MATH, entries));

  await act(async () => view.button("Summarize")!.click());
  await settle();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, SUMMARY_ENDPOINT);
  const body = sent[0].body as { courseLabel: string; locale: string; announcements: Array<{ title: string }> };
  assert.equal(body.courseLabel, "MATH 1070Q");
  assert.equal(body.locale, "en");
  assert.deepEqual(body.announcements.map((item) => item.title), ["Newer", "Older"]);

  assert.ok(view.text().includes("Quiz 3 moves to Friday."), "the summary did not appear");
  assert.ok(view.text().includes(t("en", "summary.basis", { count: 2 })));
  assert.ok(view.text().includes(t("en", "summary.creditGlm")), "the summary was not credited to GLM");
  assert.ok(view.button("Summarize again"));
  await view.unmount();

  // Back to the same course: shown again, with no second request.
  const again = await render(panel("en", MATH, entries));
  assert.ok(again.text().includes("Quiz 3 moves to Friday."), "the summary was not kept for the session");
  assert.equal(sent.length, 1, "the same announcements were summarised twice");
  await again.unmount();
});

test("switching language asks for a summary in that language rather than reusing the other", async () => {
  unique += 1;
  const sent = stubEndpoint(() => Response.json({ summary: "- 周五小测。", provider: "gemini" }));
  const entries = [announcement("c")];
  const view = await render(panel("en", MATH, entries));
  await act(async () => view.button("Summarize")!.click());
  await settle();

  await view.rerender(panel("zh-CN", MATH, entries));
  assert.ok(view.button("总结 MATH 1070Q 的公告"), "the English summary was shown as the Chinese one");

  await act(async () => view.button("总结")!.click());
  await settle();
  assert.equal((sent[1].body as { locale: string }).locale, "zh-CN");
  assert.ok(view.text().includes("周五小测。"));
  // Written by the fallback this time, and credited to it rather than to GLM.
  assert.ok(view.text().includes(t("zh-CN", "summary.creditGemini")), "a Gemini summary was not credited to Gemini");
  assert.ok(!view.text().includes(t("zh-CN", "summary.creditGlm")));
  await view.unmount();
});

test("a busy free model is explained, and the button can be pressed again", async () => {
  unique += 1;
  stubEndpoint(() => Response.json({ problem: "busy" }, { status: 503 }));
  const view = await render(panel("en", MATH, [announcement("d")]));

  await act(async () => view.button("Summarize")!.click());
  await settle();

  assert.ok(view.text().includes(t("en", "summary.errorBusy")));
  assert.equal(view.button("Summarize")?.disabled, false, "the button stayed disabled after the failure");
  await view.unmount();
});

function seedAnnouncements(entries: Announcement[]) {
  window.localStorage.setItem(ANNOUNCEMENTS_STORAGE_KEY, serializeAnnouncements(entries));
}

function page(summariesEnabled: boolean) {
  return createElement(CalendarProvider, {
    initialNow: new Date().toISOString(),
    children: createElement(AnnouncementsSection, { summariesEnabled }),
  });
}

test("a server without a model key shows no summary panel at all", async () => {
  unique += 1;
  seedAnnouncements([announcement("e")]);

  const off = await render(page(false));
  assert.ok(!off.text().includes(t("en", "summary.pickCourse")), "a panel appeared with summaries off");
  await off.unmount();

  const on = await render(page(true));
  assert.ok(on.text().includes(t("en", "summary.pickCourse")));
  await on.unmount();
});

test("the 'No course' filter shows the announcements filed under no course", async () => {
  unique += 1;
  seedAnnouncements([
    announcement("filed", { title: "Filed under a course" }),
    announcement("loose", { courseId: null, courseCode: null, title: "Filed under nothing" }),
  ]);
  const view = await render(page(false));

  const chip = view.button(t("en", "announcements.uncoursed"));
  assert.ok(chip, "no 'No course' chip");
  await act(async () => chip.click());

  // The chip matched nothing before: its key was "__none" and the filter
  // compared it with a courseId of null.
  assert.ok(view.text().includes("Filed under nothing"), "the 'No course' filter showed nothing");
  assert.ok(!view.text().includes("Filed under a course"));
  await view.unmount();
});
