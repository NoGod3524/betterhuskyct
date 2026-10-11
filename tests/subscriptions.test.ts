import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import {
  SUBSCRIPTIONS_STORAGE_KEY,
  clearSubscriptions,
  latestImportAt,
  mergeTasks,
  parseStoredSubscriptions,
  removeSubscription,
  restoreSubscriptions,
  saveSubscriptions,
  taskOwnerIndex,
  ticksForTasks,
  updateSubscription,
  type Subscription,
} from "../src/lib/subscriptions.ts";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function task(id: string, title = id): CalendarTask {
  return {
    id,
    title,
    course: null,
    start: "2026-09-11T12:30:00.000Z",
    dateKey: null,
    end: null,
    allDay: false,
    location: null,
    kind: "assignment",
  };
}

function feed(id: string, events: CalendarTask[], patch: Partial<Subscription> = {}): Subscription {
  return {
    id,
    name: `Calendar ${id}`,
    courseId: null,
    importedAt: "2026-09-10T12:00:00.000Z",
    events,
    ...patch,
  };
}

test("saveSubscriptions round-trips through restoreSubscriptions", () => {
  const storage = new MemoryStorage();
  const subscriptions = [
    feed("a", [task("t1")], { courseId: "course-1" }),
    feed("b", [task("t2")]),
  ];

  saveSubscriptions(storage, subscriptions);

  assert.deepEqual(restoreSubscriptions(storage).subscriptions, subscriptions);
});

test("restoreSubscriptions returns nothing when nothing is stored", () => {
  assert.deepEqual(restoreSubscriptions(new MemoryStorage()), {
    subscriptions: [],
    recoveredFromCorruptData: false,
  });
});

test("restoreSubscriptions clears corrupt data instead of throwing", () => {
  const storage = new MemoryStorage();
  storage.setItem(SUBSCRIPTIONS_STORAGE_KEY, "{not-json");

  assert.deepEqual(restoreSubscriptions(storage), {
    subscriptions: [],
    recoveredFromCorruptData: true,
  });
  assert.equal(storage.getItem(SUBSCRIPTIONS_STORAGE_KEY), null);
});

test("parseStoredSubscriptions rejects other versions and bad shapes", () => {
  assert.equal(parseStoredSubscriptions(JSON.stringify({ version: 2, subscriptions: [] })), null);
  assert.equal(parseStoredSubscriptions(JSON.stringify({ version: 1 })), null);
  assert.equal(parseStoredSubscriptions(JSON.stringify(["nope"])), null);
});

test("parseStoredSubscriptions skips a feed with unreadable events", () => {
  const parsed = parseStoredSubscriptions(
    JSON.stringify({
      version: 1,
      subscriptions: [
        feed("a", [task("t1")]),
        { id: "b", importedAt: "2026-09-10T12:00:00.000Z", events: [{ nope: true }] },
        { id: "c", importedAt: "not-a-date", events: [] },
      ],
    }),
  );

  assert.deepEqual(
    parsed?.map((subscription) => subscription.id),
    ["a"],
  );
});

test("parseStoredSubscriptions ignores a duplicate id", () => {
  const parsed = parseStoredSubscriptions(
    JSON.stringify({
      version: 1,
      subscriptions: [feed("a", [task("t1")]), feed("a", [task("t2")])],
    }),
  );

  assert.equal(parsed?.length, 1);
});

test("removeSubscription and updateSubscription only touch their own feed", () => {
  const subscriptions = [feed("a", [task("t1")]), feed("b", [task("t2")])];

  const updated = updateSubscription(subscriptions, "a", { courseId: "course-9" });
  assert.equal(updated[0].courseId, "course-9");
  assert.equal(updated[1].courseId, null);

  assert.deepEqual(
    removeSubscription(subscriptions, "a").map((entry) => entry.id),
    ["b"],
  );
  assert.deepEqual(updateSubscription(subscriptions, "nope", { courseId: "x" }), subscriptions);
});

test("mergeTasks keeps each UID once, in feed order", () => {
  const subscriptions = [
    feed("a", [task("t1"), task("shared")]),
    feed("b", [task("shared"), task("t2")]),
  ];

  assert.deepEqual(
    mergeTasks(subscriptions).map((entry) => entry.id),
    ["t1", "shared", "t2"],
  );
  assert.deepEqual(mergeTasks([]), []);
});

test("taskOwnerIndex reports the first feed that holds a task", () => {
  const owners = taskOwnerIndex([
    feed("a", [task("t1"), task("shared")]),
    feed("b", [task("shared"), task("t2")]),
  ]);

  assert.equal(owners.get("t1"), "a");
  assert.equal(owners.get("shared"), "a");
  assert.equal(owners.get("t2"), "b");
  assert.equal(owners.get("missing"), undefined);
});

test("latestImportAt returns the newest successful import", () => {
  assert.equal(latestImportAt([]), null);
  assert.equal(
    latestImportAt([
      feed("a", [], { importedAt: "2026-09-01T00:00:00.000Z" }),
      feed("b", [], { importedAt: "2026-09-09T00:00:00.000Z" }),
    ]),
    "2026-09-09T00:00:00.000Z",
  );
  // An unreadable timestamp must not win or throw.
  assert.equal(
    latestImportAt([
      feed("a", [], { importedAt: "nonsense" }),
      feed("b", [], { importedAt: "2026-09-01T00:00:00.000Z" }),
    ]),
    "2026-09-01T00:00:00.000Z",
  );
});

test("ticksForTasks keeps only ticks whose task is still on screen", () => {
  const subscriptions = [feed("a", [task("t1"), task("t2")]), feed("b", [task("t3")])];

  // t9 belonged to a task that has since gone from every feed.
  const ticks = ticksForTasks(["t1", "t3", "t9"], subscriptions);

  assert.deepEqual([...ticks].sort(), ["t1", "t3"]);
  assert.deepEqual([...ticksForTasks(["t1"], [])], [], "no calendars means no ticks on screen");
});

const RETIRED = ["huskypilot.rememberSource.v1", "huskypilot.importedCalendar.v1", "huskypilot.calendarSource.v1"];

test("opening the app removes the keys of the retired link import, and the address a saved calendar still carries", () => {
  const storage = new MemoryStorage();
  for (const key of RETIRED) storage.setItem(key, "https://lms.uconn.edu/webapps/calendar/calendarFeed/secret/learn.ics");
  storage.setItem(
    SUBSCRIPTIONS_STORAGE_KEY,
    JSON.stringify({ version: 1, subscriptions: [{ ...feed("a", [task("t1")]), url: "https://lms.uconn.edu/webapps/calendar/calendarFeed/secret/learn.ics", lastError: "boom" }] }),
  );

  const { subscriptions } = restoreSubscriptions(storage);

  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].events.length, 1, "the events went with the address");
  for (const key of RETIRED) assert.equal(storage.getItem(key), null, key);
  assert.ok(!(storage.getItem(SUBSCRIPTIONS_STORAGE_KEY) ?? "").includes("secret"), "the private address is still stored");
  assert.ok(!("url" in subscriptions[0]) && !("lastError" in subscriptions[0]));
});

test("clearSubscriptions removes the saved calendars", () => {
  const storage = new MemoryStorage();
  saveSubscriptions(storage, [feed("a", [task("t1")])]);
  clearSubscriptions(storage);
  assert.equal(storage.getItem(SUBSCRIPTIONS_STORAGE_KEY), null);
});
