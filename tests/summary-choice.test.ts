import assert from "node:assert/strict";
import test from "node:test";

import {
  SUMMARY_CHOICE_KEY,
  SUMMARY_CHOICES,
  isSummaryChoice,
  restoreSummaryChoice,
  saveSummaryChoice,
} from "../src/lib/summary-choice.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const blocked = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("SecurityError");
  },
  removeItem() {
    throw new Error("SecurityError");
  },
};

test("there are four choices, and only those are accepted", () => {
  assert.deepEqual([...SUMMARY_CHOICES], ["auto", "glm", "gemini", "groq"]);
  for (const ok of SUMMARY_CHOICES) assert.equal(isSummaryChoice(ok), true);
  for (const bad of ["openai", "", "GLM", null, undefined, 1, {}]) assert.equal(isSummaryChoice(bad), false, String(bad));
});

test("with nothing saved, or something unknown, the choice is automatic", () => {
  const storage = new MemoryStorage();
  assert.equal(restoreSummaryChoice(storage), "auto");
  storage.setItem(SUMMARY_CHOICE_KEY, "claude");
  assert.equal(restoreSummaryChoice(storage), "auto");
});

test("a choice is kept, and going back to automatic keeps nothing", () => {
  const storage = new MemoryStorage();

  saveSummaryChoice(storage, "glm");
  assert.equal(storage.getItem(SUMMARY_CHOICE_KEY), "glm");
  assert.equal(restoreSummaryChoice(storage), "glm");

  saveSummaryChoice(storage, "gemini");
  assert.equal(restoreSummaryChoice(storage), "gemini");

  saveSummaryChoice(storage, "auto");
  assert.equal(storage.getItem(SUMMARY_CHOICE_KEY), null);
  assert.equal(restoreSummaryChoice(storage), "auto");
});

test("blocked storage neither throws nor changes the default", () => {
  assert.equal(restoreSummaryChoice(blocked), "auto");
  assert.doesNotThrow(() => saveSummaryChoice(blocked, "glm"));
});
