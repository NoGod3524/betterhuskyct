import assert from "node:assert/strict";
import test from "node:test";

import { extractCandidates } from "../src/lib/announcement-actions.ts";
import { applyFilters, huskyctCourseIds, isFiltering, NO_FILTERS, originalUrl } from "../src/lib/announcement-filters.ts";
import { isKeySentence, mentionsAttachment, segmentsOf } from "../src/lib/announcement-text.ts";
import { draftFrom, todoFrom } from "../src/lib/announcement-todo.ts";
import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { buildOverview } from "../src/lib/task-overview.ts";

// --- the to-do a form makes ----------------------------------------------------------------------------

const SOURCE = { title: "Quiz 3 and Homework 4", courseCode: "STAT 1000Q" };

test("a day makes an event for that day, with a time only when one is given, so no end of day is made up", () => {
  const dated = todoFrom({ title: " Quiz 3 ", date: "2026-10-09", time: "" }, SOURCE);
  assert.equal(dated.kind, "event");
  if (dated.kind !== "event") return;
  assert.equal(dated.input.title, "Quiz 3");
  assert.equal(dated.input.allDay, true);
  const start = new Date(dated.input.start);
  assert.deepEqual([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()], [2026, 9, 9, 0, 0]);
  assert.equal(dated.input.course, "STAT 1000Q");
  assert.match(dated.input.note ?? "", /Quiz 3 and Homework 4/);

  const timed = todoFrom({ title: "Quiz 3", date: "2026-10-09", time: "23:59" }, SOURCE);
  assert.equal(timed.kind === "event" && timed.input.allDay, false);
  assert.equal(timed.kind === "event" && new Date(timed.input.start).getHours(), 23);
});

test("no day makes a to-do with none, and a form that is not right is refused rather than corrected", () => {
  const undated = todoFrom({ title: "Homework 5", date: "", time: "" }, SOURCE);
  assert.deepEqual(undated.kind === "undated" && undated.todo.title, "Homework 5");
  assert.deepEqual(todoFrom({ title: "  ", date: "2026-10-09", time: "" }, SOURCE), { kind: "invalid", problem: "title" });
  assert.deepEqual(todoFrom({ title: "x", date: "2026-02-30", time: "" }, SOURCE), { kind: "invalid", problem: "date" });
  assert.deepEqual(todoFrom({ title: "x", date: "10/09/2026", time: "" }, SOURCE), { kind: "invalid", problem: "date" });
  assert.deepEqual(todoFrom({ title: "x", date: "2026-10-09", time: "25:00" }, SOURCE), { kind: "invalid", problem: "time" });
});

test("the form starts from what the rules settled and nothing they did not", () => {
  const posted = { id: "a", title: "T", posted: "10/5/26, 4:00 PM" };
  const [settled] = extractCandidates({ ...posted, body: "Quiz 3 is due October 9 at 11:59 PM." });
  assert.deepEqual(draftFrom(settled), { title: "Quiz 3", date: "2026-10-09", time: "23:59" });
  const [unsettled] = extractCandidates({ ...posted, body: "Paper is due 3/4." });
  assert.deepEqual(draftFrom(unsettled), { title: "Paper", date: "", time: "" });
});

// --- the text, shown whole -------------------------------------------------------------------------------

test("the pieces of a text put back together are the text, whatever is marked", () => {
  const body = "Quiz 3 is due October 9. Read https://example.com/a.pdf. Office hours are Fridays.  See you (https://x.org/y).\nBye.";
  assert.equal(segmentsOf(body).map((segment) => segment.text).join(""), body);
  assert.equal(segmentsOf("").length, 0);
});

test("a sentence that names something to do or a date is a key one, and an address loses the full stop that follows it", () => {
  const segments = segmentsOf("Hello there. Quiz 3 is due October 9. Read https://example.com/a.pdf.");
  assert.deepEqual(segments.filter((segment) => segment.key).map((segment) => segment.text.trim()), ["Quiz 3 is due October 9."]);
  assert.deepEqual(segments.filter((segment) => segment.url).map((segment) => segment.url), ["https://example.com/a.pdf"]);
  assert.equal(isKeySentence("Welcome to the course."), false);
  assert.equal(isKeySentence("It is worth 1/2 point."), false);
  assert.equal(isKeySentence("The exam is next week."), true);
});

test("only web addresses become links, and an attachment is noticed by the words that point at one", () => {
  assert.deepEqual(segmentsOf("Click javascript:alert(1) or ftp://x.org").filter((segment) => segment.url), []);
  assert.equal(mentionsAttachment("See the attached worksheet."), true);
  assert.equal(mentionsAttachment("Bring a pencil."), false);
});

// --- narrowing the list ----------------------------------------------------------------------------------

const NOW = new Date(2026, 9, 10, 12, 0).valueOf();
const A = { id: "new-week", posted: "10/8/26, 9:00 AM", announced: "2026-10-09T00:00:00.000Z" };
const B = { id: "old", posted: "8/1/26, 9:00 AM", announced: "2026-10-09T00:00:00.000Z" };
const C = { id: "relative", posted: "7 hours ago, at 5:31 PM", announced: "2026-10-09T10:00:00.000Z" };
const context = (extra: Partial<Parameters<typeof applyFilters>[2]> = {}) => ({ now: NOW, unseen: new Set<string>(), hasActions: () => false, isChanged: () => false, ...extra });

