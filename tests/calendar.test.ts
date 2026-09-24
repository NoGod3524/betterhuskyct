import assert from "node:assert/strict";
import test from "node:test";

import { groupTasks } from "../src/lib/calendar-view.ts";
import { parseCalendar } from "../src/lib/parse-calendar.ts";
import { fetchCalendarText, SafeFetchError } from "../src/lib/safe-fetch.ts";

function addDays(value: Date, days: number, hour: number) {
  const copy = new Date(value.getFullYear(), value.getMonth(), value.getDate() + days, hour);
  return copy;
}

function icsDate(value: Date) {
  return value
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

test("parses, sorts and groups future VEVENT and VTODO items", async () => {
  const now = new Date(2026, 8, 1, 9, 0, 0);
  const calendar = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:HuskyCT Test Calendar
BEGIN:VEVENT
UID:today
DTSTAMP:20260801T120000Z
DTSTART:${icsDate(addDays(now, 0, 14))}
SUMMARY:CSE 2050: Problem Set 1
END:VEVENT
BEGIN:VEVENT
UID:tomorrow
DTSTAMP:20260801T120000Z
DTSTART:${icsDate(addDays(now, 1, 11))}
SUMMARY:[ENGL 1007] Reading response
END:VEVENT
BEGIN:VEVENT
UID:week
DTSTAMP:20260801T120000Z
DTSTART:${icsDate(addDays(now, 3, 16))}
SUMMARY:Chapter quiz
CATEGORIES:ECON 1201
END:VEVENT
BEGIN:VEVENT
UID:cancelled
DTSTAMP:20260801T120000Z
DTSTART:${icsDate(addDays(now, 2, 12))}
SUMMARY:Cancelled task
STATUS:CANCELLED
END:VEVENT
BEGIN:VTODO
UID:todo
DTSTAMP:20260801T120000Z
DUE:${icsDate(addDays(now, 6, 18))}
SUMMARY:MATH 2110Q: Practice quiz
STATUS:NEEDS-ACTION
END:VTODO
BEGIN:VEVENT
UID:all-day
DTSTAMP:20260801T120000Z
DTSTART;VALUE=DATE:20260901
SUMMARY:All-day reminder
END:VEVENT
END:VCALENDAR`;

  const parsed = await parseCalendar(calendar, now);
  assert.equal(parsed.calendarName, "HuskyCT Test Calendar");
  assert.equal(parsed.events.some((event) => event.title === "Cancelled task"), false);
  assert.deepEqual(
    parsed.events.map((event) => event.start),
    [...parsed.events]
      .sort((left, right) => Date.parse(left.start) - Date.parse(right.start))
      .map((event) => event.start),
  );

  const allDay = parsed.events.find((event) => event.id.startsWith("all-day:"));
  assert.equal(allDay?.allDay, true);
  assert.equal(allDay?.dateKey, "2026-09-01");

  const groups = groupTasks(parsed.events, now);
  assert.deepEqual(
    groups.map((group) => group.tasks.length),
    [2, 1, 2],
  );
  assert.equal(groups[0].tasks.some((event) => event.course === "CSE 2050"), true);
  assert.equal(groups[1].tasks[0].course, "ENGL 1007");
  assert.equal(groups[2].tasks.some((event) => event.course === "ECON 1201"), true);
});

/**
 * A date-only DTSTART carries no zone: 20260901 is the first of September
 * wherever the reader is. This passes in any zone now — it did not always, and
 * the reason CI runs the suite a second time east of UTC is this test.
 */
test("an all-day entry keeps the date the file wrote, wherever this runs", async () => {
  const calendar = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:all-day
DTSTAMP:20260801T120000Z
DTSTART;VALUE=DATE:20260901
SUMMARY:All-day reminder
END:VEVENT
END:VCALENDAR`;

  const parsed = await parseCalendar(calendar, new Date(2026, 8, 1, 9, 0, 0));
  const allDay = parsed.events[0];

  assert.equal(allDay.allDay, true);
  assert.equal(allDay.dateKey, "2026-09-01");
});

test("hides timed events earlier today but keeps all-day events for today", () => {
  const now = new Date(2026, 8, 1, 9, 0, 0);
  const events = [
    {
      id: "timed-earlier-today",
      title: "Already happened today",
      course: "MATH 2110Q",
      start: new Date(2026, 8, 1, 7, 30).toISOString(),
      dateKey: null,
      end: null,
      allDay: false,
      location: null,
    },
    {
      id: "all-day-today",
      title: "All-day reminder",
      course: "BIO 1000",
      start: new Date(2026, 8, 1, 0, 0).toISOString(),
      dateKey: "2026-09-01",
      end: null,
      allDay: true,
      location: null,
    },
  ];

  const groups = groupTasks(events, now);

  assert.deepEqual(
    groups.map((group) => group.tasks.map((event) => event.id)),
    [["all-day-today"], [], []],
  );
  assert.equal(groups[0].tasks.some((event) => event.id === "timed-earlier-today"), false);
  assert.equal(groups[0].tasks.some((event) => event.id === "all-day-today"), true);
});

test("parses bracketed course names from event titles", async () => {
  const now = new Date(2026, 8, 1, 9, 0, 0);
  const calendar = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:chem
DTSTAMP:20260801T120000Z
DTSTART:${icsDate(addDays(now, 0, 14))}
SUMMARY:[CHEM 1127Q] Lab report
END:VEVENT
END:VCALENDAR`;

  const parsed = await parseCalendar(calendar, now);
  const task = parsed.events[0];

  assert.equal(task.course, "CHEM 1127Q");
  assert.equal(task.title, "Lab report");
});

test("rejects non-HTTPS and private-network calendar targets", async () => {
  await assert.rejects(
    () => fetchCalendarText("http://example.com/calendar.ics"),
    (error) => error instanceof SafeFetchError && /HTTPS/.test(error.message),
  );
  await assert.rejects(
    () => fetchCalendarText("https://127.0.0.1/calendar.ics"),
    (error) => error instanceof SafeFetchError && /not allowed/.test(error.message),
  );
});

/**
 * A feed with one real deadline and one recurring event, as a string.
 *
 * The recurring event is the variable: each test picks a rule that used to hurt
 * the deadline next to it.
 */
function feedWithRecurring(rule: string) {
  return `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:real-deadline
DTSTAMP:20260901T120000Z
DTSTART:20261120T235900Z
SUMMARY:Final project
END:VEVENT
BEGIN:VEVENT
UID:noisy
DTSTAMP:20260901T120000Z
DTSTART:20260920T000000Z
RRULE:${rule}
SUMMARY:Office hours ping
END:VEVENT
END:VCALENDAR`;
}

test("a recurring rule the expander refuses costs that event, not the calendar", async () => {
  // FREQ=MINUTELY trips node-ical's 10,000-iteration guard; this used to throw
  // out of parseCalendar and fail the whole import with a 422.
  const parsed = await parseCalendar(
    feedWithRecurring("FREQ=MINUTELY"),
    new Date("2026-09-24T12:00:00Z"),
  );

  assert.deepEqual(
    parsed.events.map((event) => event.title),
    ["Final project"],
  );
});

test("one frequent recurring event cannot crowd real deadlines out of the import", async () => {
  // Hourly from September: without a per-event cap it fills all 500 slots by
  // mid-October, and a November deadline is cut off.
  const parsed = await parseCalendar(
    feedWithRecurring("FREQ=HOURLY"),
    new Date("2026-09-24T12:00:00Z"),
  );

  assert.ok(
    parsed.events.some((event) => event.title === "Final project"),
    "the November deadline was truncated by the hourly event",
  );
  assert.ok(parsed.events.filter((event) => event.title === "Office hours ping").length <= 150);
});

test("a class meeting that recurs all term still arrives whole", async () => {
  const parsed = await parseCalendar(
    feedWithRecurring("FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=45"),
    new Date("2026-09-20T00:00:00Z"),
  );

  assert.equal(
    parsed.events.filter((event) => event.title === "Office hours ping").length,
    45,
  );
});
