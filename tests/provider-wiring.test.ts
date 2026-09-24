import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The provider's wiring, checked where it can be without a DOM.
 *
 * The logic the provider runs lives in `src/lib` and is tested there — the
 * clock, the import request, what accepting a sync link does. What those tests
 * cannot see is whether the provider still *calls* them: the clock froze for
 * weeks because nothing subscribed to it at all, and a unit test of a function
 * nobody calls passes forever.
 *
 * `node --experimental-strip-types` does not transform JSX, so the provider
 * cannot be imported here. Its source can be read, which is how
 * `huskyct-helper.test.ts` already guards the userscript's call shapes.
 * Comments are stripped first, so an explanation that names a function does
 * not count as a call to it.
 */
const SOURCE = readFileSync(new URL("../src/components/calendar-provider.tsx", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("the provider subscribes to the clock in an effect, with its cleanup", () => {
  assert.match(
    SOURCE,
    /useEffect\(\(\)\s*=>\s*watchClock\(/,
    "nothing keeps `now` moving: the clock is not subscribed in an effect",
  );
});

test("every import goes through the tested client, not a fetch of its own", () => {
  assert.match(SOURCE, /requestCalendarImport\(/);
  assert.doesNotMatch(
    SOURCE,
    /fetch\(\s*["'`]\/api\/calendar\/import/,
    "the provider fetches the import endpoint itself, bypassing the error handling",
  );
});

test("accepting a sync link goes through planSyncApply", () => {
  assert.match(SOURCE, /planSyncApply\(/);
  assert.doesNotMatch(
    SOURCE,
    /mergeSyncPayload\(/,
    "the provider merges a sync link itself, so which ticks go in is decided untested",
  );
});
