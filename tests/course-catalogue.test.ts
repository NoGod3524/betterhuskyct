import assert from "node:assert/strict";
import test from "node:test";

import {
  courseCatalogue,
  loadCourseCatalogue,
  isCourseCatalogueLoaded,
  courseCodeForTitle,
} from "../src/lib/course-catalogue.ts";

// The catalogue is fetched on demand, not bundled with the page: until it has
// loaded, every lookup finds nothing — the same answer as no match.
test("before it has loaded the catalogue finds nothing, and a failed lookup is not remembered", async () => {
  assert.equal(isCourseCatalogueLoaded(), false);
  assert.equal(courseCodeForTitle("Environmental Science"), null);
  assert.deepEqual(courseCatalogue(), {});

  await loadCourseCatalogue();

  assert.equal(isCourseCatalogueLoaded(), true);
  // The empty index built above did not stick.
  assert.equal(courseCodeForTitle("Environmental Science"), "NRE 1000E");
  // A second call is the same load, not another.
  await loadCourseCatalogue();
});

test("the catalogue knows the courses a HuskyCT feed names", () => {
  // These are the titles that actually appear in a real Blackboard export.
  assert.equal(courseCodeForTitle("Environmental Science"), "NRE 1000E");
  assert.equal(courseCatalogue()["NRE 1000E"], "Environmental Science");
  assert.equal(courseCatalogue()["STAT 1000Q"], "Introduction to Statistics I");
});

test("lookups ignore case and surrounding whitespace", () => {
  assert.equal(courseCodeForTitle("  environmental science  "), "NRE 1000E");
  assert.equal(courseCodeForTitle("ENVIRONMENTAL SCIENCE"), "NRE 1000E");
});

test("a title shared by several courses is never guessed", () => {
  // Cross-listed courses share a title constantly; picking one would be a lie.
  const codesOf = new Map<string, number>();
  for (const title of Object.values(courseCatalogue())) codesOf.set(title.toLowerCase(), (codesOf.get(title.toLowerCase()) ?? 0) + 1);
  const title = [...codesOf.entries()].find(([, count]) => count > 1)?.[0];
  assert.ok(title, "expected at least one cross-listed title");

  assert.equal(courseCodeForTitle(title), null);
});

test("unknown titles come back empty rather than throwing", () => {
  assert.equal(courseCodeForTitle("A Course That Does Not Exist"), null);
  assert.equal(courseCodeForTitle(""), null);
  assert.equal(courseCodeForTitle(null), null);
  assert.equal(courseCodeForTitle(undefined), null);
});

test("the catalogue is a plausible size and shape", () => {
  const codes = Object.keys(courseCatalogue());

  assert.ok(codes.length > 3000, `only ${codes.length} courses`);
  for (const code of codes.slice(0, 200)) {
    // Two to six letters, a space, then a number — some are short, like AELI 10.
    assert.match(code, /^[A-Z]{2,6} \d{2,4}[A-Z]?$/, `odd course code: ${code}`);
    assert.ok(courseCatalogue()[code].length > 1);
  }
});
