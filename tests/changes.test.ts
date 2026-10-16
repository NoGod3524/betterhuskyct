import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANGES_KEY, CHANGES_RETENTION_DAYS, MAX_CHANGES, createChangeId, markChangesRead,
  mergeChangeStores, parseChanges, recordChanges, restoreChanges, saveChanges, withChangesLock,
  type ChangeEntry, type ChangesStore,
} from "../src/lib/changes.ts";

const NOW = new Date("2026-10-16T12:00:00.000Z");
const empty = (): ChangesStore => ({ version: 1, entries: [], baselines: [] });
const entry = (id: string, overrides: Partial<ChangeEntry> = {}): ChangeEntry => ({
  id, at: NOW.toISOString(), kind: "grade", courseCode: "STAT 1000Q", title: "Quiz 1",
  detail: { from: "8 / 10", to: "9 / 10" }, ref: { page: "/grades", id: "_1_1" }, read: false, ...overrides,
});

test("changes reject damaged, oversized and future-version storage, while preserving usable rows", () => {
  for (const raw of [null, "", "broken", "[]", "null", '{"version":2,"entries":[],"baselines":[]}', "x".repeat(8 * 1024 * 1024 + 1)]) {
    assert.deepEqual(parseChanges(raw, NOW), empty());
  }
  const bad: unknown[] = [
    null, { ...entry("x"), id: "" }, { ...entry("x"), kind: "other" },
    { ...entry("x"), at: "Friday" }, { ...entry("x"), at: "2026-10-16" },
    { ...entry("x"), read: "false" }, { ...entry("x"), title: " " },
    { ...entry("x"), courseCode: 5 }, { ...entry("x"), detail: { from: 0 } },
    { ...entry("x"), detail: { text: "a".repeat(1201) } },
    { ...entry("x"), ref: { page: "https://evil.example" } },
    { ...entry("x"), ref: { page: "/grades", id: 10 } },
    { ...entry("x"), id: "a".repeat(4097) },
  ];
  const parsed = parseChanges(JSON.stringify({ version: 1, entries: [...bad, { ...entry("ok"), at: "2026-10-16T08:00:00-04:00", ignored: "not stored" }], baselines: [null, "", 5, "grades", "grades"] }), NOW);
  assert.deepEqual(parsed, { version: 1, entries: [entry("ok")], baselines: ["grades"] });
});

test("an empty first reading still persists its baseline without making up changes", () => {
  const store = recordChanges(empty(), [], NOW, ["grades", "announcements"]);
  assert.deepEqual(store, { version: 1, entries: [], baselines: ["grades", "announcements"] });
  assert.deepEqual(parseChanges(JSON.stringify(store), NOW), store);
  assert.deepEqual(recordChanges(store, [], NOW, ["grades"]), store);
});

test("source revisions distinguish recurring transitions and tuple parts cannot collide", () => {
  const first = createChangeId("grade", "course", "item", "revision-1", "8", "9");
  const reverse = createChangeId("grade", "course", "item", "revision-2", "9", "8");
  const repeated = createChangeId("grade", "course", "item", "revision-3", "8", "9");
  assert.notEqual(first, repeated);
  assert.notEqual(createChangeId("grade", "a|b", "c"), createChangeId("grade", "a", "b|c"));
  assert.notEqual(createChangeId("grade", "x"), createChangeId("file-new", "x"));
  const store = recordChanges(empty(), [entry(first), entry(reverse), entry(repeated), entry(first)], NOW);
  assert.equal(store.entries.length, 3);
  assert.deepEqual(new Set(store.entries.map(({ id }) => id)), new Set([first, reverse, repeated]));
});

