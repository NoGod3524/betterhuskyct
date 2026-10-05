import assert from "node:assert/strict";
import test from "node:test";

import { gradesFileName, gradesToCsv } from "../src/lib/grades-export.ts";
import type { GradesSnapshot } from "../src/lib/grades.ts";

const SNAPSHOT: GradesSnapshot = {
  version: 1,
  term: "Fall 2026",
  takenAt: "2026-10-05T14:00:00.000Z",
  courses: [
    {
      id: "_203765_1",
      code: "MATH 1070Q",
      items: [
        { id: "_1_1", title: "Take-home Quiz 1", status: "Graded", earned: 95, possible: 100, label: null },
        { id: "_2_1", title: "Exam 1", status: "Submitted", earned: null, possible: null, label: "Not graded" },
        { id: "_3_1", title: "Homework 4.1, part \"A\"", status: null, earned: 81.3, possible: 100, label: null },
        { id: "_4_1", title: "Practice", status: "Attempt 2 started", earned: 0, possible: 0, label: null },
      ],
    },
    { id: "_198430_1", code: null, items: [{ id: "_5_1", title: "Quiz", status: null, earned: 1, possible: 3, label: null }] },
    { id: "_201463_1", code: "SOCI 1501", items: [] },
  ],
};

const rows = (csv: string) => csv.split("\r\n");

test("one row per item, in the order HuskyCT lists them, under a header that stays in English", () => {
  const lines = rows(gradesToCsv(SNAPSHOT));

  assert.equal(lines[0], "Course,Term,Item,Status,Earned,Possible,Percent,Result,Read at");
  assert.equal(lines.length, 1 + 5, "a course with no items added a row, or an item was lost");
  assert.equal(lines[1], "MATH 1070Q,Fall 2026,Take-home Quiz 1,Graded,95,100,95,,2026-10-05T14:00:00.000Z");
  assert.equal(lines[2], "MATH 1070Q,Fall 2026,Exam 1,Submitted,,,,Not graded,2026-10-05T14:00:00.000Z");
});

test("a title with a comma or a quote is quoted, so it stays one cell", () => {
  const lines = rows(gradesToCsv(SNAPSHOT));

  assert.equal(lines[3], 'MATH 1070Q,Fall 2026,"Homework 4.1, part ""A""",,81.3,100,81.3,,2026-10-05T14:00:00.000Z');
});

test("the percent is the item's own score over its points, to a tenth, and blank when nothing counts", () => {
  const lines = rows(gradesToCsv(SNAPSHOT));

  assert.equal(lines[5].split(",")[6], "33.3", "1 of 3");
  assert.equal(lines[4].split(",")[6], "", "a 0 of 0 practice item has no percent");
  assert.equal(lines[2].split(",")[6], "", "an item with no score has none");
});

test("a course with no code is named by its id, so its rows can still be told apart", () => {
  assert.equal(rows(gradesToCsv(SNAPSHOT))[5].split(",")[0], "_198430_1");
});

test("text a spreadsheet would run as a formula is written as text", () => {
  const csv = gradesToCsv({
    ...SNAPSHOT,
    courses: [{ id: "_1_1", code: "X 1", items: [{ id: "_9_1", title: '=HYPERLINK("http://evil.example")', status: "+cmd", earned: null, possible: null, label: "@sum" }] }],
  });
  const line = rows(csv)[1];

  assert.ok(line.includes(`'=HYPERLINK`), line);
  assert.ok(line.includes("'+cmd") && line.includes("'@sum"), line);
  assert.ok(!/(^|,)[=+@]/.test(line.replace(/"[^"]*"/g, '""')), "a cell still starts with a formula character: " + line);
});

test("an empty gradebook is the header alone", () => {
  assert.equal(gradesToCsv({ ...SNAPSHOT, courses: [] }), "Course,Term,Item,Status,Earned,Possible,Percent,Result,Read at");
});

test("the file name is stable and sortable", () => {
  assert.equal(gradesFileName(new Date(2026, 9, 5)), "huskypilot-grades-2026-10-05.csv");
  assert.equal(gradesFileName(new Date(2026, 0, 9)), "huskypilot-grades-2026-01-09.csv");
});
