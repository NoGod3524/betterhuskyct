import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { IMPORT_STORAGE_KEY, serializeImportPayload } from "../src/lib/import-storage.ts";
import { CALENDAR_SOURCE_STORAGE_KEY } from "../src/lib/calendar-source.ts";
import {
  MAX_SUBSCRIPTIONS,
  REMEMBER_SOURCE_KEY,
  SUBSCRIPTIONS_STORAGE_KEY,
  addSubscription,
  clearSubscriptions,
  latestImportAt,
  mergeTasks,
  parseStoredSubscriptions,
  removeSubscription,
  restoreRememberSource,
  restoreSubscriptions,
  saveRememberSource,
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
    url: null,
    importedAt: "2026-09-10T12:00:00.000Z",
    lastError: null,
    events,
    ...patch,
  };
}

test("saveSubscriptions round-trips through restoreSubscriptions", () => {
  const storage = new MemoryStorage();
  const subscriptions = [
    feed("a", [task("t1")], { courseId: "course-1", url: "https://x.example/f.ics" }),
    feed("b", [task("t2")], { lastError: "boom" }),
  ];

  saveSubscriptions(storage, subscriptions);

  assert.deepEqual(restoreSubscriptions(storage).subscriptions, subscriptions);
});

test("restoreSubscriptions migrates the 1.0.x single import and its URL", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    IMPORT_STORAGE_KEY,
    serializeImportPayload({
      calendarName: "University of Connecticut",
      importedAt: "2026-09-10T12:00:00.000Z",
      events: [task("t1", "Environmental Science")],
    }),
  );
  storage.setItem(
    CALENDAR_SOURCE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      url: "https://huskyct.uconn.edu/learn.ics",
      savedAt: "2026-09-10T12:00:00.000Z",
    }),
  );

  const restored = restoreSubscriptions(storage);

  assert.equal(restored.subscriptions.length, 1);
  assert.equal(restored.subscriptions[0].events.length, 1);
  assert.equal(restored.subscriptions[0].name, "University of Connecticut");
  assert.equal(restored.subscriptions[0].url, "https://huskyct.uconn.edu/learn.ics");
  assert.equal(restored.subscriptions[0].courseId, null);
  // Migrating is a one-way door: the old keys must not come back.
  assert.equal(storage.getItem(IMPORT_STORAGE_KEY), null);
  assert.equal(storage.getItem(CALENDAR_SOURCE_STORAGE_KEY), null);
  assert.equal(restoreSubscriptions(storage).subscriptions.length, 1);
});

test("migrating an import that was never remembered yields no URL", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    IMPORT_STORAGE_KEY,
    serializeImportPayload({
      calendarName: null,
      importedAt: "2026-09-10T12:00:00.000Z",
      events: [task("t1")],
    }),
  );

  assert.equal(restoreSubscriptions(storage).subscriptions[0].url, null);
});

test("a stale remembered URL with no import is simply dropped", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    CALENDAR_SOURCE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      url: "https://huskyct.uconn.edu/learn.ics",
      savedAt: "2026-09-10T12:00:00.000Z",
    }),
  );

  assert.deepEqual(restoreSubscriptions(storage).subscriptions, []);
  assert.equal(storage.getItem(CALENDAR_SOURCE_STORAGE_KEY), null);
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

test("addSubscription links the course and only stores a URL when asked", () => {
  const result = {
    calendarName: "University of Connecticut",
    importedAt: "2026-09-10T12:00:00.000Z",
    events: [task("t1")],
  };

  const remembered = addSubscription([], result, {
    courseId: "course-1",
    url: "https://huskyct.uconn.edu/learn.ics",
  });
  assert.equal(remembered.length, 1);
  assert.equal(remembered[0].courseId, "course-1");
  assert.equal(remembered[0].url, "https://huskyct.uconn.edu/learn.ics");

  const oneShot = addSubscription([], result);
  assert.equal(oneShot[0].url, null);
  assert.equal(oneShot[0].courseId, null);
});

test("addSubscription keeps feeds in the order they were added, up to the cap", () => {
  let subscriptions: Subscription[] = [];
  for (let index = 0; index < MAX_SUBSCRIPTIONS + 2; index += 1) {
    subscriptions = addSubscription(subscriptions, {
      calendarName: null,
      importedAt: "2026-09-10T12:00:00.000Z",
      events: [],
    });
  }

  assert.equal(subscriptions.length, MAX_SUBSCRIPTIONS);
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

test("the remember-links preference round-trips", () => {
  const storage = new MemoryStorage();
  assert.equal(restoreRememberSource(storage), false);

  saveRememberSource(storage, true);
  assert.equal(restoreRememberSource(storage), true);

  saveRememberSource(storage, false);
  assert.equal(restoreRememberSource(storage), false);
});

test("clearSubscriptions removes every key it owns", () => {
  const storage = new MemoryStorage();
  saveSubscriptions(storage, [feed("a", [task("t1")], { url: "https://x.example/f.ics" })]);
  storage.setItem(IMPORT_STORAGE_KEY, "{}");
  storage.setItem(CALENDAR_SOURCE_STORAGE_KEY, "{}");

  clearSubscriptions(storage);

  assert.equal(storage.getItem(SUBSCRIPTIONS_STORAGE_KEY), null);
  assert.equal(storage.getItem(IMPORT_STORAGE_KEY), null);
  assert.equal(storage.getItem(CALENDAR_SOURCE_STORAGE_KEY), null);
  // The preference is not data to be cleared alongside the feeds.
  saveRememberSource(storage, true);
  clearSubscriptions(storage);
  assert.equal(storage.getItem(REMEMBER_SOURCE_KEY), "true");
});
