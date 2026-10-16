import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { parseStoredSubscriptions } from "../src/lib/subscriptions.ts";
import { EMPTY_PLAN_STATE, PLAN_DATA_KEY, PLAN_STORAGE_KEY, restorePlanState, saveSwitchedOn } from "../src/lib/ai-plan.ts";

import {
  BACKUP_KEYS,
  BACKUP_VERSION,
  backupFileName,
  createBackup,
  mergeValues,
  parseBackup,
  restoreBackup,
  summarize,
} from "../src/lib/backup.ts";

class MemoryStorage {
  readonly map = new Map<string, string>();
  /** A key the disk refuses to write, as when it fills up part-way through. */
  refuses: string | null = null;
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (key === this.refuses) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const NOW = new Date("2026-10-13T12:00:00.000Z");
const done = (ids: string[]) => JSON.stringify(ids);

function filled() {
  const storage = new MemoryStorage();
  storage.map.set("huskypilot.completedTasks.imported.v1", done(["a", "b"]));
  storage.map.set("huskypilot.customEvents.v1", JSON.stringify([{ id: "e1", title: "Study" }]));
  storage.map.set("huskypilot.grades.v1", JSON.stringify({ courses: [{ id: "c1", items: 3 }], changes: [] }));
  // The theme is stored as a plain word, not JSON.
  storage.map.set("huskypilot.theme.v1", "dark");
  // Not this app's to back up: a retired key that held a private link, and someone else's key.
  storage.map.set("huskypilot.calendarSource.v1", JSON.stringify("https://example.com/private?token=x"));
  storage.map.set("other.app", "{}");
  return storage;
}

test("a backup holds this app's values and nothing else, and reads back as it was", () => {
  const backup = createBackup(filled(), NOW, "1.34.1");

  assert.equal(backup.version, BACKUP_VERSION);
  assert.deepEqual(Object.keys(backup.data).sort(), [
    "huskypilot.completedTasks.imported.v1",
    "huskypilot.customEvents.v1",
    "huskypilot.grades.v1",
    "huskypilot.theme.v1",
  ]);
  assert.ok(!JSON.stringify(backup).includes("token=x"), "a private link is in the file");

  const parsed = parseBackup(JSON.stringify(backup));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.backup.data, backup.data);
  assert.deepEqual(summarize(parsed.backup).map((entry) => [entry.id, entry.items]), [
    ["tasks", 2],
    ["calendar", 1],
    ["grades", 1],
    ["settings", 1],
  ]);
  assert.equal(backupFileName(NOW), "betterhuskyct-backup-2026-10-13.json");
});

test("a file that is not a usable backup is refused with the reason, and one thing in a file never lets another in", () => {
  const good = JSON.stringify(createBackup(filled(), NOW, "1.34.1"));
  assert.deepEqual(parseBackup("  "), { ok: false, reason: "empty" });
  assert.deepEqual(parseBackup("{nope"), { ok: false, reason: "unreadable" });
  assert.deepEqual(parseBackup("[1,2]"), { ok: false, reason: "notBackup" });
  assert.deepEqual(parseBackup(JSON.stringify({ format: "other", version: 1, data: {} })), { ok: false, reason: "notBackup" });
  assert.deepEqual(parseBackup(good.replace('"version":1', '"version":99')), { ok: false, reason: "tooNew" });
  assert.deepEqual(parseBackup(JSON.stringify({ format: "betterhuskyct-backup", version: 1, data: {} })), { ok: false, reason: "nothing" });

  const mixed = parseBackup(
    JSON.stringify({
      format: "betterhuskyct-backup",
      version: 1,
      data: { "huskypilot.theme.v1": "dark", "evil.key": "{}", "huskypilot.courses.v1": 5 },
    }),
  );
  assert.ok(mixed.ok);
  assert.deepEqual(Object.keys(mixed.backup.data), ["huskypilot.theme.v1"]);
});

