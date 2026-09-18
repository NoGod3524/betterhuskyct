import assert from "node:assert/strict";
import test from "node:test";

import {
  COURSE_CATALOGUE,
  catalogueTitleForCode,
  courseCodeForTitle,
  courseCodesForTitle,
} from "../src/lib/course-catalogue.ts";

test("the catalogue knows the courses a HuskyCT feed names", () => {
  // These are the titles that actually appear in a real Blackboard export.
  assert.equal(courseCodeForTitle("Environmental Science"), "NRE 1000E");
  assert.equal(catalogueTitleForCode("NRE 1000E"), "Environmental Science");
  assert.equal(catalogueTitleForCode("STAT 1000Q"), "Introduction to Statistics I");
});

test("lookups ignore case and surrounding whitespace", () => {
  assert.equal(courseCodeForTitle("  environmental science  "), "NRE 1000E");
  assert.equal(courseCodeForTitle("ENVIRONMENTAL SCIENCE"), "NRE 1000E");
  assert.equal(catalogueTitleForCode(" nre 1000e "), "Environmental Science");
  assert.equal(catalogueTitleForCode("NRE   1000E"), "Environmental Science");
});

test("a title shared by several courses is never guessed", () => {
  // Cross-listed courses share a title constantly; picking one would be a lie.
  const crossListed = Object.entries(COURSE_CATALOGUE).find(
    ([, title]) => courseCodesForTitle(title).length > 1,
  );
  assert.ok(crossListed, "expected at least one cross-listed title");
  const [, title] = crossListed;

  assert.equal(courseCodeForTitle(title), null);
  assert.ok(courseCodesForTitle(title).length > 1);
});

test("unknown titles and codes come back empty rather than throwing", () => {
  assert.equal(courseCodeForTitle("A Course That Does Not Exist"), null);
  assert.equal(courseCodeForTitle(""), null);
  assert.equal(courseCodeForTitle(null), null);
  assert.equal(courseCodeForTitle(undefined), null);
  assert.deepEqual(courseCodesForTitle(""), []);
  assert.equal(catalogueTitleForCode("ZZZZ 9999"), null);
  assert.equal(catalogueTitleForCode(null), null);
});

test("the catalogue is a plausible size and shape", () => {
  const codes = Object.keys(COURSE_CATALOGUE);

  assert.ok(codes.length > 3000, `only ${codes.length} courses`);
  for (const code of codes.slice(0, 200)) {
    // Two to six letters, a space, then a number — some are short, like AELI 10.
    assert.match(code, /^[A-Z]{2,6} \d{2,4}[A-Z]?$/, `odd course code: ${code}`);
    assert.ok(COURSE_CATALOGUE[code].length > 1);
  }
});
