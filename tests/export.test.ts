import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { CSV_BOM, exportFileName, tasksToCsv } from "../src/lib/export.ts";

function makeTask(overrides: Partial<CalendarTask> & { id: string }): CalendarTask {
  return {
    title: overrides.id,
    course: null,
    start: "2026-09-08T14:00:00.000Z",
    dateKey: null,
    end: null,
    allDay: false,
    location: null,
    ...overrides,
  };
}

function lines(csv: string) {
  return csv.split("\r\n");
}

test("tasksToCsv writes a header row followed by one row per task", () => {
  const csv = tasksToCsv(
    [
      makeTask({ id: "a", title: "Problem Set 1", course: "CSE 2050" }),
      makeTask({ id: "b", title: "Reading response" }),
    ],
    new Set(),
  );

  assert.equal(
    lines(csv)[0],
    "Title,Course,Start,End,All day,Location,Completed",
  );
  assert.equal(lines(csv).length, 3);
  assert.ok(lines(csv)[1].startsWith("Problem Set 1,CSE 2050,"));
});

test("tasksToCsv marks completion and all-day flags from the task data", () => {
  const task = makeTask({ id: "a", allDay: true, dateKey: "2026-09-09", location: "ITE 127" });
  const csv = tasksToCsv([task], new Set(["a"]));
  const row = lines(csv)[1];

  assert.ok(row.endsWith(",yes,ITE 127,yes"));
});

test("tasksToCsv leaves missing optional fields empty", () => {
  const csv = tasksToCsv([makeTask({ id: "a", title: "Solo" })], new Set());
  const cells = lines(csv)[1].split(",");

  assert.equal(cells[0], "Solo");
  assert.equal(cells[1], "");
  assert.equal(cells[3], "");
  assert.equal(cells[5], "");
  assert.equal(cells[6], "no");
});

test("tasksToCsv quotes cells containing commas, quotes or newlines", () => {
  const csv = tasksToCsv(
    [
      makeTask({ id: "a", title: "Essay, draft 2" }),
      makeTask({ id: "b", title: 'Read "Chapter 3"' }),
      makeTask({ id: "c", title: "Line one\nLine two" }),
    ],
    new Set(),
  );

  assert.ok(csv.includes('"Essay, draft 2"'));
  assert.ok(csv.includes('"Read ""Chapter 3"""'));
  assert.ok(csv.includes('"Line one\nLine two"'));
});

test("tasksToCsv returns just the header for an empty task list", () => {
  const csv = tasksToCsv([], new Set());

  assert.equal(lines(csv).length, 1);
  assert.equal(lines(csv)[0], "Title,Course,Start,End,All day,Location,Completed");
});

test("exportFileName is zero-padded and sortable", () => {
  assert.equal(
    exportFileName(new Date(2026, 8, 8)),
    "huskypilot-tasks-2026-09-08.csv",
  );
  assert.equal(
    exportFileName(new Date(2026, 11, 31)),
    "huskypilot-tasks-2026-12-31.csv",
  );
});

test("CSV_BOM is a real byte-order mark so Excel reads UTF-8", () => {
  assert.equal(CSV_BOM.codePointAt(0), 0xfeff);
});

test("a cell that starts like a formula is kept as text", async () => {
  const { csvCell } = await import("../src/lib/export.ts");
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+SUM(A1)"), "'+SUM(A1)");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("-2+3"), "'-2+3");
  assert.equal(csvCell('=HYPERLINK("x","y")'), `"'=HYPERLINK(""x"",""y"")"`);
  assert.equal(csvCell("Quiz 1 = easy"), "Quiz 1 = easy");
});