test("replace makes the browser the backup: what it lacks is removed, what it has is written", () => {
  const backup = createBackup(filled(), NOW, "1.34.1");
  const target = new MemoryStorage();
  target.map.set("huskypilot.completedTasks.imported.v1", done(["z"]));
  target.map.set("huskypilot.reminders.v1", JSON.stringify({ on: true }));
  target.map.set("other.app", "kept");

  assert.deepEqual(restoreBackup(target, backup, "replace"), { ok: true });

  assert.equal(target.getItem("huskypilot.completedTasks.imported.v1"), done(["a", "b"]));
  assert.equal(target.getItem("huskypilot.reminders.v1"), null);
  assert.equal(target.getItem("other.app"), "kept", "something that is not this app's was touched");
});

test("merge keeps what is here and adds what is missing", () => {
  const backup = createBackup(filled(), NOW, "1.34.1");
  const target = new MemoryStorage();
  target.map.set("huskypilot.completedTasks.imported.v1", done(["b", "c"]));
  target.map.set("huskypilot.customEvents.v1", JSON.stringify([{ id: "e1", title: "Studied (edited here)" }]));
  target.map.set("huskypilot.theme.v1", "light");

  assert.deepEqual(restoreBackup(target, backup, "merge"), { ok: true });

  assert.deepEqual(JSON.parse(target.getItem("huskypilot.completedTasks.imported.v1")!), ["b", "c", "a"]);
  assert.deepEqual(JSON.parse(target.getItem("huskypilot.customEvents.v1")!), [{ id: "e1", title: "Studied (edited here)" }]);
  assert.equal(target.getItem("huskypilot.theme.v1"), "light", "the setting here was overridden");
  assert.ok(target.getItem("huskypilot.grades.v1"), "a missing key was not added");
});

