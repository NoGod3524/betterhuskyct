import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { isCourseCatalogueLoaded } from "../src/lib/course-catalogue.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { SUBSCRIPTIONS_STORAGE_KEY, type Subscription } from "../src/lib/subscriptions.ts";
import { buildSyncPayload, encodeSyncPayload, serialiseSyncPayload } from "../src/lib/sync.ts";
import { TASKS_PROTOCOL } from "../src/lib/tasks-sync.ts";
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

// These two come first: the course catalogue loads once per process, so they are
// the only place its arrival can be seen.
test("the demo names its own courses, so the 62 KB course catalogue is never fetched for it", async () => {
  const app = await mount();
  await settle(50);

  assert.equal(app.calendar.isImported, false);
  assert.equal(isCourseCatalogueLoaded(), false, "the catalogue was fetched for a page that does not use it");
  await app.unmount();
});

test("an imported class meeting with no course gets its code once the catalogue arrives", async () => {
  const start = new RealDate(RealDate.now() + 2 * 86_400_000).toISOString();
  const packed = await encodeSyncPayload(
    buildSyncPayload({
      feeds: [
        {
          name: "Environmental Science",
          courseId: null,
          importedAt: start,
          events: [
            {
              id: `class-1:${start}`,
              title: "Environmental Science",
              course: null,
              start,
              dateKey: null,
              end: null,
              allDay: false,
              location: null,
              kind: "class",
            },
          ],
        },
      ],
      completedIds: [],
      courses: EMPTY_COURSE_BOOK,
    }),
  );
  const app = await mount();
  await act(async () => {
    window.location.hash = `#sync=${packed}`;
    window.dispatchEvent(new window.Event("hashchange"));
  });
  await settle(50);
  await act(async () => app.calendar.applyPendingSync());
  await settle(200);

  assert.equal(app.calendar.isImported, true);
  assert.equal(isCourseCatalogueLoaded(), true, "a task with no course did not ask for the catalogue");
  const [task] = app.calendar.tasks;
  assert.equal(app.calendar.courseLabelFor(task)?.code, "NRE 1000E");
  await app.unmount();
});

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

// --- the calendar page's own corrections and additions ----------------------------

async function importOneTask(app: Awaited<ReturnType<typeof mount>>) {
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
      courses: EMPTY_COURSE_BOOK,
    }),
  );
  await act(async () => {
    window.location.hash = `#sync=${packed}`;
    window.dispatchEvent(new window.Event("hashchange"));
  });
  await settle(50);
  await act(async () => app.calendar.applyPendingSync());
  return "a:2026-09-18T23:59:00.000Z";
}

test("a correction to an imported event shows up in tasks, and only there", async () => {
  const app = await mount();
  const id = await importOneTask(app);

  await act(async () => app.calendar.editEvent(id, { title: "Renamed by hand" }));

  const task = app.calendar.tasks.find((entry) => entry.id === id);
  assert.equal(task?.title, "Renamed by hand");
  assert.equal(app.calendar.isEventEdited(id), true);
  await app.unmount();
});

test("deleting an imported event hides it; restoring brings back the original, edit included", async () => {
  const app = await mount();
  const id = await importOneTask(app);
  await act(async () => app.calendar.editEvent(id, { title: "Renamed by hand" }));

  await act(async () => app.calendar.deleteEvent(id));
  assert.ok(!app.calendar.tasks.some((entry) => entry.id === id), "a deleted event was still shown");

  await act(async () => app.calendar.restoreEvent(id));
  const task = app.calendar.tasks.find((entry) => entry.id === id);
  assert.equal(task?.title, "Section 4.1 Homework", "restoring brought back the edit, not just the deletion");
  assert.equal(app.calendar.isEventEdited(id), false);
  await app.unmount();
});

test("restoring all events clears every correction and deletion at once", async () => {
  const app = await mount();
  const id = await importOneTask(app);
  await act(async () => {
    app.calendar.editEvent(id, { title: "Renamed by hand" });
  });

  await act(async () => app.calendar.restoreAllEvents());

  assert.equal(app.calendar.tasks.find((entry) => entry.id === id)?.title, "Section 4.1 Homework");
  assert.equal(app.calendar.isEventEdited(id), false);
  await app.unmount();
});

test("a note on an imported event survives a page reload, by itself", async () => {
  const app = await mount();
  const id = await importOneTask(app);
  await act(async () => app.calendar.editEvent(id, { note: "bring a calculator" }));

  assert.equal(app.calendar.eventNoteFor(id), "bring a calculator");
  // The title is unaffected by a note-only edit.
  assert.equal(app.calendar.tasks.find((entry) => entry.id === id)?.title, "Section 4.1 Homework");
  await app.unmount();
});

test("a custom event the student adds appears on the calendar even before any import", async () => {
  const app = await mount();
  assert.equal(app.calendar.isImported, false);

  await act(async () =>
    app.calendar.addCustomEvent({
      title: "Office hours",
      course: null,
      start: "2026-09-20T18:00:00.000Z",
      end: "2026-09-20T19:00:00.000Z",
      allDay: false,
      location: "WPO 203",
      note: null,
    }),
  );

  const added = app.calendar.tasks.find((entry) => entry.title === "Office hours");
  assert.ok(added, "the custom event was not in the task list");
  assert.ok(added!.id.startsWith("custom-"));

  await act(async () => app.calendar.deleteEvent(added!.id));
  assert.ok(!app.calendar.tasks.some((entry) => entry.title === "Office hours"));
  await app.unmount();
});

