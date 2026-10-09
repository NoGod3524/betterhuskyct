import assert from "node:assert/strict";
import test from "node:test";

import { neededOnRest } from "../src/lib/grade-target.ts";

test("the rest must make up what the graded work leaves short of the target", () => {
  // 80% on the 70% already graded, wanting 90: the other 30% would need 113%, and full marks end at 86.
  assert.deepEqual(neededOnRest(80, 30, 90), { kind: "out", best: 86 });
  // 90% so far, a 30% final, wanting 85: (8500 - 6300) / 30 = 73.3
  assert.deepEqual(neededOnRest(90, 30, 85), { kind: "needs", percent: 73.3 });
});

test("a target already met stays safe, and an exact one needs the exact percent", () => {
  assert.deepEqual(neededOnRest(100, 20, 70), { kind: "safe" });
  assert.deepEqual(neededOnRest(80, 50, 90), { kind: "needs", percent: 100 });
  assert.deepEqual(neededOnRest(90, 50, 45), { kind: "safe" });
});

test("with nothing to come, or an input that is not a percent, there is no answer", () => {
  assert.deepEqual(neededOnRest(80, 0, 90), { kind: "none" });
  assert.deepEqual(neededOnRest(80, 30, NaN), { kind: "none" });
  assert.deepEqual(neededOnRest(80, 130, 90), { kind: "none" });
  assert.deepEqual(neededOnRest(-1, 30, 90), { kind: "none" });
});