test("the filters narrow by posting time, newness, possible to-dos and change, each on its own and together", () => {
  const list = [A, B, C];
  assert.deepEqual(applyFilters(list, NO_FILTERS, context()).map((a) => a.id), ["new-week", "old", "relative"]);
  // By when it was posted; an announcement that only says "7 hours ago" is placed by when it was first seen.
  assert.deepEqual(applyFilters(list, { ...NO_FILTERS, recency: "7" }, context()).map((a) => a.id), ["new-week", "relative"]);
  assert.deepEqual(applyFilters(list, { ...NO_FILTERS, onlyNew: true }, context({ unseen: new Set(["old"]) })).map((a) => a.id), ["old"]);
  assert.deepEqual(applyFilters(list, { ...NO_FILTERS, onlyActions: true }, context({ hasActions: (id: string) => id === "relative" })).map((a) => a.id), ["relative"]);
  assert.deepEqual(applyFilters(list, { ...NO_FILTERS, onlyChanged: true, recency: "30" }, context({ isChanged: (id: string) => id !== "old" })).map((a) => a.id), ["new-week", "relative"]);
  assert.equal(isFiltering(NO_FILTERS), false);
  assert.equal(isFiltering({ ...NO_FILTERS, onlyNew: true }), true);
});

test("the link to the original goes to the course's announcements when its HuskyCT id is known, else to the course list", () => {
  const grades = JSON.stringify({ version: 1, term: null, takenAt: "2026-10-01T00:00:00.000Z", courses: [{ id: "_203765_1", code: "MATH 1070Q", items: [] }] });
  const ids = huskyctCourseIds(grades);
  assert.equal(originalUrl("math  1070q", ids), "https://lms.uconn.edu/ultra/courses/_203765_1/announcements");
  assert.equal(originalUrl("ECON 1201", ids), "https://lms.uconn.edu/ultra/course");
  assert.equal(originalUrl(null, ids), "https://lms.uconn.edu/ultra/course");
  assert.equal(huskyctCourseIds("{").size, 0);
  assert.equal(huskyctCourseIds(null).size, 0);
});

// --- the overview ----------------------------------------------------------------------------------------

const task = (id: string, title: string, dayOffset: number, hour: number | null, extra: Partial<CalendarTask> = {}): CalendarTask => {
  const start = new Date(2026, 9, 10 + dayOffset, hour ?? 0);
  return { id, title, course: null, start: start.toISOString(), dateKey: null, end: null, allDay: hour === null, location: null, ...extra };
};
const code = (entry: CalendarTask) => (entry.id.startsWith("s") ? "STAT 1000Q" : entry.id.startsWith("m") ? "MATH 1070Q" : null);

test("the overview counts what is open: the next seven days by day and by course, what is overdue, and what has no day", () => {
  const now = new Date(2026, 9, 10, 12, 0);
  const tasks = [
    task("s1", "Quiz", 0, 15),
    task("s2", "Homework", 0, null),
    task("m1", "Exam", 3, 18),
    task("x1", "Paper", 6, 9),
    task("far", "Later", 7, 9),
    task("late", "Missed", -2, 9),
    task("today-gone", "Earlier today", 0, 8),
    task("done", "Done", 1, 9),
    task("lec", "Lecture", 1, 9, { kind: "class" }),
  ];
  const undated = [{ id: "u1", title: "Buy book", course: null, done: false }, { id: "u2", title: "Done thing", course: null, done: true }];
  const overview = buildOverview(tasks, new Set(["done"]), undated, now, code);

  assert.deepEqual(overview.next7.map((e) => e.id), ["s1", "s2", "m1", "x1"]);
  assert.deepEqual(overview.overdue.map((e) => e.id), ["late", "today-gone"]);
  assert.deepEqual(overview.undated.map((e) => e.id), ["u1"]);
  assert.deepEqual(overview.byDay.map((d) => [d.day, d.entries.length]), [["2026-10-10", 2], ["2026-10-11", 0], ["2026-10-12", 0], ["2026-10-13", 1], ["2026-10-14", 0], ["2026-10-15", 0], ["2026-10-16", 1]]);
  assert.deepEqual(overview.byCourse.map((c) => [c.course, c.entries.length]), [["STAT 1000Q", 2], ["MATH 1070Q", 1], [null, 1]]);
});

test("an all-day item due today is not overdue until the day is over, and every count is a count of items", () => {
  const now = new Date(2026, 9, 10, 23, 30);
  const overview = buildOverview([task("a", "All day", 0, null)], new Set(), [], now, () => null);
  assert.equal(overview.overdue.length, 0);
  assert.equal(overview.next7.length, 1);
  assert.equal(buildOverview([], new Set(), [], now, () => null).next7.length, 0);
});
