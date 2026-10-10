import assert from "node:assert/strict";
import test from "node:test";

import { findDates } from "../src/lib/announcement-dates.ts";
import { extractCandidates, isAddable, sentencesOf } from "../src/lib/announcement-actions.ts";

// 4:00 PM on Monday, October 5, 2026, in the reader's zone; the helper writes it as "10/5/26, 4:00 PM".
const POSTED_AT = new Date(2026, 9, 5, 16, 0).valueOf();
const POSTED = "10/5/26, 4:00 PM";
const ann = (body: string, title = "Update", posted: string | null = POSTED) => ({ id: "a1", title, body, posted });
const only = (sentence: string, postedAt: number | null = POSTED_AT) => {
  const found = findDates(sentence, postedAt);
  assert.equal(found.length, 1, sentence + " -> " + JSON.stringify(found));
  return found[0];
};
const ymd = (d: { year: number; month: number; day: number } | null) => (d ? `${d.year}-${d.month}-${d.day}` : null);

// --- dates ----------------------------------------------------------------------------------------

test("a day with its month named, and a time beside it, is read as written, with the year taken from the posting", () => {
  const found = only("Quiz 3 is due Friday, October 9 at 11:59 PM.");
  assert.equal(ymd(found.date), "2026-10-9");
  assert.equal(found.time, "23:59");
  assert.ok(found.basis.includes("year-from-posting") && !found.basis.includes("weekday-mismatch"));
});

test("a weekday that is not the date's weekday is flagged, not corrected", () => {
  const found = only("Due Friday, October 10.");
  assert.equal(ymd(found.date), "2026-10-10");
  assert.ok(found.basis.includes("weekday-mismatch"));
});

test("with a year written it is used, and a month and day with no posting time have no year to take", () => {
  assert.equal(ymd(only("Due Oct. 14th, 2027.").date), "2027-10-14");
  const none = only("Due October 14.", null);
  assert.equal(none.date, null);
  assert.ok(none.basis.includes("year-unknown"));
});

test("a date well before the posting is next year's: a December post naming January", () => {
  const december = new Date(2026, 11, 10, 9, 0).valueOf();
  assert.equal(ymd(only("Exam on January 15.", december).date), "2027-1-15");
});

test("numbers with a slash: month first when the day cannot be a month, day first when the month cannot be, and neither chosen when both could be", () => {
  assert.equal(ymd(only("Due 10/14.").date), "2026-10-14");
  assert.equal(ymd(only("Due 14/10.").date), "2026-10-14");
  const unclear = only("Due 3/4.");
  assert.equal(unclear.date, null);
  assert.deepEqual(unclear.options.map((o) => ymd(o.date)), ["2027-3-4", "2027-4-3"]);
  assert.ok(unclear.basis.includes("order-ambiguous"));
  assert.equal(ymd(only("Due 3/3.").date), "2027-3-3");
});

test("a range gives its two ends to choose from, and an impossible day is not a date", () => {
  const range = only("Presentations are October 14-16.");
  assert.equal(range.date, null);
  assert.deepEqual(range.options.map((o) => ymd(o.date)), ["2026-10-14", "2026-10-16"]);
  assert.deepEqual(findDates("Due February 30.", POSTED_AT), []);
});

test("tomorrow and tonight are worked out only from a posting time the page stated", () => {
  assert.equal(ymd(only("Due tomorrow.").date), "2026-10-6");
  assert.equal(ymd(only("Due tonight.").date), "2026-10-5");
  assert.equal(ymd(only("Due in 3 days.").date), "2026-10-8");
  const unknown = only("Due tomorrow.", null);
  assert.equal(unknown.date, null);
  assert.ok(unknown.basis.includes("posting-unknown"));
});

test("a bare or next weekday is left to the student, with the Fridays after posting to pick from", () => {
  for (const text of ["Due Friday.", "Due next Friday.", "Due this Friday."]) {
    const found = only(text);
    assert.equal(found.date, null, text);
    assert.deepEqual(found.options.map((o) => ymd(o.date)), ["2026-10-9", "2026-10-16"], text);
    assert.ok(found.basis.includes("relative-unresolved"));
  }
  // The same weekday as the posting is a week on, not that day.
  assert.equal(ymd(only("Due Monday.").options[0].date), "2026-10-12");
  assert.deepEqual(findDates("Due next class.", POSTED_AT), []);
});

test("a time goes to the date it is beside, and noon is a time while midnight is not taken", () => {
  const two = findDates("Exam 1 is October 14 at 2 pm and Exam 2 is November 18 at noon.", POSTED_AT);
  assert.deepEqual(two.map((d) => [ymd(d.date), d.time]), [["2026-10-14", "14:00"], ["2026-11-18", "12:00"]]);
  assert.equal(only("Due October 14 at midnight.").time, null);
  assert.equal(only("Due October 14.").time, null);
});

