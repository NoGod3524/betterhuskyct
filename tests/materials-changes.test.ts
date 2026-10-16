import assert from "node:assert/strict";
import { test } from "node:test";

import { CHANGES_KEY, markChangesRead, parseChanges, saveChanges, withChangesLock } from "../src/lib/changes.ts";
import { flushMaterialChanges, recordMaterialChanges } from "../src/lib/materials-changes.ts";
import { type MaterialsIndex } from "../src/lib/materials.ts";

const NOW = new Date("2026-10-16T12:00:00.000Z");
const index = (files: string[], id = "_1_1", code = "MATH 1131Q"): MaterialsIndex => ({
  version: 1, term: "Fall 2026", updatedAt: NOW.toISOString(),
  courses: [{ id, code, files: files.map((key) => ({ key: `folder:${key}`, title: key, path: [] })), links: [], tools: [] }],
});

function queuedBrowserLocks() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  let queue = Promise.resolve();
  const request = (name: string, work: () => unknown) => {
    assert.equal(name, CHANGES_KEY);
    const result = queue.then(work);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { navigator: { locks: { request } } } });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

test("each materials course has its own baseline, including an empty first directory", () => {
  const empty = index([]);
  const first = recordMaterialChanges(null, empty, null, NOW);
  assert.deepEqual(first.pending, []);
  const second = recordMaterialChanges(empty, index(["Notes.pdf"]), first, NOW);
  assert.equal(second.pending.length, 1);
  assert.deepEqual(second.pending[0].ref, { page: "/materials", id: "folder:Notes.pdf" });
  assert.equal(second.pending[0].title, "Notes.pdf");
  const both: MaterialsIndex = { ...index(["Notes.pdf"]), courses: [...index(["Notes.pdf"]).courses, ...index(["Syllabus.pdf"], "_2_1").courses] };
  const third = recordMaterialChanges(index(["Notes.pdf"]), both, second, NOW);
  assert.equal(third.pending.length, 1, "a new course with the same code is its own baseline");
});

test("an existing directory is the upgrade baseline and only its new files become changes", () => {
  const state = recordMaterialChanges(index(["Old.pdf"]), index(["Old.pdf", "New.pdf"]), null, NOW);
  assert.deepEqual(state.pending.map((entry) => entry.title), ["New.pdf"]);
  assert.equal(state.pending[0].courseCode, "MATH 1131Q");
});

test("duplicate and partial directories cannot repeat notices, even after a full removal", () => {
  const old = index(["Old.pdf"]), incoming = index(["New.pdf"]);
  let state = recordMaterialChanges(old, incoming, null, NOW);
  const originalId = state.pending[0].id;
  state = recordMaterialChanges(incoming, incoming, state, NOW);
  assert.deepEqual(state.pending.map((entry) => entry.id), [originalId]);
  state = { ...state, pending: [] }; // The app acknowledged the first notice.
  state = recordMaterialChanges(incoming, index([]), state, NOW);
  state = recordMaterialChanges(index([]), index(["New.pdf", "Old.pdf"]), state, NOW);
  assert.deepEqual(state.pending, [], "already discovered files became new again");
});

test("a refused change-log write leaves the outbox for a successful retry", async () => {
  const state = recordMaterialChanges(index([]), index(["New.pdf"]), null, NOW);
  const data = new Map<string, string>();
  let blocked = true;
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { if (blocked) throw new Error("full"); data.set(key, value); },
  };
  let acknowledged: readonly string[] = [];
  let notices = 0;
  const ack = async (ids: readonly string[]) => { acknowledged = ids; };
  await assert.rejects(flushMaterialChanges(storage, state.pending, ack, () => notices++, NOW), /full/);
  assert.deepEqual(acknowledged, []);
  assert.equal(notices, 0);
  blocked = false;
  await flushMaterialChanges(storage, state.pending, ack, () => notices++, NOW);
  assert.deepEqual(acknowledged, state.pending.map((entry) => entry.id));
  assert.equal(parseChanges(data.get(CHANGES_KEY)!, NOW).entries.length, 1);
  assert.equal(notices, 1);
});

test("outbox replay after an interrupted acknowledgement keeps the latest read decisions", async () => {
  const state = recordMaterialChanges(index([]), index(["New.pdf"]), null, NOW);
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  await assert.rejects(flushMaterialChanges(storage, state.pending, async () => { throw new Error("closed"); }, () => {}, NOW), /closed/);
  const seen = markChangesRead(parseChanges(data.get(CHANGES_KEY)!, NOW));
  saveChanges(storage, seen);
  let acknowledged = false;
  await flushMaterialChanges(storage, state.pending, async () => { acknowledged = true; }, () => {}, NOW);
  const saved = parseChanges(data.get(CHANGES_KEY)!, NOW);
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].read, true);
  assert.equal(acknowledged, true);
});

test("unreadable change storage cannot acknowledge and discard pending file notices", async () => {
  const state = recordMaterialChanges(index([]), index(["New.pdf"]), null, NOW);
  let acknowledged = false;
  await assert.rejects(flushMaterialChanges({
    getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("must not write"); },
  }, state.pending, async () => { acknowledged = true; }, () => {}, NOW), /blocked/);
  assert.equal(acknowledged, false);
});

test("two outbox deliveries using the shared lock preserve both notices", async () => {
  const restore = queuedBrowserLocks();
  try {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const a = recordMaterialChanges(index([]), index(["A.pdf"]), null, NOW);
    const b = recordMaterialChanges(index([]), index(["B.pdf"]), null, NOW);
    await Promise.all([
      flushMaterialChanges(storage, async () => a.pending, async () => {}, () => {}, NOW),
      flushMaterialChanges(storage, async () => b.pending, async () => {}, () => {}, NOW),
    ]);
    assert.deepEqual(new Set(parseChanges(data.get(CHANGES_KEY)!, NOW).entries.map((entry) => entry.title)), new Set(["A.pdf", "B.pdf"]));
  } finally {
    restore();
  }
});

test("an outbox queued behind clearing materials rereads pending work after getting the lock", async () => {
  const restore = queuedBrowserLocks();
  try {
    let pending = recordMaterialChanges(index([]), index(["Cleared.pdf"]), null, NOW).pending;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const clearing = withChangesLock(async () => { entered(); await gate; pending = []; });
    await started;
    let reads = 0;
    let acknowledged = false;
    const delivery = flushMaterialChanges({
      getItem: () => { throw new Error("there is no notice to save"); },
      setItem: () => { throw new Error("cleared file must not return"); },
    }, async () => { reads++; return pending; }, async () => { acknowledged = true; }, () => {}, NOW);
    assert.equal(reads, 0, "the old pending list was read before the clearing tab finished");
    release();
    await Promise.all([clearing, delivery]);
    assert.equal(reads, 1);
    assert.equal(acknowledged, false);
  } finally {
    restore();
  }
});
