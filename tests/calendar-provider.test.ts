import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { t } from "../src/lib/i18n.ts";
import { buildSyncPayload, encodeSyncPayload } from "../src/lib/sync.ts";
import { installDom } from "./support/dom.ts";

/**
 * The real provider, rendered.
 *
 * Everything in `src/lib` is tested on its own; what those tests cannot see is
 * whether the provider wires it up. The clock froze because nothing subscribed
 * to it, and demo ticks leaked because of which set the provider handed to the
 * merge — both invisible to a unit test of the function involved.
 *
 * These drive the provider only through the context its consumers read, so
 * they hold across any reshuffle of its insides. React DOM must see a window
 * when it is first imported, so the imports below wait for the DOM.
 */
const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CalendarProvider, useCalendar } = await import("../src/components/calendar-provider.tsx");

type Calendar = ReturnType<typeof useCalendar>;
const { window } = dom;
const RealDate = Date;
const realFetch = globalThis.fetch;
const realSetInterval = window.setInterval.bind(window);
const realClearInterval = window.clearInterval.bind(window);

after(() => dom.uninstall());

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "";
  globalThis.Date = RealDate;
  globalThis.fetch = realFetch;
  window.setInterval = realSetInterval;
  window.clearInterval = realClearInterval;
});

/** Renders the provider and lets its restore-on-mount timeout run. */
async function mount() {
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
        initialNow: new RealDate().toISOString(),
        children: createElement(Probe),
      }),
    );
  });
  await settle();

  return {
    get calendar(): Calendar {
      assert.ok(latest, "the provider never rendered its consumer");
      return latest;
    },
    unmount: () => act(async () => root.unmount()),
  };
}

/** Lets timers, effects and promise chains the provider started finish. */
async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Moves `new Date()` and `Date.now()` forward, as a night away would. */
function shiftClock(ms: number) {
  globalThis.Date = class extends RealDate {
    constructor(...args: ConstructorParameters<DateConstructor> | []) {
      if (args.length === 0) super(RealDate.now() + ms);
      else super(...(args as ConstructorParameters<DateConstructor>));
    }
    static now() {
      return RealDate.now() + ms;
    }
  } as DateConstructor;
}

/**
 * Records the provider's intervals instead of scheduling them.
 *
 * happy-dom types its timers as Node's `Timeout`; the provider only ever hands
 * an id back to `clearInterval`, so any unique value serves.
 */
function recordIntervals() {
  const scheduled: Array<{ id: unknown; handler: () => void; timeout: number }> = [];
  const cleared: unknown[] = [];
  window.setInterval = ((handler: () => void, timeout: number) => {
    const id = { interval: scheduled.length };
    scheduled.push({ id, handler, timeout });
    return id;
  }) as unknown as typeof window.setInterval;
  window.clearInterval = ((id: unknown) => {
    cleared.push(id);
  }) as unknown as typeof window.clearInterval;
  return { scheduled, cleared };
}

const DAY_AND_A_HALF = 36 * 60 * 60 * 1000;

test("the provider's clock moves on its minute interval", async () => {
  const intervals = recordIntervals();
  const app = await mount();
  const before = app.calendar.now.valueOf();

  const minute = intervals.scheduled.find((entry) => entry.timeout === 60_000);
  assert.ok(minute, "the provider schedules nothing that keeps `now` moving");

  shiftClock(DAY_AND_A_HALF);
  await act(async () => minute.handler());

  assert.ok(app.calendar.now.valueOf() - before >= DAY_AND_A_HALF - 60_000, "`now` did not move");
  await app.unmount();
});

test("coming back to the tab refreshes the clock at once", async () => {
  const app = await mount();
  const before = app.calendar.now.valueOf();

  shiftClock(DAY_AND_A_HALF);
  await act(async () => {
    window.dispatchEvent(new window.Event("focus"));
  });

  assert.ok(app.calendar.now.valueOf() - before >= DAY_AND_A_HALF - 60_000, "focus did not refresh `now`");
  await app.unmount();
});

test("unmounting stops the clock", async () => {
  const intervals = recordIntervals();
  const app = await mount();
  const minute = intervals.scheduled.find((entry) => entry.timeout === 60_000);
  assert.ok(minute);

  await app.unmount();

  assert.ok(intervals.cleared.includes(minute.id), "the minute interval outlived the provider");
});

test("accepting a sync link while the demo is showing saves no demo tick", async () => {
  const start = new RealDate(RealDate.now() + 2 * 86_400_000).toISOString();
  const packed = await encodeSyncPayload(
    buildSyncPayload({
      feeds: [
        {
          name: "HuskyCT to-do",
          courseId: null,
          importedAt: start,
          events: [
            {
              id: `real-1:${start}`,
              title: "Real deadline",
              course: null,
              start,
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

  const app = await mount();
  assert.equal(app.calendar.isImported, false, "a fresh device should be showing the demo");
  await act(async () => app.calendar.toggleTaskCompletion("demo-cse-problem-set"));

  await act(async () => {
    window.location.hash = `#sync=${packed}`;
    window.dispatchEvent(new window.Event("hashchange"));
  });
  await settle(50);
  assert.ok(app.calendar.pendingSync, "the link was not offered");

  await act(async () => app.calendar.applyPendingSync());

  const saved = JSON.parse(window.localStorage.getItem("huskypilot.completedTasks.imported.v1") ?? "{}");
  assert.deepEqual(saved.completedIds, [], "a demo tick was saved as a real one");
  assert.equal(app.calendar.isImported, true);
  await app.unmount();
});

test("an import answered by a platform error page shows a sentence, not the parser", async () => {
  globalThis.fetch = async () =>
    new Response("<!doctype html><title>504</title>", { status: 504, headers: { "content-type": "text/html" } });

  const app = await mount();
  await act(async () => app.calendar.setCalendarUrl("https://example.edu/feed.ics"));
  await act(async () => {
    await app.calendar.handleImport({ preventDefault() {} } as Parameters<Calendar["handleImport"]>[0]);
  });

  assert.equal(app.calendar.error, t("en", "errors.importUnavailable"));
  await app.unmount();
});
