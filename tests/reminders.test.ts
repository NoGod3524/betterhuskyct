import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import {
  DEFAULT_REMINDER_STATE,
  REMINDER_STORAGE_KEY,
  dueSoonTasks,
  dueTimestamp,
  reminderSignature,
  restoreReminderState,
  saveReminderState,
  shouldNotify,
} from "../src/lib/reminders.ts";

// September 8, 2026 at 10:00 local time.
const NOW = new Date(2026, 8, 8, 10, 0, 0);

function localIso(year: number, month: number, day: number, hours = 12, minutes = 0) {
  return new Date(year, month, day, hours, minutes, 0).toISOString();
}

function makeTask(overrides: Partial<CalendarTask> & { id: string }): CalendarTask {
  return {
    title: overrides.id,
    course: null,
    start: localIso(2026, 8, 8, 12),
    dateKey: null,
    end: null,
    allDay: false,
    location: null,
    ...overrides,
  };
}

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

test("dueTimestamp uses the start time for timed tasks", () => {
  const task = makeTask({ id: "timed", start: localIso(2026, 8, 8, 14, 30) });

  assert.equal(dueTimestamp(task), new Date(2026, 8, 8, 14, 30, 0).valueOf());
});

test("dueTimestamp uses the end of the day for all-day tasks", () => {
  const task = makeTask({
    id: "all-day",
    allDay: true,
    dateKey: "2026-09-09",
    start: localIso(2026, 8, 8, 0, 0),
  });

  assert.equal(dueTimestamp(task), new Date(2026, 8, 9, 23, 59, 59, 999).valueOf());
});

test("dueTimestamp returns null when the date cannot be parsed", () => {
  assert.equal(dueTimestamp(makeTask({ id: "broken", start: "not-a-date" })), null);
});

test("dueSoonTasks keeps only tasks inside the 24h window, soonest first", () => {
  const tasks = [
    makeTask({ id: "in-20h", start: localIso(2026, 8, 9, 6, 0) }),
    makeTask({ id: "in-2h", start: localIso(2026, 8, 8, 12, 0) }),
    makeTask({ id: "too-far", start: localIso(2026, 8, 10, 12, 0) }),
    makeTask({ id: "already-past", start: localIso(2026, 8, 8, 8, 0) }),
  ];

  assert.deepEqual(
    dueSoonTasks(tasks, NOW).map((task) => task.id),
    ["in-2h", "in-20h"],
  );
});

test("dueSoonTasks leaves a class meeting out of the due count", () => {
  const tasks = [
    makeTask({ id: "lecture", kind: "class", start: localIso(2026, 8, 8, 12, 0) }),
    makeTask({ id: "quiz", kind: "assignment", start: localIso(2026, 8, 8, 12, 0) }),
    makeTask({ id: "plain", start: localIso(2026, 8, 8, 12, 0) }),
  ];

  assert.deepEqual(
    dueSoonTasks(tasks, NOW).map((task) => task.id).sort(),
    ["plain", "quiz"],
  );
});

test("dueSoonTasks treats an all-day task dated today as due today", () => {
  const tasks = [
    makeTask({
      id: "today",
      allDay: true,
      dateKey: "2026-09-08",
      start: localIso(2026, 8, 8, 0, 0),
    }),
    makeTask({
      id: "tomorrow",
      allDay: true,
      dateKey: "2026-09-09",
      start: localIso(2026, 8, 9, 0, 0),
    }),
  ];

  assert.deepEqual(
    dueSoonTasks(tasks, NOW).map((task) => task.id),
    ["today"],
  );
});

test("reminderSignature is independent of task order", () => {
  const first = makeTask({ id: "a" });
  const second = makeTask({ id: "b" });

  assert.equal(reminderSignature([first, second]), reminderSignature([second, first]));
  assert.notEqual(reminderSignature([first]), reminderSignature([first, second]));
});

test("shouldNotify requires an enabled, non-empty reminder", () => {
  assert.equal(
    shouldNotify({ enabled: false, lastSignature: null, lastNotifiedAt: null }, "sig", NOW),
    false,
  );
  assert.equal(
    shouldNotify({ enabled: true, lastSignature: null, lastNotifiedAt: null }, "", NOW),
    false,
  );
});

test("shouldNotify fires for a new task set but not for an immediate repeat", () => {
  const state = {
    enabled: true,
    lastSignature: "sig-1",
    lastNotifiedAt: NOW.toISOString(),
  };

  assert.equal(shouldNotify(state, "sig-2", NOW), true);
  assert.equal(shouldNotify(state, "sig-1", NOW), false);
});

test("shouldNotify re-notifies once the cool-down has passed", () => {
  const state = {
    enabled: true,
    lastSignature: "sig-1",
    lastNotifiedAt: NOW.toISOString(),
  };
  const later = new Date(NOW.valueOf() + 21 * 60 * 60 * 1000);

  assert.equal(shouldNotify(state, "sig-1", later), true);
});

test("saveReminderState round-trips through restoreReminderState", () => {
  const storage = new MemoryStorage();
  const state = {
    enabled: true,
    lastSignature: "sig",
    lastNotifiedAt: NOW.toISOString(),
  };

  saveReminderState(storage, state);

  assert.deepEqual(restoreReminderState(storage), state);
});

test("restoreReminderState falls back safely on corrupt data", () => {
  const storage = new MemoryStorage();
  storage.setItem(REMINDER_STORAGE_KEY, "{not-json");

  assert.deepEqual(restoreReminderState(storage), DEFAULT_REMINDER_STATE);
  assert.equal(storage.getItem(REMINDER_STORAGE_KEY), null);
});

test("restoreReminderState ignores a payload with a different version", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    REMINDER_STORAGE_KEY,
    JSON.stringify({
      version: 99,
      enabled: true,
      lastSignature: "sig",
      lastNotifiedAt: null,
    }),
  );

  assert.deepEqual(restoreReminderState(storage), DEFAULT_REMINDER_STATE);
});

test("restoreReminderState returns defaults when nothing is stored", () => {
  assert.deepEqual(restoreReminderState(new MemoryStorage()), DEFAULT_REMINDER_STATE);
});
