import assert from "node:assert/strict";
import test from "node:test";
import { writeStorageBatch } from "../src/lib/storage-batch.ts";

test("a staged failure writes nothing, and only touched keys are read or written", () => {
  const values = new Map([["a", "old"], ["untouched", "keep"]]);
  const reads: string[] = [];
  const storage = {
    getItem(key: string) { reads.push(key); return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
  assert.throws(() => writeStorageBatch(storage, (staged) => {
    staged.setItem("a", "new");
    throw new Error("Cannot prepare the second value");
  }));
  assert.deepEqual([...values], [["a", "old"], ["untouched", "keep"]]);
  assert.deepEqual(reads, []);
  writeStorageBatch(storage, (staged) => { staged.removeItem("a"); staged.setItem("b", "new"); });
  assert.deepEqual(reads, ["a", "b"]);
  assert.deepEqual([...values], [["untouched", "keep"], ["b", "new"]]);
});

test("failed writes roll back and unchanged values do not consume a write", () => {
  const values = new Map([["a", "old"], ["unchanged", "same"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) {
      if (key === "fail" || key === "unchanged") throw new Error("QuotaExceededError");
      values.set(key, value);
    },
    removeItem(key: string) { values.delete(key); },
  };
  assert.throws(() => writeStorageBatch(storage, (staged) => {
    staged.setItem("unchanged", "same");
    staged.setItem("a", "new");
    staged.setItem("fail", "new");
  }), /QuotaExceededError/);
  assert.deepEqual(Object.fromEntries(values), { a: "old", unchanged: "same" });
});
