import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";

/**
 * These run the *shipped* userscript, not a copy of it.
 *
 * The file is a self-contained IIFE so it can be pasted into Tampermonkey, which
 * means there is nothing to import. Loading it in a bare VM context gives the
 * same code a chance to run without a browser, and the helpers it attaches are
 * what the assertions below use.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  join(HERE, "..", "tools", "huskyct-helper", "huskyct-helper.user.js"),
  "utf8",
);

/** The surface the userscript attaches for exactly this purpose. */
type HelperSurface = {
  mergeCalendars: (name: string, texts: string[]) => string;
  calendarLinks: () => Array<[string, string]>;
  kindFromSourceType: (type: string) => string | null;
  eventToRecord: (raw: Record<string, unknown>, event: Record<string, unknown>) => Record<string, unknown> | null;
  recordsToIcs: (records: Array<Record<string, unknown>>) => string;
  utcStamp: (iso: string) => string | null;
  currentCourseId: () => string | null;
  courseCodeFromDisplay: (value: string | null) => string | null;
  courseTitleFromDisplay: (value: string | null) => string | null;
  postedFromText: (value: string) => string | null;
  collectAnnouncements: (root: unknown) => Array<{ title: string; body: string; posted: string | null }>;
  collectContentItems: (root: unknown) => Array<{ title: string; state: string }>;
  collectCourseFiles: (root: unknown) => Array<{ title: string; id: string; url: string }>;
  announcementsToCandidates: (
    records: Array<{ title: string; body?: string; posted?: string | null }>,
    courseCode: string | null,
    now?: Date,
  ) => Array<Record<string, unknown>>;
  courseDigestToMarkdown: (digest: Record<string, unknown>) => string;
  todoFromLabel: (label: string) => Record<string, unknown> | null;
  dueDateFromText: (value: string) => Date | null;
  collectTodos: (root: unknown) => Array<Record<string, unknown>>;
  todosToRecords: (todos: Array<Record<string, unknown>>) => Array<Record<string, unknown>>;
  guidanceFor: (scope: unknown, courseId: string | null) => string;
  taskFromRecord: (record: Record<string, unknown>) => Record<string, unknown>;
  syncPayload: (
    records: Array<Record<string, unknown>>,
    now?: Date,
    announcements?: Array<Record<string, unknown>>,
  ) => Record<string, unknown>;
  huskypilotLink: (
    records: Array<Record<string, unknown>>,
    now?: Date,
    announcements?: Array<Record<string, unknown>>,
  ) => Promise<string>;
  VERSION: string;
};

