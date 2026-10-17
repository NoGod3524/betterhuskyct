import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createDemoTasks, groupTasks } from "../src/lib/calendar-view.ts";
import { BACKGROUND_PROTOCOL } from "../src/lib/background-sync.ts";
import { formatDate } from "../src/lib/format-date.ts";
import { LOCALE_STORAGE_KEY, type Locale } from "../src/lib/i18n.ts";
import { installDom } from "./support/dom.ts";

const dom = installDom();
const { createElement, act } = await import("react");
const { hydrateRoot } = await import("react-dom/client");
const { renderToString } = await import("react-dom/server");
const { CalendarProvider, useCalendar } = await import("../src/components/calendar-provider.tsx");
const { CalendarMonthView } = await import("../src/components/calendar-month-view.tsx");
const { HeroSection } = await import("../src/components/hero-section.tsx");
const { TasksSection } = await import("../src/components/tasks-section.tsx");
const { window } = dom;
const RealDate = Date;
const refuseAcademic = async () => { throw new Error("offline"); };

// Answer extension discovery locally so no five-second request outlives the test DOM.
window.addEventListener("message", (event) => {
  const data = (event as unknown as MessageEvent).data;
  if (data?.protocol !== BACKGROUND_PROTOCOL || data.target !== "relay") return;
  window.dispatchEvent(new window.MessageEvent("message", {
    source: window as never, origin: window.location.origin,
    data: { protocol: BACKGROUND_PROTOCOL, target: "app", kind: "response", requestId: data.requestId, response: null },
  }));
});

after(() => dom.uninstall());

function Snapshot() {
  const { calendarReady, formattedToday, groups, tasks } = useCalendar();
  return createElement("output", { "data-calendar-snapshot": true }, JSON.stringify({
    calendarReady, formattedToday, groups, tasks,
  }));
}

function page(initialNow: string) {
  return createElement(CalendarProvider, { initialNow, children: [
    createElement(Snapshot, { key: "snapshot" }),
    createElement(HeroSection, { key: "hero" }),
    createElement(TasksSection, { key: "tasks" }),
    createElement(CalendarMonthView, { key: "calendar", fetchAcademic: refuseAcademic }),
  ] });
}

test("UTC server markup hydrates across zones and month boundaries before showing the browser's calendar", async () => {
  const originalZone = process.env.TZ;
  try {
    for (const instant of ["2026-10-16T23:47:49.293Z", "2026-10-01T00:30:00.000Z"]) {
      globalThis.Date = class extends RealDate {
        constructor(...args: ConstructorParameters<DateConstructor> | []) {
          if (args.length === 0) super(instant);
          else super(...(args as ConstructorParameters<DateConstructor>));
        }
        static now() { return new RealDate(instant).valueOf(); }
      } as DateConstructor;
      process.env.TZ = "UTC";
      window.localStorage.clear();
      const html = renderToString(page(instant));
      assert.ok(!html.includes("Data Structures — Problem Set 1"));
      assert.ok(html.includes('aria-busy="true"'));

      for (const zone of ["America/New_York", "Pacific/Auckland", "UTC"]) {
        for (const locale of ["en", "zh-CN"] as Locale[]) {
          process.env.TZ = zone;
          window.localStorage.clear();
          window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
          const container = window.document.createElement("div");
          container.innerHTML = html;
          window.document.body.appendChild(container);
          const errors: unknown[] = [];
          let root!: ReturnType<typeof hydrateRoot>;
          try {
            await act(async () => {
              root = hydrateRoot(container as unknown as Element, page(instant), {
                onRecoverableError: (error) => errors.push(error),
              });
            });
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
            assert.deepEqual(errors, [], `${instant} ${zone} ${locale}`);
            const state = JSON.parse(container.querySelector("[data-calendar-snapshot]")!.textContent!);
            const now = new Date(instant);
            assert.equal(state.calendarReady, true);
            assert.deepEqual(state.tasks, createDemoTasks(now));
            assert.deepEqual(state.groups, groupTasks(createDemoTasks(now), now, locale));
            assert.equal(state.formattedToday, formatDate(now, locale, { weekday: "long" }));
            const month = new Intl.DateTimeFormat(locale === "en" ? "en-US" : locale, { month: "long", year: "numeric" }).format(now);
            assert.ok([...container.querySelectorAll("h2")].some((node) => node.textContent === month), month);
          } finally {
            if (root) await act(async () => root.unmount());
            container.remove();
          }
        }
      }
    }
  } finally {
    globalThis.Date = RealDate;
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  }
});
