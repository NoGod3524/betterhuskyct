import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";

import { t } from "../src/lib/i18n.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { buildSyncPayload, encodeSyncPayload } from "../src/lib/sync.ts";
import { installDom } from "./support/dom.ts";

/**
 * The calendar page's month view, rendered with the real provider — so an
 * add, an edit, a delete and a restore all go through the exact code the
 * provider exposes, not a stand-in of it.
 */
const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CalendarMonthView } = await import("../src/components/calendar-month-view.tsx");
const { CalendarProvider, useCalendar } = await import("../src/components/calendar-provider.tsx");

type Calendar = ReturnType<typeof useCalendar>;
const { window } = dom;
after(() => dom.uninstall());

// Built from local components, not a UTC instant: CI runs this suite under
// TZ=Pacific/Auckland specifically to catch a fixed "now" that only lands on
// the right calendar day in UTC. Noon was exactly such a case — 12 hours
// ahead of UTC rolls it to the next day there.
const NOW = new Date(2026, 8, 16, 12, 0, 0);
const RealDate = Date;

// `initialNow` only reaches the very first render — the provider's own
// restore-on-mount effect calls `new Date()` a moment later and that wins
// from then on, so a fixed `now` for these tests means mocking `Date` itself.
beforeEach(() => {
  globalThis.Date = class extends RealDate {
    constructor(...args: ConstructorParameters<DateConstructor> | []) {
      if (args.length === 0) super(NOW.valueOf());
      else super(...(args as ConstructorParameters<DateConstructor>));
    }
    static now() {
      return NOW.valueOf();
    }
  } as DateConstructor;
});
afterEach(() => {
  globalThis.Date = RealDate;
});

/** No network in tests: the academic calendar is refused unless a test hands one over. */
const refuse = async (): Promise<Response> => {
  throw new Error("offline");
};

