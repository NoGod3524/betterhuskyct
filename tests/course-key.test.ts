import assert from "node:assert/strict";
import { test } from "node:test";

import { courseKey, coursePath, courseSlug, isCourseTab, tabForPage } from "../src/lib/course-key.ts";

test("every source's spelling of a code meets in one key", () => {
  assert.equal(courseKey("cse  2050"), "CSE 2050");
  assert.equal(courseKey(" CSE 2050 "), "CSE 2050");
  assert.equal(courseKey("Math 1131Q"), "MATH 1131Q");
  assert.equal(courseKey(""), null);
  assert.equal(courseKey("   "), null);
  assert.equal(courseKey(null), null);
  assert.equal(courseKey(undefined), null);
});

test("a course's address is readable and its tab rides in the query", () => {
  assert.equal(courseSlug("CSE 2050"), "cse-2050");
  assert.equal(courseSlug("MATH 1131Q"), "math-1131q");
  assert.equal(courseSlug("???"), "course");
  assert.equal(coursePath("CSE 2050"), "/courses/cse-2050");
  assert.equal(coursePath("CSE 2050", "activity"), "/courses/cse-2050");
  assert.equal(coursePath("CSE 2050", "grades"), "/courses/cse-2050?tab=grades");
});

test("an old all-courses page maps to the tab that replaces it", () => {
  assert.equal(tabForPage("/announcements"), "announcements");
  assert.equal(tabForPage("/materials"), "materials");
  assert.equal(tabForPage("/grades"), "grades");
  assert.equal(tabForPage("/tasks"), "tasks");
  assert.equal(tabForPage("/calendar"), "tasks");
  assert.equal(tabForPage("/elsewhere"), "activity");
  assert.ok(isCourseTab("materials"));
  assert.ok(!isCourseTab("nonsense"));
  assert.ok(!isCourseTab(null));
});
