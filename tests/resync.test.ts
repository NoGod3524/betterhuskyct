import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import type { Subscription } from "../src/lib/subscriptions.ts";
import { buildSyncPayload } from "../src/lib/sync.ts";
import { eventUid, mergeSyncPayload, type LocalState } from "../src/lib/sync-merge.ts";

const AT = new Date("2026-09-23T12:00:00Z");
const DUE = "2026-09-25T03:59:00.000Z";

/**
 * A task with the id every real producer builds: `uid + ":" + start`.
 *
 * The first version of these tests used a bare id that did not change when the
 * start did, and so passed while a moved deadline showed up twice on a real
 * device — the id is where the move shows, so the fixture has to carry it.
 */
function task(uid: string, start = DUE, course: string | null = "MATH 1070Q"): CalendarTask {
  return {
    id: `${uid}:${start}`,
    title: uid,
    course,
    start,
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
function send(events: CalendarTask[], name = "HuskyCT to-do") {
  return buildSyncPayload({
    feeds: [{ name, courseId: null, importedAt: AT.toISOString(), events }],
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

test("eventUid takes the start back off a producer's id", () => {
  assert.equal(eventUid(task("huskyct-todo-_1")), "huskyct-todo-_1");
  // A UID with colons of its own keeps them.
  assert.equal(eventUid(task("a:b:c")), "a:b:c");
  // An id not built that way is its own UID.
  assert.equal(eventUid({ ...task("x"), id: "legacy" }), "legacy");
});

test("sending a to-do list twice keeps every deadline from the second send", () => {
  const first = mergeSyncPayload(EMPTY, send([task("A"), task("B")]));

  // The helper re-sends the whole list, so A and B are in this payload again and
  // C is the one that is new. The old rule ("if any event is already known, skip
  // the whole feed") dropped C silently.
  const second = mergeSyncPayload(localOf(first), send([task("A"), task("B"), task("C")]));

  assert.deepEqual(idsOnDevice(localOf(second)).map((id) => id.split(":")[0]).sort(), ["A", "B", "C"]);
  assert.equal(second.subscriptions.length, 1);
  assert.equal(second.addedFeeds, 0, "no calendar was added, one was extended");
  assert.equal(second.addedEvents, 1);
  assert.equal(second.updatedEvents, 0);
});

test("a rescheduled deadline moves instead of appearing twice", () => {
  const first = mergeSyncPayload(EMPTY, send([task("huskyct-todo-_1"), task("huskyct-todo-_2")]));

  const moved = "2026-10-02T03:59:00.000Z";
  const second = mergeSyncPayload(
    localOf(first),
    send([task("huskyct-todo-_1", moved), task("huskyct-todo-_2")]),
  );
  const ids = idsOnDevice(localOf(second)).sort();

  assert.deepEqual(ids, [`huskyct-todo-_1:${moved}`, `huskyct-todo-_2:${DUE}`]);
  assert.equal(second.addedEvents, 0);
  assert.equal(second.updatedEvents, 1);
});

test("a list where every deadline moved still lands in the same calendar", () => {
  const first = mergeSyncPayload(EMPTY, send([task("A")]));
  const later = "2026-10-09T03:59:00.000Z";
  const second = mergeSyncPayload(localOf(first), send([task("A", later)]));

  assert.equal(second.subscriptions.length, 1, "a second calendar was started for a moved deadline");
  assert.deepEqual(idsOnDevice(localOf(second)), [`A:${later}`]);
});

test("a deadline the helper no longer lists is kept", () => {
  const first = mergeSyncPayload(EMPTY, send([task("A"), task("B")]));
  const second = mergeSyncPayload(localOf(first), send([task("B")]));

  assert.deepEqual(idsOnDevice(localOf(second)).map((id) => id.split(":")[0]).sort(), ["A", "B"]);
});

test("unrelated calendars that share Blackboard's name are not merged", () => {
  // Every Blackboard course feed is called "University of Connecticut", so a
  // name match would file one course's deadlines under another course.
  const math: Subscription = {
    id: "sub-math",
    name: "University of Connecticut",
    courseId: null,
    url: null,
    importedAt: AT.toISOString(),
    lastError: null,
    events: [task("math-hw")],
  };

  const merged = mergeSyncPayload(
    { ...EMPTY, subscriptions: [math] },
    send([task("engl-essay", DUE, "ENGL 1007")], "University of Connecticut"),
  );

  assert.equal(merged.subscriptions.length, 2);
  assert.deepEqual(merged.subscriptions[0].events.map((e) => e.title), ["math-hw"]);
  assert.deepEqual(merged.subscriptions[1].events.map((e) => e.title), ["engl-essay"]);
  assert.equal(merged.addedFeeds, 1);
});

test("a genuinely new calendar still becomes its own subscription", () => {
  const first = mergeSyncPayload(EMPTY, send([task("A")]));
  const second = mergeSyncPayload(localOf(first), send([task("Z")], "Some other course"));

  assert.equal(second.subscriptions.length, 2);
  assert.ok(idsOnDevice(localOf(second)).includes(`Z:${DUE}`));
  assert.equal(second.addedFeeds, 1);
  assert.equal(second.addedEvents, 1);
});

test("re-sending an unchanged recurring feed reports no changes", () => {
  const weeks = ["2026-09-28T14:00:00.000Z", "2026-10-05T14:00:00.000Z"];
  const lecture = weeks.map((start) => ({ ...task("lec-1", start), kind: "class" as const }));

  const first = mergeSyncPayload(EMPTY, send(lecture, "MATH 1070Q"));
  const second = mergeSyncPayload(localOf(first), send(lecture, "MATH 1070Q"));

  assert.equal(idsOnDevice(localOf(second)).length, 2);
  assert.equal(second.addedEvents, 0);
  assert.equal(second.updatedEvents, 0);
});