// --- candidates -----------------------------------------------------------------------------------

test("a deadline, an exam and a quiz are told apart, each with its sentence, its date and the words that made it one", () => {
  const found = extractCandidates(ann("Homework 4 is due October 9. The midterm exam is on October 21 at 6:30 PM. Quiz 5 will be on October 13."));
  const kinds = found.map((c) => [c.kind, c.title, ymd(c.date), c.time]);
  assert.deepEqual(kinds, [["deadline", "Homework 4", "2026-10-9", null], ["exam", "Midterm", "2026-10-21", "18:30"], ["quiz", "Quiz 5", "2026-10-13", null]]);
  assert.ok(found[0].sentence.startsWith("Homework 4 is due"));
  assert.ok(found[0].keywords.includes("due"));
  assert.ok(found.every((c) => c.check === false), "clear ones should not ask for a second look");
  const marked = found[0];
  assert.equal(marked.sentence.slice(marked.match!.start, marked.match!.end), "October 9");
});

test("a date with no word to say what it is for is only mentioned and is to be checked; a fraction is not a date", () => {
  const found = extractCandidates(ann("The campus fair is on October 20. Scores are worth 1/2 point."));
  assert.deepEqual(found.map((c) => [c.kind, c.check]), [["mention", true]]);
});

test("a sentence with an unsettled date is marked to check, and keeps the options and the reasons", () => {
  const [candidate] = extractCandidates(ann("Paper is due 3/4.", "Paper"));
  assert.equal(candidate.check, true);
  assert.equal(candidate.date, null);
  assert.equal(candidate.options.length, 2);
  assert.ok(candidate.basis.includes("order-ambiguous"));
});

test("a due sentence with no date is offered with no day, for the student to give", () => {
  const found = extractCandidates(ann("Homework 5 is due by the start of next class."));
  assert.deepEqual(found.map((c) => [c.kind, c.title, c.date, c.check]), [["deadline", "Homework 5", null, true]]);
  assert.deepEqual(extractCandidates(ann("Please read chapter 4 before we meet.")), []);
});

test("a cancelled class is a candidate that is not added to the to-do", () => {
  const [candidate] = extractCandidates(ann("Class is cancelled on October 12.", "Cancelled"));
  assert.equal(candidate.kind, "no-class");
  assert.equal(isAddable(candidate), false);
  assert.equal(ymd(candidate.date), "2026-10-12");
});

test("a change is noted on the candidate it belongs to", () => {
  const [candidate] = extractCandidates(ann("The midterm exam has been moved to October 22.", "Midterm moved"));
  assert.equal(candidate.kind, "exam");
  assert.equal(candidate.changed, true);
});

test("a final project is not an exam, and the title is read too", () => {
  assert.deepEqual(extractCandidates(ann("The final project is due December 4.")).map((c) => c.kind), ["deadline"]);
  assert.deepEqual(extractCandidates(ann("", "Quiz 2 due October 9")).map((c) => [c.kind, c.from, ymd(c.date)]), [["quiz", "title", "2026-10-9"]]);
});

test("the same text gives the same candidates with the same ids, and a repeated sentence is one", () => {
  const body = "Quiz 3 is due October 9. Reminder: Quiz 3 is due October 9.";
  const first = extractCandidates(ann(body));
  const second = extractCandidates(ann(body));
  assert.deepEqual(first.map((c) => c.id), second.map((c) => c.id));
  assert.equal(extractCandidates(ann("Quiz 3 is due October 9. Quiz 3 is due October 9.")).length, 1);
});

test("with no posting time, nothing relative is worked out and the year is left", () => {
  const [candidate] = extractCandidates(ann("Homework 2 is due tomorrow.", "HW", "7 hours ago, at 5:31 PM"));
  assert.equal(candidate.date, null);
  assert.ok(candidate.check && candidate.basis.includes("posting-unknown"));
  const [yearless] = extractCandidates(ann("Exam on October 21.", "Exam", null));
  assert.equal(yearless.date, null);
  assert.ok(yearless.basis.includes("year-unknown"));
});

test("sentences are cut at line ends and at full stops before a capital, not inside a number or a date", () => {
  assert.deepEqual(sentencesOf("Due Oct. 9. Bring the form.\nSee Dr. Smith at 3.5 hours."), ["Due Oct. 9.", "Bring the form.", "See Dr. Smith at 3.5 hours."]);
});