test("merging objects goes key by key, keeps lists free of repeats, and cannot be used to change the prototype", () => {
  const merged = mergeValues({ a: 1, list: [{ id: "x", n: 1 }], deep: { p: 1 } }, JSON.parse('{"a":2,"b":3,"list":[{"id":"x","n":9},{"id":"y"}],"deep":{"q":2},"__proto__":{"polluted":true}}'));
  assert.deepEqual(merged, { a: 1, b: 3, list: [{ id: "x", n: 1 }, { id: "y" }], deep: { p: 1, q: 2 } });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("merging a backup restores missing deadlines inside an existing calendar without overwriting edits", () => {
  const event = (id: string, title: string) => ({
    id, title, course: "STAT 1000Q", start: "2026-10-16T18:00:00.000Z",
    end: null, dateKey: null, allDay: false, location: null, kind: "deadline",
  });
  const key = "huskypilot.subscriptions.v1";
  const stored = (events: ReturnType<typeof event>[]) => JSON.stringify({
    version: 1,
    subscriptions: [{ id: "course-1", name: "Statistics", courseId: null, importedAt: NOW.toISOString(), events }],
  });
  const source = new MemoryStorage();
  source.setItem(key, stored([event("a", "Old title"), event("b", "Final exam")]));
  const target = new MemoryStorage();
  target.setItem(key, stored([event("a", "My corrected title")]));

  assert.deepEqual(restoreBackup(target, createBackup(source, NOW, "1.37.1"), "merge"), { ok: true });
  const restored = parseStoredSubscriptions(target.getItem(key)!);
  assert.deepEqual(restored?.[0].events.map(({ id, title }) => ({ id, title })), [
    { id: "a", title: "My corrected title" }, { id: "b", title: "Final exam" },
  ]);
});

test("merging lists adds each backup item once and keeps missing grade rows within the same course", () => {
  assert.deepEqual(mergeValues(["a"], ["b", "b", "a"]), ["a", "b"]);
  assert.deepEqual(
    mergeValues(
      [{ id: "course", items: [{ id: "quiz", earned: 9, possible: 10 }] }],
      [{ id: "course", items: [{ id: "quiz", earned: 8, possible: 10 }, { id: "exam", earned: 90, possible: 100 }] }],
    ),
    [{ id: "course", items: [{ id: "quiz", earned: 9, possible: 10 }, { id: "exam", earned: 90, possible: 100 }] }],
  );
});

test("AI merge preserves local permission and combines old and new backup results", () => {
  for (const localOn of [false, true]) {
    for (const backupOn of [false, true]) {
      for (const oldLocal of [false, true]) {
        const target = new MemoryStorage();
        const local = { ...EMPTY_PLAN_STATE, enabled: localOn, read: { local: "saved here", shared: "local wins" } };
        target.setItem(PLAN_STORAGE_KEY, JSON.stringify(oldLocal ? local : { enabled: localOn }));
        if (!oldLocal) target.setItem(PLAN_DATA_KEY, JSON.stringify({ ...local, enabled: undefined }));
        const permission = target.getItem(PLAN_STORAGE_KEY);
        const source = new MemoryStorage();
        const incoming = { ...EMPTY_PLAN_STATE, enabled: backupOn, read: { backup: "saved there", shared: "backup loses" } };
        source.setItem(PLAN_STORAGE_KEY, JSON.stringify(oldLocal ? { enabled: backupOn } : incoming));
        if (oldLocal) source.setItem(PLAN_DATA_KEY, JSON.stringify({ ...incoming, enabled: undefined }));
        const backup = createBackup(source, NOW, "1.39.1");
        assert.deepEqual(restoreBackup(target, backup, "merge"), { ok: true });
        assert.equal(restorePlanState(target).enabled, localOn);
        assert.equal(target.getItem(PLAN_STORAGE_KEY), permission, "merge rewrote the local permission key");
        assert.deepEqual(restorePlanState(target).read, { local: "saved here", shared: "local wins", backup: "saved there" });
        assert.equal(JSON.parse(target.getItem(PLAN_DATA_KEY)!).enabled, undefined);
        assert.deepEqual(restoreBackup(target, backup, "replace"), { ok: true });
        assert.equal(restorePlanState(target).enabled, backupOn);
        assert.deepEqual(restorePlanState(target).read, incoming.read);
      }
    }
  }
  const source = new MemoryStorage();
  saveSwitchedOn(source, { ...EMPTY_PLAN_STATE, enabled: true });
  const backup = createBackup(source, NOW, "1.39.1");
  assert.equal(JSON.parse(backup.data[PLAN_STORAGE_KEY]).enabled, true);
  const target = new MemoryStorage();
  assert.deepEqual(restoreBackup(target, backup, "merge"), { ok: true });
  assert.equal(target.getItem(PLAN_STORAGE_KEY), null);
  assert.equal(restorePlanState(target).enabled, false, "merging into a fresh browser granted permission");
  assert.deepEqual(restoreBackup(target, backup, "replace"), { ok: true });
  assert.equal(restorePlanState(target).enabled, true);
  assert.deepEqual(restoreBackup(target, createBackup(new MemoryStorage(), NOW, "1.39.1"), "replace"), { ok: true });
  assert.equal(restorePlanState(target).enabled, false);
});

for (const failLater of [false, true]) {
  test(`backup merge ${failLater ? "rollback" : "writes"} cannot undo an interleaved AI switch-off`, () => {
    const target = new MemoryStorage();
    target.setItem(PLAN_STORAGE_KEY, JSON.stringify({ ...EMPTY_PLAN_STATE, enabled: true }));
    const source = new MemoryStorage();
    saveSwitchedOn(source, { ...EMPTY_PLAN_STATE, enabled: true, read: { backup: "incoming" } });
    source.setItem("huskypilot.summaryModel.v1", "glm");
    const setItem = target.setItem.bind(target);
    const removeItem = target.removeItem.bind(target);
    let revoked = false;
    target.setItem = (key, value) => {
      assert.notEqual(key, PLAN_STORAGE_KEY, "merge wrote permission");
      if (key === PLAN_DATA_KEY) {
        revoked = true;
        setItem(PLAN_STORAGE_KEY, JSON.stringify({ enabled: false }));
      }
      if (key === "huskypilot.summaryModel.v1" && failLater) throw new Error("full");
      setItem(key, value);
    };
    target.removeItem = (key) => {
      assert.notEqual(key, PLAN_STORAGE_KEY, "merge rollback removed permission");
      removeItem(key);
    };
    assert.deepEqual(restoreBackup(target, createBackup(source, NOW, "1.39.1"), "merge"), { ok: !failLater });
    assert.equal(revoked, true);
    assert.equal(restorePlanState(target).enabled, false);
  });
}

test("a failed restore frees its new values before rolling back on a full disk", () => {
  const target = new MemoryStorage();
  const first = BACKUP_KEYS[0];
  const second = BACKUP_KEYS[1];
  const failKey = BACKUP_KEYS[2];
  target.setItem(first, "x".repeat(80));
  target.setItem(second, "y".repeat(20));
  const before = new Map(target.map);
  target.setItem = (key, value) => {
    const otherSize = [...target.map].reduce((sum, [k, v]) => sum + (k === key ? 0 : v.length), 0);
    if (key === failKey || otherSize + value.length > 100) throw new Error("QuotaExceededError");
    target.map.set(key, value);
  };
  const source = new MemoryStorage();
  source.setItem(first, "a".repeat(20));
  source.setItem(second, "b".repeat(80));
  source.setItem(failKey, "fail");

  assert.deepEqual(restoreBackup(target, createBackup(source, NOW, "1.37.1"), "replace"), { ok: false });
  assert.deepEqual(target.map, before);
});

test("blocked storage returns a restore failure without writing anything", () => {
  const target = new MemoryStorage();
  target.getItem = () => { throw new Error("SecurityError"); };
  assert.deepEqual(restoreBackup(target, createBackup(filled(), NOW, "1.37.1"), "merge"), { ok: false });
  assert.equal(target.map.size, 0);
});

test("a restore that fails part-way puts everything back", () => {
  const backup = createBackup(filled(), NOW, "1.34.1");
  const target = new MemoryStorage();
  target.map.set("huskypilot.completedTasks.imported.v1", done(["z"]));
  target.map.set("huskypilot.reminders.v1", JSON.stringify({ on: true }));
  const before = new Map(target.map);
  target.refuses = "huskypilot.grades.v1"; // the disk fills up part-way through

  assert.deepEqual(restoreBackup(target, backup, "replace"), { ok: false });

  assert.deepEqual(target.map, before);
});

test("every key the app stores is either in the backup or a retired one, so a new key cannot be forgotten", () => {
  const retired = new Set(["huskypilot.rememberSource.v1", "huskypilot.importedCalendar.v1", "huskypilot.calendarSource.v1"]);
  const found = new Set<string>();
  const walk = (dir: URL) => {
    for (const name of readdirSync(dir)) {
      const child = new URL(name + (statSync(new URL(name, dir)).isDirectory() ? "/" : ""), dir);
      if (name.endsWith("/")) continue;
      if (statSync(child).isDirectory()) walk(child);
      else if (/\.(ts|tsx)$/.test(name)) {
        for (const match of readFileSync(child, "utf8").matchAll(/"(huskypilot\.[A-Za-z0-9.]+)"/g)) found.add(match[1]);
      }
    }
  };
  walk(new URL("../src/", import.meta.url));
  assert.ok(found.size >= 25, "found too few keys: " + found.size);
  for (const key of found) assert.ok(BACKUP_KEYS.includes(key) || retired.has(key), `${key} is stored but not in the backup`);
  for (const key of BACKUP_KEYS) assert.ok(found.has(key), `${key} is in the backup but nothing stores it`);
});
