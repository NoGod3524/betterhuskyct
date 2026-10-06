import assert from "node:assert/strict";
import test from "node:test";

import {
  addFound,
  announcementBatches,
  announcementKey,
  ANNOUNCEMENT_SIGNATURE,
  decide,
  EMPTY_PLAN_STATE,
  markFailed,
  markRead,
  MAX_FAILURES,
  needsReading,
  parsePlanState,
  requestPlan,
  selectedByDefault,
  setSummary,
  similarTitles,
  suggestionFlags,
  suggestionId,
  suggestionToEvent,
  suggestionToUndated,
  syllabusSignature,
  weekdayMismatch,
  type PlanState,
  type Suggestion,
} from "../src/lib/ai-plan.ts";
import type { Announcement } from "../src/lib/announcements.ts";
import { SummaryError } from "../src/lib/announcement-summary.ts";
import type { CalendarTask } from "../src/lib/calendar-types.ts";
import type { PlanItem } from "../src/lib/plan-models.ts";

const item = (overrides: Partial<PlanItem> = {}): PlanItem => ({
  title: "Midterm 1",
  date: "2026-10-14",
  time: null,
  kind: "exam",
  evidence: "Midterm 1: Wednesday, October 14",
  source: null,
  ...overrides,
});

const meta = { course: "MATH 1070Q", from: "syllabus" as const, fromLabel: () => "syllabus.pdf", foundAt: "2026-09-01T12:00:00.000Z" };

const suggestion = (overrides: Partial<PlanItem> = {}): Suggestion => addFound(EMPTY_PLAN_STATE, [item(overrides)], meta).pending[0];

test("the same thing found twice, however it is punctuated, is offered once", () => {
  assert.equal(suggestionId("MATH 1070Q", "Mid-term 1", "2026-10-14"), suggestionId("math 1070q", "midterm 1 ", "2026-10-14"));
  assert.notEqual(suggestionId("MATH 1070Q", "Midterm 1", "2026-10-14"), suggestionId("MATH 1070Q", "Midterm 1", "2026-10-21"), "a moved exam is new");

  const once = addFound(EMPTY_PLAN_STATE, [item(), item({ title: "Mid-term 1" })], meta);
  assert.equal(once.pending.length, 1);
  assert.equal(addFound(once, [item()], meta), once, "something already waiting was added again");
});

test("something added or let go is not offered again by a later read", () => {
  const found = addFound(EMPTY_PLAN_STATE, [item(), item({ title: "Quiz 3", kind: "quiz" })], meta);
  const [midterm, quiz] = found.pending;

  const decided = decide(found, { [midterm.id]: "added", [quiz.id]: "dismissed" });
  assert.deepEqual(decided.pending, []);

  const again = addFound(decided, [item(), item({ title: "Quiz 3", kind: "quiz" })], meta);
  assert.deepEqual(again.pending, []);
});

test("a source is read again only when it changes, and given up on after repeated failures", () => {
  let state: PlanState = { ...EMPTY_PLAN_STATE, enabled: true };
  assert.ok(needsReading(state, "syllabus:_1_1", "a@1"));

  state = markRead(state, "syllabus:_1_1", "a@1");
  assert.ok(!needsReading(state, "syllabus:_1_1", "a@1"));
  assert.ok(needsReading(state, "syllabus:_1_1", "a@2"), "a newer copy of the file was not read");

  for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) {
    assert.ok(needsReading(state, "syllabus:_2_1", "b@1"));
    state = markFailed(state, "syllabus:_2_1", "b@1");
  }
  assert.ok(!needsReading(state, "syllabus:_2_1", "b@1"), "a source that keeps failing is still tried every visit");
  assert.ok(needsReading(state, "syllabus:_2_1", "b@2"), "a changed source was given up on with the old one");
  assert.ok(!("syllabus:_2_1" in markRead(state, "syllabus:_2_1", "b@2").failed), "a success left the failures");
});

const announcement = (id: string, course: string | null, announced: string, body = "Exam 2 is Oct 21."): Announcement => ({
  id,
  courseId: null,
  courseCode: course,
  title: `Title ${id}`,
  body,
  posted: null,
  announced,
});

test("announcements are read by course, newest first, and only from a month before this was turned on", () => {
  const state: PlanState = { ...EMPTY_PLAN_STATE, enabled: true, enabledAt: "2026-10-01T00:00:00.000Z" };
  const batches = announcementBatches(
    [
      announcement("a", "MATH 1070Q", "2026-09-20T00:00:00.000Z"),
      announcement("b", "MATH 1070Q", "2026-09-25T00:00:00.000Z"),
      announcement("old", "MATH 1070Q", "2026-08-01T00:00:00.000Z"),
      announcement("c", "SOCI 1501", "2026-10-02T00:00:00.000Z"),
    ],
    state,
  );

  assert.deepEqual(
    batches.map((batch) => [batch.course, batch.ids]),
    [
      ["MATH 1070Q", ["b", "a"]],
      ["SOCI 1501", ["c"]],
    ],
  );
});