async function render(fetchAcademic: (input: string) => Promise<Response> = refuse) {
  window.localStorage.clear();
  window.location.hash = "";
  // happy-dom has no native dialog; "Undo every change" asks before it acts,
  // and a test confirming it is a test that means yes.
  (window as unknown as { confirm: () => boolean }).confirm = () => true;
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  let latest: Calendar | null = null;
  function Probe() {
    latest = useCalendar();
    return null;
  }

  const root = createRoot(container as unknown as Element);
  await act(async () =>
    root.render(
      createElement(CalendarProvider, {
        initialNow: NOW.toISOString(),
        children: [createElement(Probe, { key: "probe" }), createElement(CalendarMonthView, { key: "view", fetchAcademic })],
      }),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  const byLabel = (label: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim().includes(label) || b.getAttribute("aria-label") === label,
    );
  const field = (label: string) => {
    const wrap = [...container.querySelectorAll("label")].find((node) => (node.textContent ?? "").includes(label));
    return wrap?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | undefined;
  };
  const setValue = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    // A plain `el.value = x` leaves React's own value tracker unaware anything
    // changed, so its synthetic `onChange` never fires under happy-dom. Going
    // through the prototype's native setter is the standard workaround.
    const prototype = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(el, value);
    await act(async () => el.dispatchEvent(new window.Event("input", { bubbles: true }) as never));
  };

  return {
    container,
    text: () => container.textContent ?? "",
    clickButton: async (label: string) => {
      const target = byLabel(label);
      assert.ok(target, `no button "${label}"`);
      await act(async () => (target as unknown as HTMLButtonElement).click());
    },
    clickPill: async (title: string) => {
      const pill = [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(title));
      assert.ok(pill, `no event pill "${title}"`);
      await act(async () => (pill as unknown as HTMLButtonElement).click());
    },
    openTodayDetail: async () => {
      // Today's day-number button is the one circle styled as the highlight,
      // found by that marker rather than by its date label — which is
      // exactly the thing a grid-alignment bug would get wrong.
      const todayButton = [...container.querySelectorAll("button")].find((b) => b.className.includes("bg-[var(--blue)]"));
      assert.ok(todayButton, "no highlighted cell for today");
      await act(async () => (todayButton as unknown as HTMLButtonElement).click());
    },
    field,
    setValue,
    get calendar(): Calendar {
      assert.ok(latest, "the provider never rendered its consumer");
      return latest;
    },
    unmount: () => act(async () => root.unmount()),
  };
}

async function importOneTask(view: Awaited<ReturnType<typeof render>>) {
  const packed = await encodeSyncPayload(
    buildSyncPayload({
      feeds: [
        {
          name: "HuskyCT to-do",
          courseId: null,
          importedAt: "2026-09-16T11:00:00.000Z",
          events: [
            {
              id: "a:2026-09-18T23:59:00.000Z",
              title: "Section 4.1 Homework",
              course: "MATH 1070Q",
              start: "2026-09-18T23:59:00.000Z",
              dateKey: null,
              end: null,
              allDay: false,
              location: null,
              kind: "assignment",
            },
          ],
        },
      ],
      completedIds: [],
      efforts: {},
      courses: EMPTY_COURSE_BOOK,
    }),
  );
  await act(async () => {
    window.location.hash = `#sync=${packed}`;
    window.dispatchEvent(new window.Event("hashchange"));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  await act(async () => view.calendar.applyPendingSync());
}

test("the grid shows the month the provider opened on, with a cell per weekday", async () => {
  const view = await render();
  assert.ok(view.text().includes("September 2026"));
  await view.unmount();
});

test("today's cell carries its own real date, not shifted by where in the month today falls", async () => {
  // `now` (2026-09-16, a Wednesday) is not the 1st of its month — exactly the
  // case that broke when the grid's starting offset was measured from
  // today's own date instead of from the month's 1st, shifting every cell by
  // however many days into the month today happens to be.
  const view = await render();
  await view.openTodayDetail();
  assert.ok(view.text().includes("Wednesday"), `expected today's day-detail to say Wednesday, got: ${view.text()}`);
  await view.unmount();
});

test("adding an event from a day cell puts it on the grid", async () => {
  const view = await render();

  await view.clickButton(t("en", "calendar.addEvent"));
  const title = view.field(t("en", "calendar.fieldTitle"));
  assert.ok(title, "no title field in the add form");
  await view.setValue(title!, "Office hours");
  await view.clickButton(t("en", "calendar.save"));

  assert.ok(view.text().includes("Office hours"));
  await view.unmount();
});

test("saving with no title refuses, rather than adding a blank event", async () => {
  const view = await render();

  await view.clickButton(t("en", "calendar.addEvent"));
  await view.clickButton(t("en", "calendar.save"));

  assert.ok(view.text().includes(t("en", "calendar.emptyTitleError")));
  await view.unmount();
});

test("editing a custom event's title changes the pill, and deleting removes it", async () => {
  const view = await render();
  await view.clickButton(t("en", "calendar.addEvent"));
  await view.setValue(view.field(t("en", "calendar.fieldTitle"))!, "Office hours");
  await view.clickButton(t("en", "calendar.save"));

  await view.clickPill("Office hours");
  await view.setValue(view.field(t("en", "calendar.fieldTitle"))!, "Renamed hours");
  await view.clickButton(t("en", "calendar.save"));
  assert.ok(view.text().includes("Renamed hours"));
  assert.ok(!view.text().includes("Office hours"));

  await view.clickPill("Renamed hours");
  await view.clickButton(t("en", "calendar.delete"));
  assert.ok(!view.text().includes("Renamed hours"));
  await view.unmount();
});

test("editing an imported event corrects it, and restoring brings back HuskyCT's own wording", async () => {
  const view = await render();
  await importOneTask(view);
  assert.ok(view.text().includes("Section 4.1 Homework"));

  await view.clickPill("Section 4.1 Homework");
  await view.setValue(view.field(t("en", "calendar.fieldTitle"))!, "Renamed by hand");
  await view.clickButton(t("en", "calendar.save"));
  assert.ok(view.text().includes("Renamed by hand"));

  await view.clickPill("Renamed by hand");
  assert.ok(view.text().includes(t("en", "calendar.editedBadge")));
  await view.clickButton(t("en", "calendar.restoreOriginal"));
  assert.ok(view.text().includes("Section 4.1 Homework"));
  assert.ok(!view.text().includes("Renamed by hand"));
  await view.unmount();
});

test("deleting an imported event hides it without touching HuskyCT's copy, and Undo brings it back", async () => {
  const view = await render();
  await importOneTask(view);

  await view.clickPill("Section 4.1 Homework");
  await view.clickButton(t("en", "calendar.delete"));
  assert.ok(!view.text().includes("Section 4.1 Homework"));

  await view.clickButton(t("en", "calendar.restoreAll"));
  assert.ok(view.text().includes("Section 4.1 Homework"));
  await view.unmount();
});

test("UConn's academic calendar colours the day of a break or a deadline, and is kept for offline", async () => {
  const events = [
    { id: "a1", title: "Labor Day – No classes", detail: "Labor Day – No classes", start: "2026-09-07", end: "2026-09-07", term: "Fall 2026", importance: "major" },
    { id: "a2", title: "Registration begins", detail: "Registration for Spring begins", start: "2026-09-21", end: "2026-09-21", term: "Fall 2026", importance: "minor" },
    { id: "a3", title: "Thanksgiving Recess", detail: "Thanksgiving Recess", start: "2026-09-28", end: "2026-09-30", term: "Fall 2026", importance: "major" },
  ];
  const view = await render(async () => Response.json({ source: "registrar", events }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  const day = (key: string) => view.container.querySelector(`[data-day="${key}"]`) as unknown as HTMLElement;
  assert.match(day("2026-09-07").className, /c-fff0d9/, "the holiday was not coloured");
  assert.ok((day("2026-09-07").textContent ?? "").includes("Labor Day – No classes"));
  assert.doesNotMatch(day("2026-09-21").className, /c-fff0d9/, "a minor date was coloured like a break");
  assert.ok((day("2026-09-21").textContent ?? "").includes("Registration begins"));
  for (const key of ["2026-09-28", "2026-09-29", "2026-09-30"]) assert.match(day(key).className, /c-fff0d9/, key);
  assert.doesNotMatch(day("2026-10-01").className, /c-fff0d9/, "the break ran past its last day");

  const stored = JSON.parse(window.localStorage.getItem("huskypilot.academicCalendar.v1") ?? "[]");
  assert.equal(stored.length, 3, "the calendar was not kept for offline");
});
