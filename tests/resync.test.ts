import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { MAX_SUBSCRIPTIONS, latestImportAt, type Subscription } from "../src/lib/subscriptions.ts";
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
    courses: EMPTY_COURSE_BOOK,
    announcements: [],
    now: AT,
  });
}

function localOf(merged: ReturnType<typeof mergeSyncPayload>): LocalState {
  return {
    courses: merged.courses,
    completedIds: merged.completedIds,
    subscriptions: merged.subscriptions,
    announcements: merged.announcements,
  };
}

const EMPTY: LocalState = {
  courses: EMPTY_COURSE_BOOK,
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

test("mixed fresh and retained helper rows merge by their actual reading times", () => {
  const stamps = [0, 60_000, 120_000, 180_000].map(offset => new Date(+AT + offset).toISOString());
  const original = { ...task("huskyct-todo-_1"), observedAt: stamps[0] };
  const corrected = { ...task("huskyct-todo-_1", "2026-09-26T03:59:00.000Z"), observedAt: stamps[1] };
  const other = { ...task("huskyct-todo-_2"), observedAt: stamps[2] };
  const first = mergeSyncPayload(EMPTY, send([corrected]));
  const retained = send([original, other]);
  retained.feeds[0].importedAt = stamps[2];
  const mixed = mergeSyncPayload(localOf(first), retained);
  assert.deepEqual(mixed.subscriptions[0].events, [corrected, other]);
  assert.equal(mixed.updatedEvents, 0);
  assert.deepEqual(mixed.moves, []);
  const genuinelyMoved = { ...original, observedAt: stamps[3] };
  const fresh = mergeSyncPayload(localOf(mixed), send([genuinelyMoved]));
  assert.equal(fresh.subscriptions[0].events.find(row => eventUid(row) === eventUid(original))?.start, original.start);
  assert.equal(fresh.updatedEvents, 1);
  assert.equal(fresh.moves.length, 1);
});

test("upgrading legacy rows freezes their prior reading before an unrelated task advances the feed", () => {
  const stamps = [0, 60_000, 120_000, 180_000].map(offset => new Date(+AT + offset).toISOString());
  const first = mergeSyncPayload(EMPTY, send([task("huskyct-todo-_1"), task("huskyct-todo-_2")]));
  const update = send([{ ...task("huskyct-todo-_1"), observedAt: stamps[1] }]);
  update.feeds[0].importedAt = stamps[3];
  const second = mergeSyncPayload(localOf(first), update);
  assert.equal(second.subscriptions[0].events.find(row => eventUid(row) === "huskyct-todo-_2")?.observedAt, stamps[0]);
  const moved = { ...task("huskyct-todo-_2", "2026-09-26T03:59:00.000Z"), observedAt: stamps[2] };
  const third = mergeSyncPayload(localOf(second), send([moved]));
  assert.equal(third.subscriptions[0].events.find(row => eventUid(row) === "huskyct-todo-_2")?.id, moved.id);
  assert.equal(third.updatedEvents, 1);
  const stale = send([{ ...moved, observedAt: stamps[0] }]);
  stale.feeds[0].importedAt = new Date(+AT + 240_000).toISOString();
  const ignored = mergeSyncPayload(localOf(third), stale);
  assert.equal(ignored.subscriptions[0].importedAt, third.subscriptions[0].importedAt);
});

test("legacy Calendar title ids cannot transfer a tick to a different deadline", () => {
  const old = task("huskyct-due-_203765_1-Weekly-Reading");
  const later = task("huskyct-due-_203765_1-Weekly-Reading", "2026-10-02T03:59:00.000Z");
  const first = mergeSyncPayload(EMPTY, send([old]));
  first.completedIds.add(old.id);
  const second = mergeSyncPayload(localOf(first), send([later]));

  assert.equal(eventUid(old), old.id, "a title-derived UID does not prove source identity");
  assert.equal(second.subscriptions.length, 1);
  assert.deepEqual(idsOnDevice(second), [old.id, later.id]);
  assert.deepEqual(second.completedIds, new Set([old.id]));
  assert.deepEqual(second.moves, []);
  assert.equal(second.addedEvents, 1);
  assert.equal(mergeSyncPayload(localOf(second), send([later])).addedEvents, 0);
});

test("a canonical helper feed reuses its only legacy container without guessing task state", () => {
  const old = task("huskyct-due-_203765_1-Weekly-Reading");
  const current = { ...task("huskyct-todo-_101_1"), title: old.title };
  const first = mergeSyncPayload(EMPTY, send([old]));
  first.completedIds.add(old.id);
  first.subscriptions[0].name = "My deadlines";
  const second = mergeSyncPayload(localOf(first), send([current]));

  assert.equal(second.addedFeeds, 0);
  assert.equal(second.subscriptions[0].id, first.subscriptions[0].id);
  assert.equal(second.subscriptions[0].name, "My deadlines");
  assert.deepEqual(idsOnDevice(second), [old.id, current.id]);
  assert.deepEqual(second.completedIds, new Set([old.id]));
  assert.deepEqual(second.moves, []);
});

test("helper container fallback refuses mixed, ambiguous and unrelated calendars", () => {
  const legacy = send([task("huskyct-due-old")]).feeds[0];
  const other = send([task("other")]).feeds[0];
  const helper = send([task("huskyct-todo-_101_1")]);
  const subscription = (id: string, feed = legacy): Subscription => ({ id, ...feed });
  for (const subscriptions of [
    [subscription("mixed", { ...legacy, events: [...legacy.events, ...other.events] })],
    [subscription("a"), subscription("b")],
    [subscription("unrelated", other)],
  ]) {
    const merged = mergeSyncPayload({ ...EMPTY, subscriptions }, helper);
    assert.equal(merged.addedFeeds, 1);
    assert.equal(merged.subscriptions.length, subscriptions.length + 1);
  }
  const first = mergeSyncPayload(EMPTY, send([task("huskyct-due-old")]));
  const unrelated = mergeSyncPayload(localOf(first), send([task("other")], "HuskyCT to-do"));
  assert.equal(unrelated.addedFeeds, 1, "the name never identifies a helper feed");
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
    importedAt: AT.toISOString(),
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

test("a full subscription list still updates known calendars after skipping a new one", () => {
  const subscriptions = Array.from({ length: MAX_SUBSCRIPTIONS }, (_, index) => ({
    id: `local-${index}`,
    ...send([task(`task-${index}`)]).feeds[0],
  }));
  const moved = task("task-0", "2026-10-02T03:59:00.000Z");
  const incoming = send([task("new-calendar")]);
  incoming.feeds.push(send([moved, task("new-deadline")]).feeds[0]);

  const merged = mergeSyncPayload({ ...EMPTY, subscriptions }, incoming);

  assert.equal(merged.subscriptions.length, MAX_SUBSCRIPTIONS);
  assert.equal(merged.addedFeeds, 0);
  assert.equal(merged.addedEvents, 1);
  assert.equal(merged.updatedEvents, 1);
  assert.deepEqual(merged.subscriptions[0].events, [moved, task("new-deadline")]);
  assert.deepEqual(subscriptions[0].events, [task("task-0")], "the local input was mutated");
});

test("changing only an all-day calendar date counts as an update", () => {
  const original = { ...task("all-day"), allDay: true, dateKey: "2026-09-25" };
  const first = mergeSyncPayload(EMPTY, send([original]));
  const changed = { ...original, dateKey: "2026-09-26" };

  const second = mergeSyncPayload(localOf(first), send([changed]));

  assert.deepEqual(second.subscriptions[0].events, [changed]);
  assert.equal(second.updatedEvents, 1);
  assert.equal(mergeSyncPayload(localOf(second), send([changed])).updatedEvents, 0);
});

test("re-syncing a calendar advances its import time without older payloads rolling it back", () => {
  const first = mergeSyncPayload(EMPTY, send([task("A")]));
  const newer = send([task("A")]);
  const later = "2026-09-24T12:00:00.000Z";
  newer.feeds[0].importedAt = later;

  const second = mergeSyncPayload(localOf(first), newer);
  assert.equal(latestImportAt(second.subscriptions), later);
  assert.equal(second.updatedEvents, 0);

  const third = mergeSyncPayload(localOf(second), send([task("A")]));
  assert.equal(latestImportAt(third.subscriptions), later);
});
