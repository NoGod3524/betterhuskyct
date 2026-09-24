import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import type { Subscription } from "../src/lib/subscriptions.ts";
import { buildSyncPayload } from "../src/lib/sync.ts";
import { planSyncApply, type SyncApplyInput } from "../src/lib/sync-apply.ts";

const START = "2026-10-01T15:00:00.000Z";

function task(uid: string): CalendarTask {
  return {
    id: `${uid}:${START}`,
    title: uid,
    course: null,
    start: START,
    dateKey: null,
    end: null,
    allDay: false,
    location: null,
    kind: "assignment",
  };
}

function feed(events: CalendarTask[]): Subscription {
  return {
    id: "local-feed",
    name: "Mine",
    courseId: null,
    url: null,
    importedAt: START,
    lastError: null,
    events,
  };
}

function link(options: { feeds?: CalendarTask[][]; ticks?: string[] } = {}) {
  return buildSyncPayload({
    feeds: (options.feeds ?? [[task("incoming")]]).map((events) => ({
      name: "HuskyCT to-do",
      courseId: null,
      importedAt: START,
      events,
    })),
    completedIds: options.ticks ?? [],
    efforts: {},
    courses: EMPTY_COURSE_BOOK,
  });
}

function device(patch: Partial<SyncApplyInput>): SyncApplyInput {
  return {
    courses: EMPTY_COURSE_BOOK,
    efforts: {},
    subscriptions: [],
    announcements: [],
    showingImported: false,
    ticksOnScreen: new Set(),
    savedTicks: new Set(),
    ...patch,
  };
}

test("accepting a link while the demo is showing keeps demo ticks out of the real set", () => {
  // The demo's tick is in memory; the real one is only in storage. Merging the
  // in-memory set is what wrote `demo-cse-problem-set` into saved data.
  const real = task("real");
  const plan = planSyncApply(
    device({
      subscriptions: [feed([real])],
      showingImported: false,
      ticksOnScreen: new Set(["demo-cse-problem-set"]),
      savedTicks: new Set([real.id]),
    }),
    link({ ticks: [task("incoming").id] }),
  );

  assert.deepEqual([...plan.ticksToSave].sort(), [task("incoming").id, real.id].sort());
  assert.ok(!plan.ticksToSave.has("demo-cse-problem-set"), "a demo tick was saved as a real one");
});

test("while imported calendars are showing, the ticks on screen are the ones merged", () => {
  const mine = task("mine");
  const plan = planSyncApply(
    device({
      subscriptions: [feed([mine])],
      showingImported: true,
      ticksOnScreen: new Set([mine.id]),
      savedTicks: new Set(),
    }),
    link(),
  );

  assert.ok(plan.ticksToSave.has(mine.id));
});

test("a link that brings a calendar switches the screen off the demo", () => {
  const plan = planSyncApply(device({ ticksOnScreen: new Set(["demo-x"]) }), link({ ticks: ["t"] }));

  assert.equal(plan.showImported, true);
  assert.deepEqual(plan.ticksOnScreen && [...plan.ticksOnScreen], ["t"]);
});

test("a link with no calendars leaves the demo, and its ticks, alone", () => {
  const plan = planSyncApply(
    device({ ticksOnScreen: new Set(["demo-x"]), savedTicks: new Set(["real"]) }),
    link({ feeds: [], ticks: ["t"] }),
  );

  assert.equal(plan.showImported, false);
  assert.equal(plan.ticksOnScreen, null, "the demo view's ticks were replaced");
  // The real set still records the incoming tick.
  assert.deepEqual([...plan.ticksToSave].sort(), ["real", "t"]);
});