const sandbox: Record<string, unknown> = {
  console,
  URL,
  setTimeout,
  clearTimeout,
  navigator: {},
  // Real ones, not stubs: building the BetterHuskyCT link gzips the payload through
  // Blob -> CompressionStream -> Response, and a stub Blob cannot stream.
  Blob,
  Response,
  TextEncoder,
  TextDecoder,
  CompressionStream,
  DecompressionStream,
  btoa,
  atob,
  // A userscript always runs inside a page, so a real Location is part of the
  // environment rather than something the code should work around. This is the
  // host HuskyCT actually serves from.
  location: {
    href: "https://lms.uconn.edu/ultra/course",
    origin: "https://lms.uconn.edu",
    pathname: "/ultra/course",
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(SOURCE, sandbox);

/** A fresh copy of the script, running at a given URL. */
function helperAt(href: string, pathname: string, origin: string): HelperSurface {
  const box: Record<string, unknown> = {
    console,
    URL,
    Blob: class {},
    setTimeout,
    clearTimeout,
    navigator: {},
    location: { href, origin, pathname },
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(SOURCE, box);

  return box.__huskyctHelper as HelperSurface;
}

import { parseCalendar } from "../src/lib/parse-calendar.ts";
import { decodeSyncPayload } from "../src/lib/sync.ts";

const {
  mergeCalendars,
  VERSION,
  eventToRecord,
  recordsToIcs,
  courseCodeFromDisplay,
  courseTitleFromDisplay,
  postedFromText,
  collectAnnouncements,
  collectContentItems,
  collectCourseFiles,
  announcementsToCandidates,
  courseDigestToMarkdown,
  todoFromLabel,
  dueDateFromText,
  collectTodos,
  todosToRecords,
  guidanceFor,
  taskFromRecord,
  syncPayload,
  huskypilotLink,
} = sandbox.__huskyctHelper as HelperSurface;

test("the userscript parses and exposes its helpers", () => {
  assert.equal(typeof mergeCalendars, "function");
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

/**
 * The panel prints this version, and it is the only way to tell from the screen
 * which copy the browser actually installed. If it drifts from `@version`, the
 * panel confidently reports a build that is not running.
 */
test("the panel version matches the version in the metadata block", () => {
  const declared = SOURCE.match(/^\/\/\s*@version\s+(\S+)/m)?.[1];
  assert.ok(declared, "@version is missing from the userscript header");
  assert.equal(VERSION, declared);
});

const CALENDAR_A = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Blackboard//EN",
  "BEGIN:VTIMEZONE",
  "TZID:America/New_York",
  "BEGIN:STANDARD",
  "DTSTART:19701101T020000",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:event-1",
  "DTSTART;TZID=America/New_York:20260918T235900",
  "SUMMARY:Section 4.4 Homework",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:event-2",
  "DTSTART;TZID=America/New_York:20260919T235900",
  "SUMMARY:Section 4.5 Homework",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const CALENDAR_B = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Blackboard//EN",
  "BEGIN:VTIMEZONE",
  "TZID:America/New_York",
  "BEGIN:STANDARD",
  "DTSTART:19701101T020000",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:event-1",
  "DTSTART;TZID=America/New_York:20260918T235900",
  "SUMMARY:Section 4.4 Homework (the same one)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:event-3",
  "DTSTART;TZID=America/New_York:20260920T235900",
  "SUMMARY:Section 4.6 Homework",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("merging keeps one calendar wrapper and every distinct event", () => {
  const merged = mergeCalendars("Merged", [CALENDAR_A, CALENDAR_B]);

  assert.equal((merged.match(/BEGIN:VCALENDAR/g) || []).length, 1);
  assert.equal((merged.match(/END:VCALENDAR/g) || []).length, 1);
  assert.equal((merged.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(merged, /UID:event-1/);
  assert.match(merged, /UID:event-3/);
  assert.match(merged, /X-WR-CALNAME:Merged/);
});

test("an event that appears in two calendars is kept once", () => {
  const merged = mergeCalendars("Merged", [CALENDAR_A, CALENDAR_B]);

  assert.equal((merged.match(/UID:event-1/g) || []).length, 1);
});

test("the timezone definition travels with the events that reference it", () => {
  const merged = mergeCalendars("Merged", [CALENDAR_A, CALENDAR_B]);

  // Without this, every TZID reference becomes an uninterpretable time.
  assert.equal((merged.match(/BEGIN:VTIMEZONE/g) || []).length, 1);
  assert.match(merged, /TZID:America\/New_York/);
  assert.ok(
    merged.indexOf("BEGIN:VTIMEZONE") < merged.indexOf("BEGIN:VEVENT"),
    "timezones must be declared before the events that use them",
  );
});

test("a folded line is joined before it is matched", () => {
  const folded = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:folded-1",
    "DTSTART;TZID=America/New_York:20260918T235900",
    "SUMMARY:A very long summary that Blackboard",
    "  wrapped across two lines",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const merged = mergeCalendars("Merged", [folded]);

  assert.match(merged, /SUMMARY:A very long summary that Blackboard wrapped across two lines/);
});

test("merging an empty set still produces a valid calendar", () => {
  const merged = mergeCalendars("Nothing", []);

  assert.match(merged, /^BEGIN:VCALENDAR/);
  assert.match(merged, /END:VCALENDAR$/);
  assert.equal((merged.match(/BEGIN:VEVENT/g) || []).length, 0);
});

test("every line ends CRLF, as the format requires", () => {
  const merged = mergeCalendars("Merged", [CALENDAR_A]);

  assert.ok(!/[^\r]\n/.test(merged), "found a bare LF");
});

// ---------------------------------------------------------- the Blackboard side

// These are the real calendar names and records HuskyCT produces, copied from a
// report of the Calendar page with the payload left as it was.
const MATH_NAME =
  "1268-UCONN-MATH-1070Q-SEC100-1191: MATH-1070Q-Mathematics for Business and Economics-SEC100-1268";
const NRE_NAME =
  "1268-UCONN-NRE-1000E-SEC002-3874: NRE-1000E-Environmental Science-SEC002-1268";

const HOMEWORK_RAW = {
  itemSourceType: "blackboard.platform.gradebook2.GradableItem",
  itemSourceId: "_3867211_1",
  calendarNameLocalizable: { rawValue: MATH_NAME },
  title: "Section 4.4 Homework",
  location: null,
  startDate: "2026-09-19T03:59:00.000Z",
  endDate: "2026-09-19T03:59:00.000Z",
};

const LECTURE_RAW = {
  itemSourceType: "blackboard.data.calendar.CalendarEntry",
  itemSourceId: "_1019037_1",
  calendarNameLocalizable: { rawValue: NRE_NAME },
  title: "Environmental Science",
  location: "ARJ 105",
  startDate: "2026-09-14T16:30:00.000Z",
  endDate: "2026-09-14T17:45:00.000Z",
};

test("the course code is read out of the calendar name", () => {
  // The calendar feed's name and the page's own name are parsed by one
  // function; this is the feed's shape.
  assert.equal(courseCodeFromDisplay(MATH_NAME), "MATH 1070Q");
  assert.equal(courseCodeFromDisplay(NRE_NAME), "NRE 1000E");
  assert.equal(courseCodeFromDisplay(null), null);
  assert.equal(courseCodeFromDisplay("nothing useful"), null);
});

test("the record carries the kind BetterHuskyCT already understands", () => {
  const homework = eventToRecord(HOMEWORK_RAW, { allDay: false })!;
  const lecture = eventToRecord(LECTURE_RAW, { allDay: false })!;

  assert.equal(homework.kind, "assignment");
  assert.equal(lecture.kind, "class");
  assert.equal(homework.course, "MATH 1070Q");
  assert.equal(lecture.course, "NRE 1000E");
  assert.equal(lecture.location, "ARJ 105");
  assert.equal(homework.start, "2026-09-19T03:59:00.000Z");

  // The UID has to keep the source type: that substring is how BetterHuskyCT tells
  // a class meeting from a graded item, exactly as it does for a real feed.
  assert.match(homework.uid as string, /\.gradebook2\.GradableItem-/);
  assert.match(lecture.uid as string, /\.calendar\.CalendarEntry-/);
});

test("the exported calendar parses back through BetterHuskyCT's own parser", async () => {
  const records = [
    eventToRecord(HOMEWORK_RAW, { allDay: false })!,
    eventToRecord(LECTURE_RAW, { allDay: false })!,
  ];

  const parsed = await parseCalendar(recordsToIcs(records), new Date("2026-09-13T12:00:00Z"));

  assert.equal(parsed.events.length, 2);

  const homework = parsed.events.find((event) => event.title === "Section 4.4 Homework");
  const lecture = parsed.events.find((event) => event.title === "Environmental Science");

  // The whole point: an assignment arrives with its course attached, which the
  // ICS feed itself never manages.
  assert.equal(homework?.course, "MATH 1070Q");
  assert.equal(homework?.kind, "assignment");
  assert.equal(homework?.start, "2026-09-19T03:59:00.000Z");

  assert.equal(lecture?.course, "NRE 1000E");
  assert.equal(lecture?.kind, "class");
  assert.equal(lecture?.location, "ARJ 105");
});

test("the exported file is a well-formed calendar", () => {
  const ics = recordsToIcs([eventToRecord(HOMEWORK_RAW, { allDay: false })!]);

  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR$/);
  assert.match(ics, /DTSTART:20260919T035900Z/);
  assert.match(ics, /CATEGORIES:MATH 1070Q/);
  assert.ok(!/[^\r]\n/.test(ics), "found a bare LF");
  for (const line of ics.split("\r\n")) {
    assert.ok(line.length <= 75, `line too long: ${line.slice(0, 40)}…`);
  }
});

test("a comma or semicolon in a title cannot break the calendar", () => {
  const ics = recordsToIcs([
    eventToRecord({ ...HOMEWORK_RAW, title: "Reading; chapters 1, 2 & 3" }, { allDay: false })!,
  ]);

  assert.match(ics, /SUMMARY:Reading\\; chapters 1\\, 2 & 3/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});

// ------------------------------------------------- the endpoint recorder

test("the course id is read out of a course URL", () => {
  assert.equal(
    helperAt(
      "https://lms.uconn.edu/ultra/courses/_198430_1/file/_14781043_1",
      "/ultra/courses/_198430_1/file/_14781043_1",
      "https://lms.uconn.edu",
    ).currentCourseId(),
    "_198430_1",
  );

  assert.equal(
    helperAt(
      "https://lms.uconn.edu/ultra/course",
      "/ultra/course",
      "https://lms.uconn.edu",
    ).currentCourseId(),
    null,
  );
});

// ---------------------------------------------------------------- course page
//
// The readers touch the DOM, but the parts that decide what the data means are
// pure, and those are where mistakes would hide.

test("the course code comes out of the name the page displays", () => {
  assert.equal(courseCodeFromDisplay("MATH-1070Q-Mathematics for Business and Economics-SEC100-1268"), "MATH 1070Q");
  assert.equal(courseCodeFromDisplay("NRE-1000E-Environmental Science-SEC002-1268"), "NRE 1000E");
  // The other form on the same page, and the one the calendar feed carries.
  assert.equal(courseCodeFromDisplay("1268-UCONN-MATH-1070Q-SEC100-1191"), "MATH 1070Q");
  assert.equal(courseCodeFromDisplay("no course code here"), null);
  assert.equal(courseCodeFromDisplay(""), null);
  assert.equal(courseCodeFromDisplay(null), null);
});

test("the course title drops the code, the section and the term", () => {
  assert.equal(
    courseTitleFromDisplay("MATH-1070Q-Mathematics for Business and Economics-SEC100-1268"),
    "Mathematics for Business and Economics",
  );
  assert.equal(courseTitleFromDisplay("NRE-1000E-Environmental Science-SEC002-1268"), "Environmental Science");
  assert.equal(courseTitleFromDisplay("not a course name"), null);
});

/**
 * Announcement times are rendered relative to whenever the page was loaded, so
 * they are carried through as words rather than converted into an instant that
 * would already be wrong by the time anyone reads it.
 */
test("an announcement's posted time keeps the page's own wording", () => {
  const row = "Reminder Exam 1 Tuesday September 29th Hi Everyone, Exam 1 11 hours ago, at 12:45 PM";
  assert.equal(postedFromText(row), "11 hours ago, at 12:45 PM");
  assert.equal(postedFromText("Online OH Starting soon 9/17/26, 4:47 PM body text"), "9/17/26, 4:47 PM");
  assert.equal(postedFromText("no timestamp in this text"), null);
});

test("announcements are read from the rows the page renders", () => {
  const row = (title: string, body: string, posted: string) => ({
    querySelector: (selector: string) =>
      selector.includes("title") ? { textContent: title } : selector.includes("detail") ? { textContent: body } : null,
    textContent: title + " " + body + " " + posted,
  });

  const records = collectAnnouncements({
    querySelectorAll: () => [
      row("Virtual Office Hours Today", "Sorry for being late!", "7 hours ago, at 5:31 PM"),
      // A row with no title is not an announcement and must not become one.
      row("", "orphan body", "1 hour ago, at 1:00 PM"),
    ],
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].title, "Virtual Office Hours Today");
  assert.equal(records[0].body, "Sorry for being late!");
  assert.equal(records[0].posted, "7 hours ago, at 5:31 PM");
});

/**
 * Titles come from the accessibility label rather than a class name, because
 * those class names carry build hashes that change with every release.
 */
test("content items are read from their accessibility labels", () => {
  const label = (value: string) => ({ getAttribute: () => value });

  const items = collectContentItems({
    querySelectorAll: () => [
      label("Status for Cengage WebAssign: Started"),
      label("Status for Course Information and Syllabus: Started"),
      // The same title twice must not produce two entries.
      label("Status for Cengage WebAssign: Started"),
      label("Mark as complete"),
      { getAttribute: () => null },
    ],
  });

  // Array.from builds this in the host realm; the array came out of the VM, and
  // a strict deep comparison also checks prototypes.
  assert.deepEqual(
    Array.from(items, (item) => ({ title: item.title, state: item.state })),
    [
      { title: "Cengage WebAssign", state: "Started" },
      { title: "Course Information and Syllabus", state: "Started" },
    ],
  );
});

test("the digest carries the course, its announcements and its content", () => {
  const markdown = courseDigestToMarkdown({
    course: { code: "MATH 1070Q", title: "Mathematics for Business and Economics" },
    source: "/ultra/courses/_203765_1/announcements",
    announcements: [{ title: "Reminder Exam 1", posted: "11 hours ago, at 12:45 PM", body: "Covers Chapter 4." }],
    content: [{ title: "Cengage WebAssign", state: "Started" }],
  });

  assert.match(markdown, /^# MATH 1070Q/);
  assert.match(markdown, /Mathematics for Business and Economics/);
  assert.match(markdown, /## Announcements \(1\)/);
  assert.match(markdown, /### Reminder Exam 1/);
  assert.match(markdown, /Covers Chapter 4\./);
  assert.match(markdown, /## Course content \(1\)/);
  assert.match(markdown, /- Cengage WebAssign {2}\(Started\)/);
});

test("a digest of an empty page still says which course it came from", () => {
  const markdown = courseDigestToMarkdown({
    course: { code: "STAT 1000Q", title: null },
    source: "/ultra/courses/_1_1/outline",
    announcements: [],
    content: [],
  });

  assert.match(markdown, /^# STAT 1000Q/);
  // Nothing collected means no empty section heading claiming otherwise.
  assert.ok(!markdown.includes("## Announcements"));
  assert.ok(!markdown.includes("## Course content"));
});

// --------------------------------------------------------------- to-do panel
//
// The label below is copied from a real HuskyCT to-do item. Parsing it is the
// whole reader: the markup around it carries build hashes, the label does not.

const TODO_LABEL =
  "Section 4.7 Homework, Homework · MATH-1070Q-SEC100.120-1268 · _203765_1, due 9/25/26, 11:59 PM";

test("a to-do item is read out of its accessibility label", () => {
  const todo = todoFromLabel(TODO_LABEL);
  assert.ok(todo, "nothing parsed");

  assert.equal(todo.title, "Section 4.7 Homework");
  assert.equal(todo.kind, "Homework");
  assert.equal(todo.course, "MATH 1070Q");
  assert.equal(todo.courseId, "_203765_1");
  assert.equal(todo.dueText, "9/25/26, 11:59 PM");
});

test("a title containing a comma keeps all of itself", () => {
  const todo = todoFromLabel("Reading, chapters 1-3, Homework · NRE-1000E-Environmental Science-SEC002-1268 · _1_1, due 1/2/27, 12:05 AM");
  assert.ok(todo);
  assert.equal(todo.title, "Reading, chapters 1-3");
  assert.equal(todo.kind, "Homework");
  assert.equal(todo.course, "NRE 1000E");
});

test("a label that is not a to-do item yields nothing", () => {
  assert.equal(todoFromLabel("Mark as complete"), null);
  assert.equal(todoFromLabel("Section 4.7 Homework"), null);
  assert.equal(todoFromLabel(""), null);
});

/**
 * The page gives a wall-clock time with no zone. Building the date from its
 * parts lets the browser read it locally, so the assertions are on the local
 * fields — an ISO string would depend on where the test machine is.
 */
test("a due date is read as local wall-clock time", () => {
  const due = dueDateFromText("9/25/26, 11:59 PM");
  assert.ok(due, "no date parsed");
  assert.equal(due.getFullYear(), 2026);
  assert.equal(due.getMonth(), 8, "September is month 8");
  assert.equal(due.getDate(), 25);
  assert.equal(due.getHours(), 23);
  assert.equal(due.getMinutes(), 59);
});

test("midnight and noon are not swapped", () => {
  const midnight = dueDateFromText("1/2/27, 12:05 AM");
  assert.ok(midnight);
  assert.equal(midnight.getHours(), 0);
  assert.equal(midnight.getMinutes(), 5);

  const noon = dueDateFromText("1/2/27, 12:05 PM");
  assert.ok(noon);
  assert.equal(noon.getHours(), 12);
});

test("a four-digit year is taken as written", () => {
  const due = dueDateFromText("3/4/2027, 9:00 AM");
  assert.ok(due);
  assert.equal(due.getFullYear(), 2027);
});

test("text that is not a date yields nothing", () => {
  assert.equal(dueDateFromText("tomorrow"), null);
  assert.equal(dueDateFromText(""), null);
});

test("collecting the same page twice yields the same deadline once", () => {
  const anchor = (label: string, analytics: string) => ({
    getAttribute: (name: string) => (name === "aria-label" ? label : name === "data-analytics-id" ? analytics : null),
  });

  const todos = collectTodos({
    querySelectorAll: () => [
      anchor(TODO_LABEL, "student-todo.item._3867214_1"),
      // The same item rendered twice — a list view and a preview, say.
      anchor(TODO_LABEL, "student-todo.item._3867214_1"),
      anchor("Mark as complete", ""),
    ],
  });

  assert.equal(todos.length, 1);
  // The application's own id is kept, so exporting twice does not add a second
  // copy of the deadline to BetterHuskyCT.
  assert.equal(todos[0].uid, "huskyct-todo-_3867214_1");
});

test("a to-do without the application's id still gets a stable one", () => {
  const anchor = { getAttribute: (name: string) => (name === "aria-label" ? TODO_LABEL : null) };
  const first = collectTodos({ querySelectorAll: () => [anchor] });
  const second = collectTodos({ querySelectorAll: () => [anchor] });

  assert.equal(first.length, 1);
  assert.ok(String(first[0].uid).startsWith("huskyct-todo-"));
  assert.equal(first[0].uid, second[0].uid, "the fallback id is not stable");
});

/**
 * BetterHuskyCT reads the calendar kind out of the UID, and treats anything that
 * is not a class meeting as a deadline. A to-do is always graded work.
 */
test("a to-do becomes a calendar record BetterHuskyCT reads as a deadline", () => {
  const todos = collectTodos({
    querySelectorAll: () => [
      { getAttribute: (name: string) => (name === "aria-label" ? TODO_LABEL : name === "data-analytics-id" ? "student-todo.item._3867214_1" : null) },
    ],
  });

  const records = todosToRecords(todos);
  assert.equal(records.length, 1);
  assert.equal(records[0].title, "Section 4.7 Homework");
  assert.equal(records[0].course, "MATH 1070Q");
  assert.equal(records[0].kind, "assignment");
  assert.equal(typeof records[0].start, "string", "the writer expects an ISO string");
});

test("the exported to-do calendar parses back through BetterHuskyCT's own parser", async () => {
  const todos = collectTodos({
    querySelectorAll: () => [
      { getAttribute: (name: string) => (name === "aria-label" ? TODO_LABEL : name === "data-analytics-id" ? "student-todo.item._3867214_1" : null) },
    ],
  });

  const ics = recordsToIcs(todosToRecords(todos));
  const parsed = await parseCalendar(ics, new Date("2026-09-20T12:00:00Z"));

  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].title, "Section 4.7 Homework");
  assert.equal(parsed.events[0].course, "MATH 1070Q");
});

test("a title with a comma survives the round trip through the calendar", async () => {
  const label = "Reading, chapters 1-3, Homework · NRE-1000E-Environmental Science-SEC002-1268 · _1_1, due 1/2/27, 12:05 AM";
  const todos = collectTodos({
    querySelectorAll: () => [{ getAttribute: (name: string) => (name === "aria-label" ? label : null) }],
  });

  const parsed = await parseCalendar(recordsToIcs(todosToRecords(todos)), new Date("2026-09-20T12:00:00Z"));
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].title, "Reading, chapters 1-3");
});

/**
 * The course page shows the same announcements the Announcements page does, in
 * a dialog with different class names. Both renderings have to be read, or the
 * course page silently reports having no announcements.
 */
test("announcements are read from the dialog rendering too", () => {
  const card = {
    querySelector: (selector: string) =>
      selector === ".announcement-title-detail"
        ? null
        : selector === ".announcement-title"
          ? { textContent: "Online OH Starting soon" }
          : selector === ".announcement-sent-date"
            ? { textContent: "9/17/26, 4:47 PM" }
            : selector === ".click-message-detail"
              ? null
              : selector === ".body-text.message-entries"
                ? { textContent: "Hi everyone, office hours tonight." }
                : null,
    textContent: "Online OH Starting soon 9/17/26, 4:47 PM Hi everyone, office hours tonight.",
  };

  const records = collectAnnouncements({ querySelectorAll: () => [card] });

  assert.equal(records.length, 1);
  assert.equal(records[0].title, "Online OH Starting soon");
  assert.equal(records[0].posted, "9/17/26, 4:47 PM");
  assert.equal(records[0].body, "Hi everyone, office hours tonight.");
});

test("the same announcement rendered twice is collected once", () => {
  const row = (title: string) => ({
    querySelector: (selector: string) =>
      selector === ".announcement-title-detail"
        ? { textContent: title }
        : selector === ".announcement-sent-date"
          ? { textContent: "9/17/26, 4:47 PM" }
          : selector === ".click-message-detail"
            ? { textContent: "body" }
            : null,
    textContent: title + " 9/17/26, 4:47 PM body",
  });

  const records = collectAnnouncements({ querySelectorAll: () => [row("Same title"), row("Same title")] });
  assert.equal(records.length, 1);
});

/**
 * A folder's name comes from an accessibility label, but only a real anchor
 * carries an address, and a link is what makes an index usable.
 */
test("the files a course links to are read, with their paths", () => {
  const link = (href: string | null, text: string) => ({
    getAttribute: (name: string) => (name === "href" ? href : null),
    textContent: text,
  });

  const files = collectCourseFiles({
    querySelectorAll: () => [
      link("https://lms.uconn.edu/ultra/courses/_203765_1/document/_14409752_1?view=content&state=view", "Course Information and Syllabus"),
      // The same document linked twice must not be listed twice.
      link("https://lms.uconn.edu/ultra/courses/_203765_1/document/_14409752_1?view=content", "Course Information and Syllabus"),
      link("https://lms.uconn.edu/ultra/courses/_203765_1/document/_14409753_1?view=content", "Office Hours"),
      link(null, "no address"),
      link("https://lms.uconn.edu/ultra/courses/_203765_1/document/_14409754_1", ""),
    ],
  });

  assert.deepEqual(
    Array.from(files, (file) => ({ title: file.title, id: file.id, url: file.url })),
    [
      {
        title: "Course Information and Syllabus",
        id: "_14409752_1",
        url: "https://lms.uconn.edu/ultra/courses/_203765_1/document/_14409752_1",
      },
      {
        title: "Office Hours",
        id: "_14409753_1",
        url: "https://lms.uconn.edu/ultra/courses/_203765_1/document/_14409753_1",
      },
    ],
  );
});

/** A query string can carry a token, and none of it is needed to open a file. */
test("a file's query string is dropped", () => {
  const files = collectCourseFiles({
    querySelectorAll: () => [
      {
        getAttribute: (name: string) => (name === "href" ? "/document/_1_1?token=SECRET&x=1#frag" : null),
        textContent: "Syllabus",
      },
    ],
  });

  assert.equal(files.length, 1);
  assert.equal(files[0].url, "/document/_1_1");
  assert.ok(!JSON.stringify(files).includes("SECRET"));
});

test("the digest lists files as links", () => {
  const markdown = courseDigestToMarkdown({
    course: { code: "MATH 1070Q", title: null },
    source: "/ultra/courses/_203765_1/outline",
    announcements: [],
    content: [{ title: "Cengage WebAssign", state: "Started" }],
    files: [{ title: "Course Information and Syllabus", url: "https://lms.uconn.edu/x/document/_1_1" }],
  });

  assert.match(markdown, /## Files \(1\)/);
  assert.match(markdown, /- \[Course Information and Syllabus\]\(https:\/\/lms\.uconn\.edu\/x\/document\/_1_1\)/);
});

// --------------------------------------------------------- sending to BetterHuskyCT
//
// The payload has to satisfy the dashboard's own reader, which drops anything
// that does not match rather than half-applying it. So these assertions run the
// real link through the real reader, not through a description of it.

const TODO_ANCHOR = {
  getAttribute: (name: string) =>
    name === "aria-label"
      ? TODO_LABEL
      : name === "data-analytics-id"
        ? "student-todo.item._3867214_1"
        : null,
};

function collectedRecords() {
  return todosToRecords(collectTodos({ querySelectorAll: () => [TODO_ANCHOR] }));
}

test("a collected deadline becomes a task in the dashboard's own shape", () => {
  const task = taskFromRecord(collectedRecords()[0]);

  // Built from the same local parts the reader uses, not written out as a UTC
  // instant. The page shows wall-clock time with no zone on it, so the instant
  // depends on where the machine is: 11:59 PM is 03:59Z in New York and 23:59Z
  // in London. A hardcoded string passes here and fails on CI, which is UTC.
  const due = new Date(2026, 8, 25, 23, 59, 0, 0);

  assert.equal(task.id, "huskyct-todo-_3867214_1:" + due.toISOString());
  assert.equal(task.title, "Section 4.7 Homework");
  assert.equal(task.course, "MATH 1070Q");
  assert.equal(task.start, due.toISOString());
  assert.equal(task.end, null);
  assert.equal(task.dateKey, null, "a timed entry has no all-day key");
  assert.equal(task.allDay, false);
  assert.equal(task.location, null);
  assert.equal(task.kind, "assignment");
});

/**
 * This is what stops a deadline arriving twice. The dashboard derives a task id
 * as `uid + ":" + start` when it reads a calendar file; the link has to produce
 * the same string or the two paths would both add the same homework.
 */
test("the id matches what the dashboard builds from the calendar file", async () => {
  const records = collectedRecords();
  const parsed = await parseCalendar(recordsToIcs(records), new Date("2026-09-20T12:00:00Z"));

  assert.equal(parsed.events.length, 1);
  assert.equal(taskFromRecord(records[0]).id, parsed.events[0].id);
});

test("the payload says nothing about the parts it did not collect", () => {
  // Through JSON, so the object under test is built in this realm: a strict
  // deep comparison checks prototypes, and the payload comes out of the VM.
  const payload = JSON.parse(JSON.stringify(syncPayload(collectedRecords(), new Date("2026-09-19T12:00:00Z"))));

  assert.equal(payload.version, 1);
  assert.equal(payload.exportedAt, "2026-09-19T12:00:00.000Z");
  assert.equal((payload.feeds as unknown[]).length, 1);
  // Empty means "change nothing" to the merge, which only ever adds courses and
  // unions ticks. Filling these in would be inventing data about the user.
  assert.deepEqual(payload.completedIds, []);
  assert.deepEqual(payload.efforts, {});
  assert.deepEqual(payload.courses, { version: 1, courses: [], assignments: {} });
  // Present and empty rather than absent: the shape this sends should not change
  // with which page the button was pressed on.
  assert.deepEqual(payload.announcements, []);
});

test("the link the panel opens is accepted by the dashboard's own reader", async () => {
  const link = await huskypilotLink(collectedRecords(), new Date("2026-09-19T12:00:00Z"));
  assert.ok(link.startsWith("https://betterhuskyct.vercel.app/#sync="), link.slice(0, 60));

  const packed = link.slice(link.indexOf("#sync=") + "#sync=".length);
  const payload = await decodeSyncPayload(packed);
  assert.ok(payload, "the dashboard would have rejected this link");

  const events = payload.feeds.flatMap((feed) => feed.events);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Section 4.7 Homework");
  assert.equal(events[0].course, "MATH 1070Q");
  assert.equal(events[0].kind, "assignment");
});

test("the same deadlines always produce the same link", async () => {
  const at = new Date("2026-09-19T12:00:00Z");
  assert.equal(await huskypilotLink(collectedRecords(), at), await huskypilotLink(collectedRecords(), at));
});

// ------------------------------------------------------- announcements travel

/** What `collectAnnouncements` hands back, as the panel would pass it on. */
function collectedAnnouncements() {
  return [
    {
      title: "Online OH Starting soon",
      body: "Hi everyone, office hours tonight.",
      posted: "9/17/26, 4:47 PM",
    },
    {
      title: "Midterm moved",
      body: "The midterm moves to the 14th.",
      posted: "7 hours ago, at 5:31 PM",
    },
  ];
}

test("an announcement carries its course by code, because that is what both sides know", () => {
  const candidates = announcementsToCandidates(
    collectedAnnouncements(),
    "MATH 1070Q",
    new Date("2026-09-19T12:00:00Z"),
  );

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].courseCode, "MATH 1070Q");
  assert.equal(candidates[0].title, "Online OH Starting soon");
  assert.equal(candidates[0].body, "Hi everyone, office hours tonight.");
  // The posted time travels as the page's own words, never as a parsed instant.
  assert.equal(candidates[1].posted, "7 hours ago, at 5:31 PM");
});

test("the announced time is when the page was read, so relative prose cannot rot", () => {
  const at = new Date("2026-09-19T12:00:00Z");
  const candidates = announcementsToCandidates(collectedAnnouncements(), "MATH 1070Q", at);

  assert.equal(candidates[0].announced, at.toISOString());
  assert.equal(candidates[1].announced, at.toISOString());
});

test("an announcement with no title is dropped before it reaches the payload", () => {
  const candidates = announcementsToCandidates(
    [{ title: "", body: "orphan", posted: null }, ...collectedAnnouncements()],
    "MATH 1070Q",
  );

  assert.equal(candidates.length, 2);
});

test("a missing body or course becomes null-ish rather than undefined", () => {
  const [candidate] = announcementsToCandidates([{ title: "Only a title" }], null);

  assert.equal(candidate.courseCode, null);
  assert.equal(candidate.body, "");
  assert.equal(candidate.posted, null);
});

test("announcements survive the trip into the dashboard's own reader", async () => {
  const at = new Date("2026-09-19T12:00:00Z");
  const candidates = announcementsToCandidates(collectedAnnouncements(), "MATH 1070Q", at);
  const link = await huskypilotLink(collectedRecords(), at, candidates);

  const packed = link.slice(link.indexOf("#sync=") + "#sync=".length);
  const payload = await decodeSyncPayload(packed);

  assert.ok(payload, "the dashboard would have rejected a link carrying announcements");
  assert.equal(payload.announcements.length, 2);
  assert.equal(payload.announcements[0].title, "Online OH Starting soon");
  // The dashboard computes the id, and it must not depend on the device.
  assert.match(payload.announcements[0].id, /^[0-9a-f]{8}$/);
  assert.equal(payload.announcements[0].courseCode, "MATH 1070Q");
});

test("a term of deadlines plus its announcements still fits in a fragment", async () => {
  const at = new Date("2026-09-19T12:00:00Z");
  const many = [];
  for (let index = 0; index < 120; index += 1) {
    many.push({
      uid: "huskyct-todo-_" + index + "_1",
      title: "Homework set " + index,
      course: "MATH 1070Q",
      start: new Date(Date.UTC(2026, 8, 20 + (index % 30), 3, 59)).toISOString(),
      end: null,
      allDay: false,
      kind: "assignment",
    });
  }

  // A term of announcements with real bodies — the case that could actually
  // overflow the fragment the app reads.
  const announcements = announcementsToCandidates(
    Array.from({ length: 40 }, (_, index) => ({
      title: "Announcement " + index,
      body: "A paragraph of course news. ".repeat(12),
      posted: "9/17/26, 4:47 PM",
    })),
    "MATH 1070Q",
    at,
  );

  const link = await huskypilotLink(many, at, announcements);
  const packed = link.slice(link.indexOf("#sync=") + "#sync=".length);

  assert.ok(packed.length < 32768, "over the dashboard's own guard: " + packed.length);
  const payload = await decodeSyncPayload(packed);
  assert.equal(payload?.feeds.flatMap((feed) => feed.events).length, 120);
  assert.equal(payload?.announcements.length, 40);
});

test("a link for a whole term of deadlines stays well inside what a fragment holds", async () => {
  const many = [];
  for (let index = 0; index < 120; index += 1) {
    many.push({
      uid: "huskyct-todo-_" + index + "_1",
      title: "Homework set " + index,
      course: "MATH 1070Q",
      start: new Date(Date.UTC(2026, 8, 20 + (index % 30), 3, 59)).toISOString(),
      end: null,
      allDay: false,
      kind: "assignment",
    });
  }

  const link = await huskypilotLink(many, new Date("2026-09-19T12:00:00Z"));
  const packed = link.slice(link.indexOf("#sync=") + "#sync=".length);

  assert.ok(packed.length < 32768, "over the dashboard's own guard: " + packed.length);
  const payload = await decodeSyncPayload(packed);
  assert.equal(payload?.feeds.flatMap((feed) => feed.events).length, 120);
});

test("the panel says which button this page wants", () => {
  const withTodo = { querySelector: (selector: string) => (selector.includes(", due ") ? {} : null) };
  const plain = { querySelector: () => null };

  assert.match(guidanceFor(withTodo, null), /Send deadlines to BetterHuskyCT/);
  assert.match(guidanceFor(plain, "_203765_1"), /Collect this course/);
  assert.match(guidanceFor(plain, null), /Courses page/);
});

test("a page with a to-do list wins over being inside a course", () => {
  const withTodo = { querySelector: (selector: string) => (selector.includes(", due ") ? {} : null) };
  assert.match(guidanceFor(withTodo, "_203765_1"), /Send deadlines to BetterHuskyCT/);
});
