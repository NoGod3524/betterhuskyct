import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPLETION_STORAGE_KEY_DEMO,
  COMPLETION_STORAGE_KEY_IMPORTED,
  restoreCompletedTaskIds,
  saveCompletedTaskIds,
} from "../src/lib/completion-storage.ts";

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

test("saveCompletedTaskIds persists completion state and restoreCompletedTaskIds reads it back", () => {
  const storage = new MemoryStorage();
  saveCompletedTaskIds(storage, "imported", new Set(["event-1", "event-2"]));

  const restored = restoreCompletedTaskIds(storage, "imported");
  assert.equal(restored.size, 2);
  assert.ok(restored.has("event-1"));
  assert.ok(restored.has("event-2"));
});

test("demo and imported completion state are stored separately", () => {
  const storage = new MemoryStorage();
  saveCompletedTaskIds(storage, "demo", new Set(["demo-task"]));
  saveCompletedTaskIds(storage, "imported", new Set(["event-1"]));

  assert.ok(storage.getItem(COMPLETION_STORAGE_KEY_DEMO));
  assert.ok(storage.getItem(COMPLETION_STORAGE_KEY_IMPORTED));

  const demoCompleted = restoreCompletedTaskIds(storage, "demo");
  const importedCompleted = restoreCompletedTaskIds(storage, "imported");
  assert.ok(demoCompleted.has("demo-task"));
  assert.equal(demoCompleted.has("event-1"), false);
  assert.ok(importedCompleted.has("event-1"));
  assert.equal(importedCompleted.has("demo-task"), false);
});

test("re-importing the same events preserves completion state keyed by event id", () => {
  const storage = new MemoryStorage();
  // Simulate a first import where "event-1" was marked complete.
  saveCompletedTaskIds(storage, "imported", new Set(["event-1"]));

  // Simulate re-importing the same calendar: the previously completed id
  // should still be present, along with any new event ids.
  const restored = restoreCompletedTaskIds(storage, "imported");
  const reimportedEventIds = new Set(["event-1", "event-2"]);
  const preserved = new Set(
    [...restored].filter((id) => reimportedEventIds.has(id)),
  );

  assert.ok(preserved.has("event-1"));
  assert.equal(preserved.has("event-2"), false);
});

test("restoreCompletedTaskIds clears corrupt payload safely", () => {
  const storage = new MemoryStorage();
  storage.setItem(COMPLETION_STORAGE_KEY_IMPORTED, "{not-json");

  const restored = restoreCompletedTaskIds(storage, "imported");
  assert.equal(restored.size, 0);
  assert.equal(storage.getItem(COMPLETION_STORAGE_KEY_IMPORTED), null);
});