test("a sync payload the helper posts is applied straight away, with no banner to confirm", async () => {
  const payload = JSON.parse(
    serialiseSyncPayload(
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
        courses: EMPTY_COURSE_BOOK,
      }),
    ),
  );

  const app = await mount();
  assert.equal(app.calendar.isImported, false, "a fresh device should be showing the demo");

  const replies: unknown[] = [];
  await act(async () => {
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: { protocol: TASKS_PROTOCOL, kind: "sync", payload },
        origin: "https://lms.uconn.edu",
        source: { postMessage: (reply: unknown) => replies.push(reply) } as never,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  assert.deepEqual(replies, [{ protocol: TASKS_PROTOCOL, kind: "stored", ok: true }]);
  assert.equal(app.calendar.pendingSync, null, "a direct delivery should never wait on a banner");
  assert.equal(app.calendar.isImported, true);
  assert.equal(app.calendar.tasks[0]?.title, "Section 4.1 Homework");
  assert.ok(app.calendar.notice?.includes("Delivered from the helper"));
  await app.unmount();
});

test("a sync message from outside HuskyCT's own origins is ignored", async () => {
  const app = await mount();
  const payload = JSON.parse(
    serialiseSyncPayload(
      buildSyncPayload({
        feeds: [{ name: "HuskyCT to-do", courseId: null, importedAt: "2026-09-16T11:00:00.000Z", events: [] }],
        completedIds: [],
        courses: EMPTY_COURSE_BOOK,
      }),
    ),
  );

  await act(async () => {
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: { protocol: TASKS_PROTOCOL, kind: "sync", payload },
        origin: "https://evil.example",
        source: { postMessage() {} } as never,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  assert.equal(app.calendar.isImported, false);
  await app.unmount();
});

const PRIVATE_LINK = "https://lms.uconn.edu/webapps/calendar/calendarFeed/abc123secret/learn.ics";
const savedFeed = (): Subscription => ({
  id: "feed-1",
  name: "HuskyCT",
  courseId: null,
  importedAt: "2026-09-16T11:00:00.000Z",
  events: [{ id: "a:2026-09-18T23:59:00.000Z", title: "Section 4.1 Homework", course: "MATH 1070Q", start: "2026-09-18T23:59:00.000Z", dateKey: null, end: null, allDay: false, location: null, kind: "assignment" }],
});
const storedFeeds = () => (JSON.parse(window.localStorage.getItem(SUBSCRIPTIONS_STORAGE_KEY) ?? "{}").subscriptions ?? []) as Subscription[];

test("a calendar saved by a version that remembered links is opened without the link, which is removed and never fetched", async () => {
  window.localStorage.setItem(
    SUBSCRIPTIONS_STORAGE_KEY,
    JSON.stringify({ version: 1, subscriptions: [{ ...savedFeed(), url: PRIVATE_LINK, lastError: null }] }),
  );
  window.localStorage.setItem("huskypilot.rememberSource.v1", "true");
  const fetched: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetched.push(String(input));
    throw new Error("offline");
  }) as typeof fetch;

  const app = await mount();
  await settle(60);

  assert.deepEqual(fetched, [], "something was fetched on open");
  assert.equal(app.calendar.tasks.some((task) => task.title === "Section 4.1 Homework"), true, "the imported event was lost");
  assert.ok(!(window.localStorage.getItem(SUBSCRIPTIONS_STORAGE_KEY) ?? "").includes("abc123secret"), "the private link is still stored");
  assert.equal(window.localStorage.getItem("huskypilot.rememberSource.v1"), null);
  assert.equal(storedFeeds()[0].events.length, 1);
  await app.unmount();
});

const OWN_EVENT = {
  title: "Read chapter 5",
  course: null,
  start: "2026-09-20T18:00:00.000Z",
  end: null,
  allDay: false,
  location: null,
  note: null,
};
const addOwn = async (app: Awaited<ReturnType<typeof mount>>) => {
  let id = "";
  await act(async () => {
    id = app.calendar.addCustomEvent(OWN_EVENT);
  });
  return id;
};

test("a task the student added and ticked is still ticked after a reload, with a calendar imported", async () => {
  const app = await mount();
  await importOneTask(app);
  const own = await addOwn(app);
  await act(async () => app.calendar.toggleTaskCompletion(own));
  assert.equal(app.calendar.doneIds.has(own), true);
  await app.unmount();

  const again = await mount();
  assert.equal(again.calendar.isImported, true);
  assert.equal(again.calendar.doneIds.has(own), true, "the tick on the student's own task was lost on reload");
  await again.unmount();
});

test("a tick on the student's own task survives the first import, and unticking it is remembered too", async () => {
  const app = await mount();
  assert.equal(app.calendar.isImported, false);
  const own = await addOwn(app);
  await act(async () => app.calendar.toggleTaskCompletion(own));
  assert.equal(app.calendar.doneIds.has(own), true);

  await importOneTask(app);
  assert.equal(app.calendar.doneIds.has(own), true, "the import took the tick away");
  await app.unmount();

  const again = await mount();
  assert.equal(again.calendar.doneIds.has(own), true);
  await act(async () => again.calendar.toggleTaskCompletion(own));
  assert.equal(again.calendar.doneIds.has(own), false);
  await again.unmount();

  const last = await mount();
  assert.equal(last.calendar.doneIds.has(own), false, "an unticked task came back ticked");
  await last.unmount();
});

test("a tick on an imported task and one on the student's own task are kept apart, and each stays", async () => {
  const app = await mount();
  const imported = await importOneTask(app);
  const own = await addOwn(app);
  await act(async () => app.calendar.toggleTaskCompletion(imported));
  await act(async () => app.calendar.toggleTaskCompletion(own));
  await app.unmount();

  const again = await mount();
  assert.equal(again.calendar.doneIds.has(imported), true);
  assert.equal(again.calendar.doneIds.has(own), true);
  await again.unmount();
});
