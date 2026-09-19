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
  pathOnly: (href: string) => string;
  describe: (element: unknown) => string;
  calendarLinks: () => Array<[string, string]>;
  courseCodeFrom: (name: string | null) => string | null;
  kindFromSourceType: (type: string) => string | null;
  eventToRecord: (raw: Record<string, unknown>, event: Record<string, unknown>) => Record<string, unknown> | null;
  recordsToIcs: (records: Array<Record<string, unknown>>) => string;
  utcStamp: (iso: string) => string | null;
  recordRequest: (method: string, url: string) => void;
  requestReport: () => string;
  recorded: Set<string>;
  currentCourseId: () => string | null;
  courseCodeFromDisplay: (value: string | null) => string | null;
  courseTitleFromDisplay: (value: string | null) => string | null;
  postedFromText: (value: string) => string | null;
  collectAnnouncements: (root: unknown) => Array<{ title: string; body: string; posted: string | null }>;
  collectContentItems: (root: unknown) => Array<{ title: string; state: string }>;
  courseDigestToMarkdown: (digest: Record<string, unknown>) => string;
  todoFromLabel: (label: string) => Record<string, unknown> | null;
  dueDateFromText: (value: string) => Date | null;
  collectTodos: (root: unknown) => Array<Record<string, unknown>>;
  todosToRecords: (todos: Array<Record<string, unknown>>) => Array<Record<string, unknown>>;
  VERSION: string;
};

const sandbox: Record<string, unknown> = {
  console,
  URL,
  Blob: class {},
  setTimeout,
  clearTimeout,
  navigator: {},
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

const {
  mergeCalendars,
  pathOnly,
  VERSION,
  courseCodeFrom,
  eventToRecord,
  recordsToIcs,
  recordRequest,
  requestReport,
  courseCodeFromDisplay,
  courseTitleFromDisplay,
  postedFromText,
  collectAnnouncements,
  collectContentItems,
  courseDigestToMarkdown,
  todoFromLabel,
  dueDateFromText,
  collectTodos,
  todosToRecords,
} = sandbox.__huskyctHelper as HelperSurface;

test("the userscript parses and exposes its helpers", () => {
  assert.equal(typeof mergeCalendars, "function");
  assert.equal(typeof pathOnly, "function");
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

test("pathOnly drops the query string, which is where the token lives", () => {
  const href = "https://lms.uconn.edu/webapps/calendar/calendar.ics?token=SECRET&x=1#frag";

  assert.equal(pathOnly(href), "/webapps/calendar/calendar.ics");
  assert.ok(!pathOnly(href).includes("SECRET"));
});

test("pathOnly keeps a different origin visible but strips it too", () => {
  assert.equal(
    pathOnly("https://example.com/some/file.ics?token=SECRET"),
    "https://example.com/some/file.ics",
  );
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
  assert.equal(courseCodeFrom(MATH_NAME), "MATH 1070Q");
  assert.equal(courseCodeFrom(NRE_NAME), "NRE 1000E");
  assert.equal(courseCodeFrom(null), null);
  assert.equal(courseCodeFrom("nothing useful"), null);
});

test("the record carries the kind HuskyPilot already understands", () => {
  const homework = eventToRecord(HOMEWORK_RAW, { allDay: false })!;
  const lecture = eventToRecord(LECTURE_RAW, { allDay: false })!;

  assert.equal(homework.kind, "assignment");
  assert.equal(lecture.kind, "class");
  assert.equal(homework.course, "MATH 1070Q");
  assert.equal(lecture.course, "NRE 1000E");
  assert.equal(lecture.location, "ARJ 105");
  assert.equal(homework.start, "2026-09-19T03:59:00.000Z");

  // The UID has to keep the source type: that substring is how HuskyPilot tells
  // a class meeting from a graded item, exactly as it does for a real feed.
  assert.match(homework.uid as string, /\.gradebook2\.GradableItem-/);
  assert.match(lecture.uid as string, /\.calendar\.CalendarEntry-/);
});

test("the exported calendar parses back through HuskyPilot's own parser", async () => {
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

test("a recorded path keeps the route and drops the query string", () => {
  recordRequest(
    "GET",
    "https://lms.uconn.edu/learn/api/public/v1/courses/_200541_1/contents?token=SECRET#frag",
  );

  const report = requestReport();

  assert.match(report, /GET \/learn\/api\/public\/v1\/courses\/_200541_1\/contents/);
  assert.ok(!report.includes("SECRET"), "a token reached the report");
  assert.ok(!report.includes("?"), "a query string reached the report");
});

test("only paths on this site are recorded", () => {
  recordRequest("POST", "https://example.com/tracking?x=1");

  assert.ok(!requestReport().includes("example.com"));
});

test("the same endpoint is listed once, whatever the query", () => {
  recordRequest("GET", "https://lms.uconn.edu/learn/api/public/v1/courses?term=1268");
  recordRequest("GET", "https://lms.uconn.edu/learn/api/public/v1/courses?term=1263");
  recordRequest("GET", "https://lms.uconn.edu/learn/api/public/v1/courses?page=2");

  const hits = requestReport()
    .split("\n")
    .filter((line) => line.trim() === "GET /learn/api/public/v1/courses");

  assert.equal(hits.length, 1);
});

test("the report says so when nothing has been recorded", () => {
  // A fresh sandbox, so the set is empty.
  const fresh = helperAt(
    "https://lms.uconn.edu/ultra/course",
    "/ultra/course",
    "https://lms.uconn.edu",
  );

  assert.match(fresh.requestReport(), /nothing recorded yet/);
});

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
  // copy of the deadline to HuskyPilot.
  assert.equal(todos[0].uid, "huskyct-todo-_3867214_1");
});

test("a to-do without the application's id still gets a stable one", () => {
  const anchor = { getAttribute: (name: string) => (name === "aria-label" ? TODO_LABEL : null) };
  const first = collectTodos({ querySelectorAll: () => [anchor] });
  const second = collectTodos({ querySelectorAll: () => [anchor] });

  assert.equal(first.length, 1);
  assert.ok(first[0].uid.startsWith("huskyct-todo-"));
  assert.equal(first[0].uid, second[0].uid, "the fallback id is not stable");
});

/**
 * HuskyPilot reads the calendar kind out of the UID, and treats anything that
 * is not a class meeting as a deadline. A to-do is always graded work.
 */
test("a to-do becomes a calendar record HuskyPilot reads as a deadline", () => {
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

test("the exported to-do calendar parses back through HuskyPilot's own parser", async () => {
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