test("duplicate events preserve history and read decisions through repeated imports and backup merges", () => {
  const original = recordChanges(empty(), [entry("a"), entry("b")], NOW, ["grades"]);
  const read = markChangesRead(original, ["a"]);
  assert.equal(original.entries.find(({ id }) => id === "a")?.read, false, "marking read mutated its input");
  const merged = recordChanges(read, [entry("a", { title: "stale title" }), entry("b", { read: true })], NOW);
  assert.deepEqual(merged.entries, [entry("a", { read: true }), entry("b", { read: true })]);
  const incoming = recordChanges(empty(), [entry("a"), entry("c", { read: true })], NOW, ["files"]);
  const restored = mergeChangeStores(merged, incoming, NOW);
  assert.deepEqual(restored.baselines, ["grades", "files"]);
  assert.deepEqual(restored.entries.map(({ id, read }) => [id, read]), [["a", true], ["b", true], ["c", true]]);
  assert.deepEqual(markChangesRead(original, []).entries, original.entries);
  assert.ok(markChangesRead(original).entries.every(({ read }) => read));
});

test("record and merge retain the latest 500 events within 30 days, including the boundary", () => {
  const cutoff = new Date(NOW.valueOf() - CHANGES_RETENTION_DAYS * 86_400_000).toISOString();
  const old = entry("expired", { at: new Date(Date.parse(cutoff) - 1).toISOString() });
  const boundary = entry("boundary", { at: cutoff });
  const windowed = recordChanges(empty(), [old, boundary, entry("new")], NOW);
  assert.deepEqual(windowed.entries.map(({ id }) => id), ["new", "boundary"]);
  assert.deepEqual(parseChanges(JSON.stringify({ version: 1, entries: [old, boundary], baselines: [] }), NOW).entries, [boundary]);
  assert.deepEqual(mergeChangeStores(empty(), { version: 1, entries: [old, boundary], baselines: [] }, NOW).entries, [boundary]);
  const many = Array.from({ length: MAX_CHANGES + 5 }, (_, index) => entry(String(index), { at: new Date(NOW.valueOf() - index * 1000).toISOString() }));
  const capped = recordChanges(empty(), [...many].reverse(), NOW);
  assert.equal(capped.entries.length, MAX_CHANGES);
  assert.equal(capped.entries[0].id, "0");
  assert.equal(capped.entries.at(-1)?.id, String(MAX_CHANGES - 1));
  assert.equal(parseChanges(JSON.stringify({ version: 1, entries: many, baselines: [] }), NOW).entries.length, MAX_CHANGES);
});

test("restoring blocked storage is safe, and saving reports failures so an outbox cannot acknowledge them", () => {
  assert.deepEqual(restoreChanges({ getItem: () => { throw new Error("blocked"); } }), empty());
  const storage = new Map<string, string>();
  const now = new Date();
  const store = recordChanges(empty(), [entry("a", { at: now.toISOString() })], now);
  saveChanges({ setItem: (key, value) => storage.set(key, value) }, store);
  assert.ok(storage.has(CHANGES_KEY));
  assert.deepEqual(restoreChanges({ getItem: (key) => storage.get(key) ?? null }), store);
  assert.throws(() => saveChanges({ setItem: () => { throw new Error("full"); } }, store), /full/);
});

test("without a browser lock manager, Changes work keeps its synchronous return and errors", () => {
  assert.equal(withChangesLock(() => 7), 7);
  assert.throws(() => withChangesLock(() => { throw new Error("full"); }), /full/);
});

test("browser lock requests serialize competing writes and release after a failed writer", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  let queue = Promise.resolve();
  const request = (name: string, work: () => unknown) => {
    assert.equal(name, CHANGES_KEY);
    const result = queue.then(work);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { navigator: { locks: { request } } } });
  try {
    const order: string[] = [];
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = withChangesLock(async () => { order.push("first"); entered(); await gate; order.push("saved"); });
    await started;
    const second = withChangesLock(() => { order.push("second"); return 9; });
    assert.deepEqual(order, ["first"]);
    release();
    assert.deepEqual(await Promise.all([first, second]), [undefined, 9]);
    assert.deepEqual(order, ["first", "saved", "second"]);
    await assert.rejects(Promise.resolve(withChangesLock(() => { throw new Error("failed writer"); })), /failed writer/);
    assert.equal(await withChangesLock(() => 11), 11);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
