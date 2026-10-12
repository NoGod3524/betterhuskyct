import assert from "node:assert/strict";
import test from "node:test";

import { HELPER_SOURCE_URL } from "../src/lib/helper.ts";

/** The page hands this address out, so a typo is a link that 404s. */
test("the source link points at main", () => {
  assert.equal(HELPER_SOURCE_URL, "https://github.com/NoGod3524/betterhuskyct/tree/main/tools/huskyct-helper");
});
