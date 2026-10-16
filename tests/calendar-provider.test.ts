import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { isCourseCatalogueLoaded } from "../src/lib/course-catalogue.ts";
import { COURSES_STORAGE_KEY, EMPTY_COURSE_BOOK, addCourse } from "../src/lib/courses.ts";
import { ANNOUNCEMENTS_STORAGE_KEY, parseAnnouncementCandidates } from "../src/lib/announcements.ts";
import { COURSE_COLORS_KEY } from "../src/lib/course-colors.ts";
import { MAX_CUSTOM_EVENTS, buildCustomEvent, saveCustomEvents } from "../src/lib/custom-events.ts";
import { SUBSCRIPTIONS_STORAGE_KEY, type Subscription } from "../src/lib/subscriptions.ts";
import { buildSyncPayload, encodeSyncPayload, serialiseSyncPayload } from "../src/lib/sync.ts";
import { TASKS_PROTOCOL } from "../src/lib/tasks-sync.ts";
import {
  COMPLETION_STORAGE_KEY_CUSTOM,
  COMPLETION_STORAGE_KEY_DEMO,
  COMPLETION_STORAGE_KEY_IMPORTED,
} from "../src/lib/completion-storage.ts";
import { REOPENED_STORAGE_KEY, SYNCED_DONE_STORAGE_KEY } from "../src/lib/task-status.ts";
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

async function storageChanged(key: string | null) {
  await act(async () => window.dispatchEvent(new window.StorageEvent("storage", {
    key: key ?? undefined,
    storageArea: window.localStorage,
  })));
}

function storeTicks(key: string, ids: string[]) {
  window.localStorage.setItem(key, JSON.stringify({ version: 1, completedIds: ids }));
}

test("ticks changed in another tab appear here, including unticks and custom events", async () => {
  const app = await mount();
  const imported = await importOneTask(app);
  const own = await addOwn(app);

  storeTicks(COMPLETION_STORAGE_KEY_IMPORTED, [imported]);
  await storageChanged(COMPLETION_STORAGE_KEY_IMPORTED);
  assert.equal(app.calendar.doneIds.has(imported), true);

  storeTicks(COMPLETION_STORAGE_KEY_CUSTOM, [own]);
  await storageChanged(COMPLETION_STORAGE_KEY_CUSTOM);
  assert.equal(app.calendar.doneIds.has(own), true);
  assert.equal(app.calendar.doneIds.has(imported), true);

  storeTicks(COMPLETION_STORAGE_KEY_IMPORTED, []);
  await storageChanged(COMPLETION_STORAGE_KEY_IMPORTED);
  assert.equal(app.calendar.doneIds.has(imported), false);
  assert.equal(app.calendar.doneIds.has(own), true);

  window.localStorage.removeItem(COMPLETION_STORAGE_KEY_CUSTOM);
  await storageChanged(null);
  assert.equal(app.calendar.doneIds.has(own), false);
  await app.unmount();
});

test("ticking before another tab's storage event arrives preserves its ticks and source separation", async () => {
  const app = await mount();
  const imported = await importOneTask(app);
  const own = await addOwn(app);
  const demo = "demo-cse-problem-set";
  storeTicks(COMPLETION_STORAGE_KEY_DEMO, [demo]);
  storeTicks(COMPLETION_STORAGE_KEY_IMPORTED, [imported]);

  await act(async () => app.calendar.toggleTaskCompletion(own));
  assert.equal(app.calendar.doneIds.has(imported), true);
  assert.equal(app.calendar.doneIds.has(own), true);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(COMPLETION_STORAGE_KEY_IMPORTED)!).completedIds, [imported]);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(COMPLETION_STORAGE_KEY_CUSTOM)!).completedIds, [own]);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(COMPLETION_STORAGE_KEY_DEMO)!).completedIds, [demo]);

  await act(async () => app.calendar.restoreDemo());
  storeTicks(COMPLETION_STORAGE_KEY_DEMO, []);
  await storageChanged(COMPLETION_STORAGE_KEY_DEMO);
  assert.equal(app.calendar.doneIds.has(demo), false);
  assert.equal(app.calendar.doneIds.has(own), true);
  assert.equal(app.calendar.doneIds.has(imported), false);
  await app.unmount();
});