test("announcements already read, or given up on, are not sent again, and a long run is split", () => {
  let state: PlanState = { ...EMPTY_PLAN_STATE, enabled: true, enabledAt: "2026-10-01T00:00:00.000Z" };
  state = markRead(state, announcementKey("read"), ANNOUNCEMENT_SIGNATURE);
  for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) state = markFailed(state, announcementKey("broken"), ANNOUNCEMENT_SIGNATURE);
  const many = Array.from({ length: 25 }, (_, index) =>
    announcement(`n${index}`, "MATH 1070Q", new Date(Date.UTC(2026, 9, 1, index)).toISOString()),
  );

  const batches = announcementBatches(
    [announcement("read", "MATH 1070Q", "2026-10-02T00:00:00.000Z"), announcement("broken", "MATH 1070Q", "2026-10-02T00:00:00.000Z"), ...many],
    state,
  );

  const ids = batches.flatMap((batch) => batch.ids);
  assert.ok(!ids.includes("read") && !ids.includes("broken"));
  assert.equal(ids.length, 25);
  assert.deepEqual(batches.map((batch) => batch.ids.length), [20, 5]);

  const long = announcementBatches(
    [announcement("x", "C", "2026-10-02T00:00:00.000Z", "x".repeat(15_000)), announcement("y", "C", "2026-10-03T00:00:00.000Z", "y".repeat(15_000))],
    state,
  );
  assert.equal(long.length, 2, "two long announcements were sent as one oversized request");
});

test("a weekday in the source that the date does not fall on is caught: last year's syllabus", () => {
  // 14 October 2026 is a Wednesday.
  assert.equal(weekdayMismatch({ date: "2026-10-14", evidence: "Midterm 1: Wednesday, October 14" }), false);
  assert.equal(weekdayMismatch({ date: "2026-10-14", evidence: "Midterm 1: Tues. Oct 14" }), true);
  assert.equal(weekdayMismatch({ date: "2026-10-14", evidence: "Lectures Mon/Wed; midterm Oct 14" }), false, "two weekdays say nothing");
  assert.equal(weekdayMismatch({ date: null, evidence: "Tuesday of week 5" }), false);
});

test("titles that name the same work match, and different work does not", () => {
  assert.ok(similarTitles("Midterm 1", "MATH 1070Q Midterm 1"));
  assert.ok(similarTitles("Lab report 3 due", "Lab Report 3"));
  assert.ok(!similarTitles("Lab report 3", "Quiz 3"));
});

test("a find already in the calendar on that day, or already past, is shown but not ticked", () => {
  const task = (title: string, day: number, kind: CalendarTask["kind"] = "assignment"): CalendarTask => ({
    id: title,
    title,
    course: "MATH 1070Q",
    start: new Date(2026, 9, day, 23, 59).toISOString(),
    dateKey: null,
    end: null,
    allDay: false,
    location: null,
    kind,
  });

  const flags = suggestionFlags(suggestion(), [task("MATH 1070Q Midterm 1", 14)], "2026-09-01");
  assert.deepEqual(flags, { inCalendar: true, weekday: false, past: false });
  assert.equal(selectedByDefault(flags), false);

  assert.equal(suggestionFlags(suggestion(), [task("MATH 1070Q Midterm 1", 15)], "2026-09-01").inCalendar, false, "another day matched");
  assert.equal(suggestionFlags(suggestion(), [task("Midterm 1", 14, "class")], "2026-09-01").inCalendar, false, "a class meeting matched");

  const past = suggestionFlags(suggestion(), [], "2026-10-20");
  assert.equal(past.past, true);
  assert.equal(selectedByDefault(past), false);
  assert.equal(selectedByDefault(suggestionFlags(suggestion(), [], "2026-09-01")), true);
});

test("a dated find becomes an event on that day here: at its time, or all day without one", () => {
  const timed = suggestionToEvent(suggestion({ time: "18:30" }), "2026-10-14");
  const start = new Date(timed.start);
  assert.deepEqual([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()], [2026, 9, 14, 18, 30]);
  assert.equal(timed.allDay, false);
  assert.equal(timed.course, "MATH 1070Q");
  assert.match(timed.note ?? "", /^AI · syllabus\.pdf: "Midterm 1: Wednesday, October 14"$/);

  const allDay = suggestionToEvent(suggestion(), "2026-10-14");
  assert.equal(allDay.allDay, true);

  const moved = suggestionToEvent(suggestion({ time: "18:30" }), "2026-10-16");
  assert.equal(moved.allDay, true, "the AI's time was kept on a day the student chose");
  assert.equal(new Date(moved.start).getDate(), 16);
});

