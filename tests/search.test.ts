import assert from "node:assert/strict";
import test from "node:test";

import type { Announcement } from "../src/lib/announcements.ts";
import type { CalendarTask } from "../src/lib/calendar-types.ts";
import type { GradesSnapshot } from "../src/lib/grades.ts";
import type { MaterialsIndex } from "../src/lib/materials.ts";
import { searchAll, type SearchSources } from "../src/lib/search.ts";

const task = (id: string, title: string, course: string | null = null): CalendarTask => ({
  id, title, course, start: "2026-10-09T14:00:00.000Z", dateKey: null, end: null, allDay: false, location: null,
});
const announcement = (id: string, title: string, body: string, courseCode: string | null = null): Announcement => ({
  id, courseId: null, courseCode, title, body, posted: null, announced: "2026-10-01T00:00:00.000Z",
});
const materials: MaterialsIndex = {
  version: 1,
  term: null,
  updatedAt: "2026-10-01T00:00:00.000Z",
  courses: [
    {
      id: "_1_1",
      code: "STAT 1000Q",
      files: [{ key: "k1", path: ["Week 3", "Slides"], title: "Lecture 3 - Sampling.pdf" }],
      links: [{ path: [], title: "Recorded lecture", url: "https://example.com/v", kind: "video" }],
      tools: [],
    },
  ],
};
const grades: GradesSnapshot = {
  version: 1,
  term: null,
  takenAt: "2026-10-01T00:00:00.000Z",
  courses: [{ id: "_1_1", code: "STAT 1000Q", items: [{ id: "_9_1", title: "Quiz 2", status: null, earned: 8, possible: 10, label: null }] }],
};
const sources: SearchSources = {
  tasks: [task("t1", "Problem set 4", "STAT 1000Q"), task("t2", "Essay draft", "ENGL 1007")],
  announcements: [announcement("a1", "Exam logistics", "The midterm covers sampling and problem set 4."), announcement("a2", "Office hours", "Moved to Friday")],
  materials,
  grades,
};

test("an empty query finds nothing", () => {
  assert.deepEqual(searchAll("   ", sources), []);
});

test("every word has to match, in any order, ignoring case", () => {
  assert.deepEqual(searchAll("SET problem", sources).map((r) => r.id), ["t1", "a1"]);
  assert.deepEqual(searchAll("essay quiz", sources), []);
});

test("results come grouped in a fixed order, and a title match comes before a match in the text", () => {
  const found = searchAll("sampling", sources);
  assert.deepEqual(found.map((r) => r.kind), ["announcement", "material"]);
  const both = searchAll("problem", { ...sources, announcements: [announcement("a0", "Reminder", "problem sets are due"), announcement("a9", "Problem 4 hints", "")] });
  assert.deepEqual(both.filter((r) => r.kind === "announcement").map((r) => r.id), ["a9", "a0"]);
});

test("a course, a folder and a link are searched too, and each result points at its page", () => {
  assert.deepEqual(searchAll("week 3", sources).map((r) => [r.kind, r.href]), [["material", "/materials"]]);
  assert.deepEqual(searchAll("recorded", sources).map((r) => r.title), ["Recorded lecture"]);
  assert.deepEqual(searchAll("quiz", sources).map((r) => [r.kind, r.href]), [["grade", "/grades#grades-_1_1"]]);
  assert.deepEqual(searchAll("stat 1000q", sources).map((r) => r.kind), ["task", "material", "material", "grade"]);
});

test("no more than the limit of each kind", () => {
  const many = { ...sources, tasks: Array.from({ length: 20 }, (_, i) => task("x" + i, "Reading " + i)) };
  assert.equal(searchAll("reading", many, 5).length, 5);
});