test("another tab's HuskyCT status and reopenings are reflected and toggled from the latest saved choice", async () => {
  const app = await mount();
  const imported = await importOneTask(app);

  window.localStorage.setItem(SYNCED_DONE_STORAGE_KEY, JSON.stringify({ [imported]: "graded" }));
  await storageChanged(SYNCED_DONE_STORAGE_KEY);
  assert.equal(app.calendar.doneLabelFor(imported), "graded");

  window.localStorage.setItem(REOPENED_STORAGE_KEY, JSON.stringify([imported]));
  await storageChanged(REOPENED_STORAGE_KEY);
  assert.equal(app.calendar.doneIds.has(imported), false);

  // A second tab closed it again, but its event has not reached this tab yet.
  window.localStorage.removeItem(REOPENED_STORAGE_KEY);
  await act(async () => app.calendar.toggleTaskCompletion(imported));
  assert.equal(app.calendar.doneIds.has(imported), false, "the latest saved choice was not reopened");
  assert.deepEqual(JSON.parse(window.localStorage.getItem(REOPENED_STORAGE_KEY)!), [imported]);

  window.localStorage.removeItem(SYNCED_DONE_STORAGE_KEY);
  await storageChanged(SYNCED_DONE_STORAGE_KEY);
  assert.equal(app.calendar.doneLabelFor(imported), null);
  await app.unmount();
});

test("a helper sync preserves another tab's latest completion choices and keeps custom ticks separate", async () => {
  const app = await mount();
  const imported = await importOneTask(app);
  const own = await addOwn(app);
  await act(async () => app.calendar.toggleTaskCompletion(own));

  storeTicks(COMPLETION_STORAGE_KEY_IMPORTED, [imported]);
  window.localStorage.setItem(SYNCED_DONE_STORAGE_KEY, JSON.stringify({ [imported]: "graded" }));
  window.localStorage.setItem(REOPENED_STORAGE_KEY, JSON.stringify([imported]));
  const payload = JSON.parse(serialiseSyncPayload(buildSyncPayload({
    feeds: [savedFeed()],
    completedIds: [],
    courses: EMPTY_COURSE_BOOK,
  })));
  const replies: unknown[] = [];

  await act(async () => window.dispatchEvent(new window.MessageEvent("message", {
    data: { protocol: TASKS_PROTOCOL, kind: "sync", payload },
    origin: "https://lms.uconn.edu",
    source: { postMessage: (reply: unknown) => replies.push(reply) } as never,
  })));

  assert.deepEqual(replies, [{ protocol: TASKS_PROTOCOL, kind: "stored", ok: true }]);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(COMPLETION_STORAGE_KEY_IMPORTED)!).completedIds, [imported]);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(COMPLETION_STORAGE_KEY_CUSTOM)!).completedIds, [own]);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(SYNCED_DONE_STORAGE_KEY)!), { [imported]: "graded" });
  assert.deepEqual(JSON.parse(window.localStorage.getItem(REOPENED_STORAGE_KEY)!), [imported]);
  assert.equal(app.calendar.doneIds.has(imported), true);
  assert.equal(app.calendar.doneIds.has(own), true);
  await app.unmount();
});

function refuseStorageWrite(key: string) {
  const storage = window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: storage.getItem.bind(storage),
    removeItem: storage.removeItem.bind(storage),
    setItem: (name: string, value: string) => {
      if (name === key) throw new DOMException("Full", "QuotaExceededError");
      storage.setItem(name, value);
    },
  } });
  return () => {
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    else Reflect.deleteProperty(window, "localStorage");
  };
}

test("failed event saves leave the visible calendar unchanged and report the failure", async () => {
  const app = await mount();
  const imported = await importOneTask(app);
  for (const key of ["huskypilot.customEvents.v1", "huskypilot.eventOverlay.v1"]) {
    const restore = refuseStorageWrite(key);
    try {
      await act(async () => {
        assert.throws(() => key.includes("customEvents")
          ? app.calendar.addCustomEvent(OWN_EVENT)
          : app.calendar.editEvent(imported, { title: "Unsaved edit" }));
      });
      assert.ok(app.calendar.error?.includes("could not be saved"));
      assert.equal(app.calendar.tasks.some((task) => task.title === OWN_EVENT.title || task.title === "Unsaved edit"), false);
      assert.equal(app.calendar.isEventEdited(imported), false);
    } finally { restore(); }
  }
  await app.unmount();
});