test("an undated find becomes a to-do with no date that keeps where it came from", () => {
  const todo = suggestionToUndated(suggestion({ title: "Buy the textbook", date: null, kind: "task", evidence: "Buy the textbook" }), "2026-09-01T12:00:00.000Z");
  assert.equal(todo.title, "Buy the textbook");
  assert.equal(todo.done, false);
  assert.equal(todo.course, "MATH 1070Q");
});

test("a stored state that is damaged reads as empty, and a damaged suggestion is dropped", () => {
  assert.deepEqual(parsePlanState("{not json"), EMPTY_PLAN_STATE);
  assert.deepEqual(parsePlanState("[1,2]"), EMPTY_PLAN_STATE);

  const good = suggestion();
  const state = parsePlanState(
    JSON.stringify({ enabled: true, enabledAt: "2026-10-01T00:00:00.000Z", read: { a: "1", b: 2 }, failed: {}, pending: [good, { id: "x" }], decided: { y: "added", z: "maybe" } }),
  );
  assert.equal(state.enabled, true);
  assert.deepEqual(state.read, { a: "1" });
  assert.deepEqual(state.pending, [good]);
  assert.deepEqual(state.decided, { y: "added" });
});

test("what the endpoint sends back is checked again, and its problems keep their names", async () => {
  const request = { kind: "syllabus" as const, courseLabel: "MATH", term: null, today: "2026-09-01", text: "x", announcements: [] };
  const answer = (body: unknown, status = 200) => async () => Response.json(body, { status });

  const ok = await requestPlan(request, answer({ items: [item(), { title: "", date: "2026-10-01" }, item({ date: "2026-13-01" })], provider: "glm" }));
  assert.equal(ok.provider, "glm");
  assert.equal(ok.items.length, 2, "an untitled item from the server was kept");
  assert.equal(ok.items[1].date, null, "an impossible date from the server was kept");

  await assert.rejects(requestPlan(request, answer({ problem: "busy" }, 503)), (error: unknown) => error instanceof SummaryError && error.problem === "busy");
  await assert.rejects(requestPlan(request, answer({ problem: "not-configured" }, 503)), (error: unknown) => error instanceof SummaryError && error.problem === "unavailable");
  await assert.rejects(
    requestPlan(request, async () => new Response("<html>", { status: 504 })),
    (error: unknown) => error instanceof SummaryError && error.problem === "unavailable",
  );
});

test("a syllabus is read again when its language changes, and once more if it was read before summaries", () => {
  const files = [{ key: "k", savedAt: "2026-09-01T00:00:00.000Z" }];
  const english = syllabusSignature(files, "en");
  assert.notEqual(english, syllabusSignature(files, "zh-CN"));
  assert.notEqual(english, "k@2026-09-01T00:00:00.000Z", "a read from before summaries counts as read with one");
  assert.equal(english, syllabusSignature(files, "en"));
});

test("stored summaries are checked like the model's answer, and a bad one is dropped", () => {
  const good = { text: "- Exams 60%\n- Late work -10% a day", files: "syllabus.pdf", locale: "en", provider: "glm", at: "2026-09-01T00:00:00.000Z" };
  const state = parsePlanState(
    JSON.stringify({
      ...EMPTY_PLAN_STATE,
      summaries: { _1_1: good, _2_1: { ...good, text: "no bullets here" }, _3_1: { ...good, locale: "fr" }, _4_1: "nope" },
    }),
  );
  assert.deepEqual(Object.keys(state.summaries), ["_1_1"]);
  assert.deepEqual(state.summaries._1_1, good);
  assert.deepEqual(setSummary(state, "_9_1", null), state, "no summary replaced the state");
});

test("the endpoint's summary is kept for a syllabus in the page's language, and never for announcements", async () => {
  const answer = (body: unknown) => async () => Response.json(body);
  const syllabus = { kind: "syllabus" as const, courseLabel: "M", term: null, today: "2026-09-01", text: "x", announcements: [], locale: "zh-CN" as const };

  assert.equal((await requestPlan(syllabus, answer({ items: [], summary: "- 考试 60%" }))).summary, "- 考试 60%");
  assert.equal((await requestPlan(syllabus, answer({ items: [], summary: "- Exams 60%" }))).summary, null);
  const announcements = { ...syllabus, kind: "announcements" as const, text: "", announcements: [{ title: "A", body: "B", posted: null }] };
  assert.equal((await requestPlan(announcements, answer({ items: [], summary: "- 考试 60%" }))).summary, null);
});

const found = (course: string, overrides: Partial<PlanItem>[]) => (state: PlanState) =>
  addFound(
    state,
    overrides.map((override) => item({ kind: "no-class", time: null, evidence: "", ...override })),
    { course, from: "syllabus", fromLabel: () => `${course}.pdf`, foundAt: "2026-09-01T12:00:00.000Z" },
  );

