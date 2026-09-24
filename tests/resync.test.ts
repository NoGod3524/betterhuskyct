import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { buildSyncPayload } from "../src/lib/sync.ts";
import { mergeSyncPayload, type LocalState } from "../src/lib/sync-merge.ts";

const AT = new Date("2026-09-23T12:00:00Z");

function task(id: string): CalendarTask {
  return {
    id,
    title: id,
    course: "MATH 1070Q",
    start: "2026-09-25T03:59:00.000Z",
    dateKey: null,
    end: null,
    allDay: false,
    location: null,
    kind: "assignment",
  };
}

/**
 * What the helper actually sends.
 *
 * One feed named "HuskyCT to-do", holding every deadline currently outstanding.
 * That shape is the whole reason the second send used to lose data: the feed is
 * re-sent whole, so any deadline the device already has appears again.
 */
function send(ids: string[]) {
  return buildSyncPayload({
    feeds: [
      {
        name: "HuskyCT to-do",
        courseId: null,
        importedAt: AT.toISOString(),
        events: ids.map(task),
      },
    ],
    completedIds: [],
    efforts: {},
    courses: EMPTY_COURSE_BOOK,
    announcements: [],
    now: AT,
  });
}

function localOf(merged: ReturnType<typeof mergeSyncPayload>): LocalState {
  return {
    courses: merged.courses,
    efforts: merged.efforts,
    completedIds: merged.completedIds,
    subscriptions: merged.subscriptions,
    announcements: merged.announcements,
  };
}

const EMPTY: LocalState = {
  courses: EMPTY_COURSE_BOOK,
  efforts: {},
  completedIds: new Set(),
  subscriptions: [],
  announcements: [],
};

function idsOnDevice(state: LocalState): string[] {
  return state.subscriptions.flatMap((s) => s.events.map((e) => e.id));
}

test("sending a to-do list twice keeps every deadline from the second send", () => {
  const first = mergeSyncPayload(EMPTY, send(["A", "B"]));
  assert.deepEqual(idsOnDevice(localOf(first)).sort(), ["A", "B"]);

  // The helper re-sends the whole list, so A and B are in this payload again and
  // C is the one that is new. The old rule ("if any event is already known, skip
  // the whole feed") dropped C silently.
  const second = mergeSyncPayload(localOf(first), send(["A", "B", "C"]));
  const ids = idsOnDevice(localOf(second));

  assert.ok(ids.includes("C"), "the new deadline C was dropped: " + JSON.stringify(ids));
  assert.deepEqual(ids.sort(), ["A", "B", "C"]);
});

test("a changed due time on an already-known deadline is not lost", () => {
  const first = mergeSyncPayload(EMPTY, send(["A"]));

  // Same set of deadlines, but A moved. The payload looks "already known" as a
  // whole, which is why the feed-level rule swallowed it.
  const moved = buildSyncPayload({
    feeds: [
      {
        name: "HuskyCT to-do",
        courseId: null,
        importedAt: new Date(AT.getTime() + 3_600_000).toISOString(),
        events: [{ ...task("A"), start: "2026-10-02T03:59:00.000Z" }],
      },
    ],
    completedIds: [],
    efforts: {},
    courses: EMPTY_COURSE_BOOK,
    announcements: [],
    now: AT,
  });

  const second = mergeSyncPayload(localOf(first), moved);
  const starts = localOf(second).subscriptions.flatMap((s) => s.events.map((e) => e.start));

  assert.ok(
    starts.includes("2026-10-02T03:59:00.000Z"),
    "the moved deadline kept its old time: " + JSON.stringify(starts),
  );
});

test("a genuinely new calendar still becomes its own subscription", () => {
  const first = mergeSyncPayload(EMPTY, send(["A"]));

  const other = buildSyncPayload({
    feeds: [
      {
        name: "Some other course",
        courseId: null,
        importedAt: AT.toISOString(),
        events: [task("Z")],
      },
    ],
    completedIds: [],
    efforts: {},
    courses: EMPTY_COURSE_BOOK,
    announcements: [],
    now: AT,
  });

  const second = mergeSyncPayload(localOf(first), other);
  assert.equal(localOf(second).subscriptions.length, 2);
  assert.ok(idsOnDevice(localOf(second)).includes("Z"));
});