test("custom event batches are all or nothing at capacity, and stable IDs preserve an earlier edit", async () => {
  const initial = Array.from({ length: MAX_CUSTOM_EVENTS - 1 }, (_, index) => buildCustomEvent({ ...OWN_EVENT, id: `custom-existing-${index}` }));
  saveCustomEvents(window.localStorage as unknown as Storage, initial);
  const app = await mount();
  await act(async () => {
    assert.throws(() => app.calendar.addCustomEvents([{ ...OWN_EVENT, id: "custom-new-1" }, { ...OWN_EVENT, id: "custom-new-2" }]));
  });
  assert.equal(app.calendar.tasks.filter((task) => task.id.startsWith("custom-")).length, MAX_CUSTOM_EVENTS - 1);
  assert.equal(app.calendar.tasks.some((task) => task.id === "custom-new-1"), false);

  await act(async () => app.calendar.addCustomEvents([{ ...OWN_EVENT, id: "custom-new-1" }]));
  await act(async () => app.calendar.editEvent("custom-new-1", { title: "Edited here" }));
  await act(async () => app.calendar.addCustomEvents([{ ...OWN_EVENT, id: "custom-new-1" }, { ...OWN_EVENT, id: "custom-new-1" }]));
  assert.equal(app.calendar.tasks.filter((task) => task.id === "custom-new-1").length, 1);
  assert.equal(app.calendar.tasks.find((task) => task.id === "custom-new-1")?.title, "Edited here");
  await act(async () => { assert.throws(() => app.calendar.addCustomEvent(OWN_EVENT)); });
  assert.equal(app.calendar.tasks.filter((task) => task.id.startsWith("custom-")).length, MAX_CUSTOM_EVENTS);
  await app.unmount();
});

test("custom events and their related records commit together, including retries with no new IDs", async () => {
  const app = await mount();
  const storage = window.localStorage;
  const before = storage.getItem("huskypilot.customEvents.v1");
  const restore = refuseStorageWrite("related-decision");
  try {
    await act(async () => {
      assert.throws(() => app.calendar.addCustomEvents([{ ...OWN_EVENT, id: "custom-related" }], (staged) => {
        staged.setItem("related-decision", "accepted");
      }));
    });
    assert.equal(storage.getItem("huskypilot.customEvents.v1"), before);
    assert.equal(app.calendar.tasks.some((task) => task.id === "custom-related"), false);
  } finally { restore(); }
  await act(async () => app.calendar.addCustomEvents([{ ...OWN_EVENT, id: "custom-related" }], (staged) => staged.setItem("related-decision", "accepted")));
  assert.equal(storage.getItem("related-decision"), "accepted");
  assert.equal(app.calendar.tasks.filter((task) => task.id === "custom-related").length, 1);
  await act(async () => app.calendar.addCustomEvents([{ ...OWN_EVENT, id: "custom-related" }], (staged) => staged.setItem("related-decision", "retried")));
  assert.equal(storage.getItem("related-decision"), "retried");
  await act(async () => app.calendar.addCustomEvents([], (staged) => staged.removeItem("related-decision")));
  assert.equal(storage.getItem("related-decision"), null);
  await app.unmount();
});