test("Thanksgiving in every syllabus, in other words and from other days, is offered once and belongs to no single course", () => {
  let state: PlanState = EMPTY_PLAN_STATE;
  state = found("MATH 1070Q", [{ title: "Thanksgiving Break", date: "2026-11-22" }])(state);
  state = found("SOCI 1501", [{ title: "No class – Thanksgiving recess", date: "2026-11-26" }])(state);
  state = found("CSE 2050", [{ title: "Thanksgiving", date: "2026-11-23" }])(state);

  assert.equal(state.pending.length, 1, state.pending.map((s) => `${s.course}: ${s.title} ${s.date}`).join(" | "));
  assert.equal(state.pending[0].date, "2026-11-22", "the first one found was not kept");
  assert.equal(state.pending[0].course, null);
});

test("a day off with no day is never offered", () => {
  const state = found("MATH 1070Q", [{ title: "Thanksgiving recess", date: null }])(EMPTY_PLAN_STATE);
  assert.deepEqual(state.pending, []);
});

test("different breaks stay apart, and plain 'No class' only joins the same day", () => {
  let state: PlanState = EMPTY_PLAN_STATE;
  state = found("A", [
    { title: "Fall break", date: "2026-10-12" },
    { title: "Thanksgiving recess", date: "2026-11-22" },
    { title: "Spring break", date: "2027-03-14" },
    { title: "No class", date: "2026-09-30" },
    { title: "Labor Day – no class", date: "2026-09-07" },
    { title: "Rosh Hashanah (no class)", date: "2026-09-12" },
  ])(state);
  state = found("B", [
    { title: "No class", date: "2026-10-02" },
    { title: "Class cancelled", date: "2026-09-30" },
  ])(state);

  assert.deepEqual(
    state.pending.map((s) => s.title),
    ["Fall break", "Thanksgiving recess", "Spring break", "No class", "Labor Day – no class", "Rosh Hashanah (no class)", "No class"],
  );
});

test("a break let go in one course is not offered again by the next course's syllabus", () => {
  let state = found("MATH 1070Q", [{ title: "Thanksgiving Break", date: "2026-11-22" }])(EMPTY_PLAN_STATE);
  state = decide(state, { [state.pending[0].id]: "dismissed" });
  state = found("SOCI 1501", [{ title: "Thanksgiving recess (no class)", date: "2026-11-25" }])(state);
  assert.deepEqual(state.pending, []);
});

test("an undated find gives way to the same thing with a date, whichever comes first", () => {
  const exam = (date: string | null) => ({ title: "Final Exam", date, kind: "exam" as const });

  let undatedFirst = found("MATH 1070Q", [exam(null)])(EMPTY_PLAN_STATE);
  undatedFirst = found("MATH 1070Q", [exam("2026-12-10")])(undatedFirst);
  assert.deepEqual(undatedFirst.pending.map((s) => s.date), ["2026-12-10"]);

  let datedFirst = found("MATH 1070Q", [exam("2026-12-10")])(EMPTY_PLAN_STATE);
  datedFirst = found("MATH 1070Q", [{ ...exam(null), title: "Final exam (cumulative)" }])(datedFirst);
  assert.deepEqual(datedFirst.pending.map((s) => s.date), ["2026-12-10"]);

  const otherCourse = found("SOCI 1501", [exam(null)])(datedFirst);
  assert.equal(otherCourse.pending.length, 2, "another course's undated final was taken for this one's");
});

test("a list saved with duplicates is merged when it is read back, and reading it again adds nothing", () => {
  const make = (course: string, title: string, date: string | null, kind: PlanItem["kind"] = "no-class") => ({
    ...item({ title, date, kind, time: null }),
    id: suggestionId(course, title, date),
    course,
    from: "syllabus" as const,
    fromLabel: "",
    foundAt: "2026-09-01T00:00:00.000Z",
  });
  const saved = JSON.stringify({
    ...EMPTY_PLAN_STATE,
    enabled: true,
    offered: undefined,
    pending: [
      make("A", "Thanksgiving Break", "2026-11-22"),
      make("B", "Thanksgiving recess", "2026-11-25"),
      make("C", "Thanksgiving", null),
      make("A", "Midterm 1", null, "exam"),
      make("A", "Midterm 1", "2026-10-14", "exam"),
    ],
  });

  const once = parsePlanState(saved);
  assert.deepEqual(
    once.pending.map((s) => [s.course, s.title, s.date]),
    [
      [null, "Thanksgiving Break", "2026-11-22"],
      ["A", "Midterm 1", "2026-10-14"],
    ],
  );
  const twice = parsePlanState(JSON.stringify(once));
  assert.equal(twice.offered.length, once.offered.length, "what was offered grew on every visit");
});