test("a failed helper sync rolls every changed key back and never publishes a partial calendar", async () => {
  const keys = [SUBSCRIPTIONS_STORAGE_KEY, COURSES_STORAGE_KEY, ANNOUNCEMENTS_STORAGE_KEY, COMPLETION_STORAGE_KEY_IMPORTED, SYNCED_DONE_STORAGE_KEY, COURSE_COLORS_KEY, REOPENED_STORAGE_KEY];
  for (const key of keys) {
    window.localStorage.clear();
    const existing = savedFeed();
    window.localStorage.setItem(SUBSCRIPTIONS_STORAGE_KEY, JSON.stringify({ version: 1, subscriptions: [existing] }));
    const app = await mount();
    const storage = window.localStorage;
    const before = keys.map((name) => storage.getItem(name));
    const payload = JSON.parse(serialiseSyncPayload(buildSyncPayload({
      feeds: [{ ...existing, events: [...existing.events, { ...existing.events[0], id: "new-task", title: "New task" }] }],
      completedIds: [existing.events[0].id],
      courses: addCourse(EMPTY_COURSE_BOOK, "MATH 1070Q", "LEC"),
      announcements: parseAnnouncementCandidates([{ title: "New announcement" }]),
      doneByHuskyct: [["new-task", "graded"]],
      reopened: ["new-task"],
      courseColors: { MATH1070Q: "#123456" },
    })));
    const replies: unknown[] = [];
    const restore = refuseStorageWrite(key);
    try {
      await act(async () => window.dispatchEvent(new window.MessageEvent("message", {
        data: { protocol: TASKS_PROTOCOL, kind: "sync", payload },
        origin: "https://lms.uconn.edu",
        source: { postMessage: (reply: unknown) => replies.push(reply) } as never,
      })));
      assert.deepEqual(replies, [{ protocol: TASKS_PROTOCOL, kind: "stored", ok: false }], key);
      assert.deepEqual(keys.map((name) => storage.getItem(name)), before, key);
      assert.deepEqual(app.calendar.subscriptions, [existing], key);
      assert.deepEqual(app.calendar.courses, [], key);
      assert.deepEqual(app.calendar.announcements, [], key);
      assert.equal(app.calendar.doneIds.size, 0, key);
      assert.ok(app.calendar.error?.includes("could not be saved"), key);
    } finally { restore(); await app.unmount(); }
  }
});

test("an older sync decode cannot reopen an offer after a newer link was cleared", async () => {
  const app = await mount();
  const packed = await encodeSyncPayload(buildSyncPayload({ feeds: [savedFeed()], completedIds: [], courses: EMPTY_COURSE_BOOK }));
  const NativeDecompressionStream = globalThis.DecompressionStream;
  const gates: Array<() => void> = [];
  globalThis.DecompressionStream = class {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<BufferSource>;
    constructor(format: CompressionFormat) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      gates.push(release);
      const delayed = new TransformStream<BufferSource, BufferSource>({ async transform(chunk, controller) { await gate; controller.enqueue(chunk); } });
      this.writable = delayed.writable;
      this.readable = delayed.readable.pipeThrough(new NativeDecompressionStream(format));
    }
  } as typeof DecompressionStream;
  try {
    await act(async () => {
      window.location.hash = `#sync=${packed}`;
      window.dispatchEvent(new window.Event("hashchange"));
    });
    assert.ok(gates.length > 0);
    await act(async () => app.calendar.clearSavedData());
    await act(async () => { gates.forEach((release) => release()); });
    await settle(50);
    assert.equal(app.calendar.pendingSync, null);
    assert.equal(window.location.hash, "");
  } finally {
    gates.forEach((release) => release());
    globalThis.DecompressionStream = NativeDecompressionStream;
    await app.unmount();
  }
});

test("a source-identified deadline keeps its tick and note through a rename, move and reload", async () => {
  const FRIDAY = "2026-10-16T03:59:00.000Z";
  const SUNDAY = "2026-10-18T03:59:00.000Z";
  const hw = (start: string) => ({
    id: `huskyct-todo-_101_1:${start}`,
    title: start === FRIDAY ? "Homework 5" : "Homework 5 (extended)",
    course: "MATH 1131Q",
    start,
    dateKey: null,
    end: null,
    allDay: false,
    location: null,
    kind: "assignment" as const,
  });
  const deliver = async (start: string) => {
    const payload = JSON.parse(
      serialiseSyncPayload(
        buildSyncPayload({
          feeds: [{ name: "HuskyCT to-do", courseId: null, importedAt: new RealDate().toISOString(), events: [hw(start)] }],
          completedIds: [],
          courses: EMPTY_COURSE_BOOK,
        }),
      ),
    );
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
  };

  const app = await mount();
  await deliver(FRIDAY);
  const oldId = `huskyct-todo-_101_1:${FRIDAY}`;
  const newId = `huskyct-todo-_101_1:${SUNDAY}`;
  await act(async () => app.calendar.toggleTaskCompletion(oldId));
  await act(async () => app.calendar.editEvent(oldId, { note: "ask for an extension" }));
  assert.ok(app.calendar.doneIds.has(oldId));
  assert.equal(app.calendar.eventNoteFor(oldId), "ask for an extension");

  await deliver(SUNDAY);

  assert.deepEqual(app.calendar.tasks.map((task) => task.id), [newId], "the old instance is shown beside the new one");
  assert.ok(app.calendar.doneIds.has(newId), "the tick did not follow the deadline");
  assert.equal(app.calendar.doneIds.has(oldId), false);
  assert.equal(app.calendar.eventNoteFor(newId), "ask for an extension");
  assert.equal(app.calendar.tasks[0].title, "Homework 5 (extended)");
  assert.deepEqual(Object.keys(app.calendar.moveNotices), [newId]);
  assert.equal(app.calendar.moveNotices[newId].from, FRIDAY);
  assert.equal(app.calendar.moveNotices[newId].to, SUNDAY);
  const saved = JSON.parse(window.localStorage.getItem("huskypilot.completedTasks.imported.v1") ?? "{}");
  assert.ok(JSON.stringify(saved).includes(newId) && !JSON.stringify(saved).includes(oldId), "the saved ticks still name the old id");
  await app.unmount();
  const restored = await mount();
  assert.deepEqual(restored.calendar.tasks.map((task) => task.id), [newId]);
  assert.ok(restored.calendar.doneIds.has(newId));
  assert.equal(restored.calendar.eventNoteFor(newId), "ask for an extension");

  await act(async () => restored.calendar.dismissMoveNotice(newId));
  assert.deepEqual(restored.calendar.moveNotices, {});
  assert.equal(window.localStorage.getItem("huskypilot.moves.v1"), null);
  await restored.unmount();
});

test("legacy Calendar decisions remain on their dated record after old and new helper deliveries", async () => {
  const firstStart = "2026-10-16T03:59:00.000Z";
  const laterStart = "2026-10-18T03:59:00.000Z";
  const legacyUid = "huskyct-due-_203765_1-Weekly-Reading";
  const event = (uid: string, start: string) => ({
    id: `${uid}:${start}`, title: "Weekly Reading", course: "MATH 1131Q",
    start, dateKey: null, end: null, allDay: false, location: null, kind: "assignment" as const,
  });
  const original = event(legacyUid, firstStart);
  const later = event(legacyUid, laterStart);
  const canonical = event("huskyct-todo-_101_1", laterStart);
  const app = await mount();
  for (const task of [original, later, canonical]) {
    const replies: unknown[] = [];
    const payload = JSON.parse(serialiseSyncPayload(buildSyncPayload({
      feeds: [{ name: "HuskyCT to-do", courseId: null, importedAt: new RealDate().toISOString(), events: [task] }],
      completedIds: [], courses: EMPTY_COURSE_BOOK,
    })));
    await act(async () => window.dispatchEvent(new window.MessageEvent("message", {
      data: { protocol: TASKS_PROTOCOL, kind: "sync", payload }, origin: "https://lms.uconn.edu",
      source: { postMessage: (reply: unknown) => replies.push(reply) } as never,
    })));
    assert.deepEqual(replies, [{ protocol: TASKS_PROTOCOL, kind: "stored", ok: true }]);
    if (task === original) {
      await act(async () => app.calendar.toggleTaskCompletion(original.id));
      await act(async () => app.calendar.editEvent(original.id, { note: "my saved note" }));
    }
  }
  await app.unmount();
  const restored = await mount();
  assert.equal(restored.calendar.subscriptions.length, 1);
  assert.deepEqual(restored.calendar.tasks.map((task) => task.id), [original.id, later.id, canonical.id]);
  assert.deepEqual(restored.calendar.doneIds, new Set([original.id]));
  assert.equal(restored.calendar.eventNoteFor(original.id), "my saved note");
  assert.equal(restored.calendar.eventNoteFor(canonical.id), null);
  assert.deepEqual(restored.calendar.moveNotices, {});
  await restored.unmount();
});
