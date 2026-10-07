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
  STRINGS: Record<string, Record<string, string>>;
  LOCALE_KEY: string;
  detectLocale: () => string;
  setLocale: (next: string) => void;
  getLocale: () => string;
  t: (key: string, params?: Record<string, string | number>) => string;
  otherLocale: () => string;
  currentCourseId: () => string | null;
  courseCodeFromDisplay: (value: string | null) => string | null;
  courseTitleFromDisplay: (value: string | null) => string | null;
  postedFromText: (value: string) => string | null;
  collectAnnouncements: (root: unknown) => Array<{ title: string; body: string; posted: string | null }>;
  announcementsToCandidates: (
    records: Array<{ title: string; body?: string; posted?: string | null }>,
    courseCode: string | null,
    now?: Date,
  ) => Array<Record<string, unknown>>;
  todoFromLabel: (label: string) => Record<string, unknown> | null;
  dueDateFromText: (value: string) => Date | null;
  collectTodos: (root: unknown) => Array<Record<string, unknown>>;
  todosToRecords: (todos: Array<Record<string, unknown>>) => Array<Record<string, unknown>>;
  guidanceFor: (scope: unknown, courseId: string | null, pathname?: string) => string;
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

import { decodeSyncPayload } from "../src/lib/sync.ts";

const {
  STRINGS,
  detectLocale,
  setLocale,
  getLocale,
  t,
  otherLocale,
  VERSION,
  courseCodeFromDisplay,
  courseTitleFromDisplay,
  postedFromText,
  collectAnnouncements,
  announcementsToCandidates,
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
  assert.equal(typeof collectAnnouncements, "function");
  assert.equal(typeof huskypilotLink, "function");
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



// ---------------------------------------------------------- the Blackboard side

// These are the real calendar names and records HuskyCT produces, copied from a
// report of the Calendar page with the payload left as it was.
const MATH_NAME =
  "1268-UCONN-MATH-1070Q-SEC100-1191: MATH-1070Q-Mathematics for Business and Economics-SEC100-1268";
const NRE_NAME =
  "1268-UCONN-NRE-1000E-SEC002-3874: NRE-1000E-Environmental Science-SEC002-1268";



test("the course code is read out of the calendar name", () => {
  // The calendar feed's name and the page's own name are parsed by one
  // function; this is the feed's shape.
  assert.equal(courseCodeFromDisplay(MATH_NAME), "MATH 1070Q");
  assert.equal(courseCodeFromDisplay(NRE_NAME), "NRE 1000E");
  assert.equal(courseCodeFromDisplay(null), null);
  assert.equal(courseCodeFromDisplay("nothing useful"), null);
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
  // Effort marks went in BetterHuskyCT 1.23.0; nothing set one, and nothing is sent.
  assert.equal("efforts" in payload, false);
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

test("the panel says what this page is for", () => {
  const withTodo = { querySelector: (selector: string) => (selector.includes(", due ") ? {} : null) };
  const plain = { querySelector: () => null };

  assert.match(guidanceFor(withTodo, null, "/ultra/course"), /reads this to-do list/);
  // The course outline does not show announcements — measured on the live page.
  assert.match(guidanceFor(plain, "_203765_1", "/ultra/courses/_203765_1/outline"), /this one included/);
  assert.match(
    guidanceFor(plain, "_203765_1", "/ultra/courses/_203765_1/announcements"),
    /announcements are in the basket/,
  );
  assert.match(guidanceFor(plain, null, "/ultra/stream"), /brings you back here/);
});

test("the Courses page is recognised in a quiet week, when its to-do list is empty", () => {
  // Measured: the To Do list only shows a week either side of today, and in a
  // quiet week it has no ", due " items at all.
  const plain = { querySelector: () => null };
  assert.match(guidanceFor(plain, null, "/ultra/course"), /reads this to-do list/);
});

test("a page with a to-do list wins over being inside a course", () => {
  const withTodo = { querySelector: (selector: string) => (selector.includes(", due ") ? {} : null) };
  assert.match(
    guidanceFor(withTodo, "_203765_1", "/ultra/courses/_203765_1/outline"),
    /reads this to-do list/,
  );
});

// ------------------------------------------- one button for the page's calendar

/**
 * The panel lives in a template string, which means a mismatch between a button
 * and its handler is invisible: no test builds the panel, so a selector that
 * matches nothing would be a null dereference on every page load rather than a
 * failing assertion. (I hit exactly this while writing the change — a button
 * labelled "Send deadlines…" whose handler compared against `"todos"` — so it is
 * a real mistake here, not a hypothetical.)
 *
 * These check the source for the pairings, which is cheap and catches the ones
 * that mattered.
 */
test("every panel button has a handler, and the labels match", () => {
  const actions = [...SOURCE.matchAll(/data-act="([a-z]+)"/g)].map((match) => match[1]);
  assert.ok(actions.length > 0, "no panel buttons found at all");

  for (const action of actions) {
    // `copy` is handled by its own branch; the rest are compared against `act`.
    assert.match(
      SOURCE,
      new RegExp(`act === "${action}"`),
      `the "${action}" button has no handler`,
    );
  }

  // One-press actions only. The single-page tools — this page's calendar,
  // exporting harvested events, one course's digest — went in 0.17.0: Collect
  // everything and Collect course materials do each of their jobs for every
  // course at once, and having both left the reader to guess which to press.
  for (const gone of ["acquire", "export", "clear", "course", "copy", "merge"]) {
    assert.ok(!actions.includes(gone), `the single-page "${gone}" button is back`);
  }
  // "autosync" switches the quick sync that runs as HuskyCT opens. The quick sync itself is
  // BetterHuskyCT's Sync button now; the panel's own Sync button and the diagnostic went in 1.11.0.
  assert.deepEqual(
    [...new Set(actions)].sort(),
    ["autosync", "collectall", "emptybasket", "todos"],
  );
  // The separate Collect and Send buttons for materials and grades, and Save files, went in 2.0.0:
  // Collect everything and BetterHuskyCT's Sync carry both, and the Materials page saves the files.
  for (const gone of ["sync", "recapi", "materials", "sendmaterials", "savefiles", "grades", "sendgrades"]) assert.ok(!actions.includes(gone), `the "${gone}" button is back`);
});

/**
 * Three panel bugs that were reported, or measured against the live page, pinned
 * so they cannot come back. None of them is visible to a test that only exercises
 * the pure helpers, because all three live in the DOM wiring.
 */
test("closing the panel collapses it instead of deleting it", () => {
  // Reported as "I do not know where to press it": the close button called
  // `host.remove()`, which took every button out of the page for the rest of the
  // session, with nothing to say how to get them back.
  assert.ok(
    !/\.close"\)\.addEventListener\("click",\s*\(\)\s*=>\s*\{\s*host\.remove\(\)/.test(SOURCE),
    "the close button deletes the panel again instead of collapsing it",
  );
  assert.match(SOURCE, /setCollapsed\(true\)/, "closing no longer collapses");
  // The chip is built with `className = "chip"`, not written as markup.
  assert.match(SOURCE, /className = "chip"/, "the way back (the chip) is gone");
  assert.match(SOURCE, /data-collapsed/, "nothing tracks the collapsed state");
});

test("mounting the panel twice leaves one panel", () => {
  // Measured: injecting the shipped script into a live page twice stacked two
  // panels, and the one underneath looked like a broken panel.
  assert.match(
    SOURCE,
    /querySelectorAll\("#huskypilot-helper"\)\.forEach\(\(node\) => node\.remove\(\)\)/,
    "mountPanel no longer clears an existing panel, so it can stack",
  );
});

/**
 * The ordering that broke the panel in 0.14.0, checked specifically.
 *
 * `langButton` is a `const`, so wiring it or calling `relabel()` above its
 * declaration is a temporal-dead-zone ReferenceError at the top of mountPanel —
 * which means the panel never appears at all. That shipped with 262 tests green,
 * because nothing in this file runs mountPanel; the markup is rendered as a
 * string and the pure helpers are called directly. Only injecting the script
 * into a real page caught it.
 *
 * Deliberately specific rather than a general "is this used before it is
 * declared" walk: the general version cannot tell a reference inside a function
 * body (fine, it runs later — `out` in `show()` is one) from a top-level one
 * (a crash). This asserts the one rule that actually broke, which is the one
 * worth keeping.
 */
test("mountPanel's element handles are declared before anything renders", () => {
  const start = SOURCE.indexOf("function mountPanel()");
  assert.ok(start !== -1, "mountPanel is gone");
  const body = SOURCE.slice(start);

  const lastDeclaration = Math.max(
    ...[...body.matchAll(/const\s+[A-Za-z_$][\w$]*\s*=\s*wrap\.querySelector\(/g)].map(
      (match) => match.index ?? 0,
    ),
  );
  assert.ok(Number.isFinite(lastDeclaration), "no element handles found in mountPanel");

  for (const statement of ["langButton.addEventListener", "refreshGuidance()", "\n    relabel();"]) {
    const at = body.indexOf(statement);
    assert.ok(at !== -1, `mountPanel no longer contains: ${statement.trim()}`);
    assert.ok(
      at > lastDeclaration,
      `${statement.trim()} runs before every element handle exists — the TDZ crash that hides the panel`,
    );
  }
});

test("a blocked new tab is reported instead of claimed as success", () => {
  // `window.open` returns null when the popup is blocked, and does so silently.
  // The old code said "Opened BetterHuskyCT" either way, so the reader was told
  // it worked and saw nothing happen.
  assert.match(SOURCE, /const opened = window\.open\(/, "window.open's result is not read");
  assert.match(SOURCE, /blocked the new tab/, "a blocked popup is not reported to the reader");
});

/**
 * The trap that made the check above worthless.
 *
 * `window.open(url, "_blank", "noopener")` returns **null even on success**, so
 * reading the return value is not enough — the *call shape* has to be right, or
 * every successful send is reported as "your browser blocked the new tab". The
 * check above passed while 0.14.0 shipped exactly that, because it only asserted
 * that the value was read.
 *
 * Measured in Chrome 152: `_blank` alone returns an object, `_blank` with
 * `"noopener"` returns null, and both open a window. So the features argument
 * must not carry `noopener`; isolation is done by clearing `opener` afterwards.
 */
test("the popup is opened without the flag that would null the result", () => {
  // Comments have to go first: the explanation above the call names `"noopener"`
  // in prose, and matching that made this test fail on correct code. A check that
  // the surrounding commentary can trip is not checking the code.
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  assert.ok(
    !/window\.open\([^)]*"noopener"/.test(code),
    "window.open is called with noopener, so a successful open returns null and reads as blocked",
  );
  assert.match(
    code,
    /if \(opened\) opened\.opener = null;/,
    "opener is not cleared after opening, so the new tab keeps a handle on this page",
  );
});

/**
 * The panel and the dashboard are on different origins, so neither can read the
 * other's localStorage. What they can do is agree — same key name, same two
 * values, same browser-derived default — and that is what these pin.
 */
test("the panel speaks both languages the dashboard does, with no gaps", () => {
  const en = Object.keys(STRINGS.en);
  const zh = Object.keys(STRINGS["zh-CN"]);

  assert.ok(en.length > 40, "the dictionary looks truncated: " + en.length);
  assert.deepEqual(
    en.filter((key) => !zh.includes(key)),
    [],
    "keys missing from the Chinese dictionary",
  );
  assert.deepEqual(
    zh.filter((key) => !en.includes(key)),
    [],
    "keys in Chinese that English does not have",
  );

  // Every key resolves to something, and never to the key itself — that is what
  // a missing translation looks like at runtime.
  for (const locale of ["en", "zh-CN"]) {
    setLocale(locale);
    for (const key of en) {
      const text = t(key);
      assert.ok(text && text.length > 0, `${locale} has an empty string for ${key}`);
      assert.notEqual(text, key, `${locale} is missing a translation for ${key}`);
    }
  }

  setLocale("en");
});

test("the Chinese dictionary is actually Chinese, not copied English", () => {
  setLocale("zh-CN");
  const samples = [t("sendDeadlines"), t("panelTitle"), t("guideTodo")];
  for (const sample of samples) {
    assert.match(sample, /[\u4e00-\u9fff]/, `not translated: ${sample}`);
  }

  setLocale("en");
  assert.ok(!/[\u4e00-\u9fff]/.test(t("sendDeadlines")), "English picked up Chinese text");
});

test("the language defaults to the browser and is remembered once chosen", () => {
  // The sandbox has no localStorage and a bare navigator, so this exercises the
  // fallback path: no stored choice means ask the browser, and no browser answer
  // means English.
  assert.equal(detectLocale(), "en");

  setLocale("zh-CN");
  assert.equal(getLocale(), "zh-CN");
  setLocale("en");
  assert.equal(getLocale(), "en");

  // A junk value must not become the locale.
  setLocale("klingon");
  assert.equal(getLocale(), "en");
});

test("the switch offers the other language", () => {
  setLocale("en");
  assert.equal(otherLocale(), "zh-CN");
  setLocale("zh-CN");
  assert.equal(otherLocale(), "en");
  setLocale("en");
});

/**
 * The rendered markup in the other language, not just the dictionary.
 *
 * The panel is the one surface I could not reach in a browser (the DevTools
 * connection to the signed-in Edge needs its per-connection approval), so this
 * checks what would actually be written into it: the same template the panel
 * builds, rendered from the dictionary. It is the difference between "the
 * dictionary has Chinese in it" and "the panel shows Chinese".
 */
test("the panel markup renders in Chinese, with nothing left in English", () => {
  const surface = sandbox.__huskyctHelper as HelperSurface & {
    panelMarkup: () => string;
  };
  assert.equal(typeof surface.panelMarkup, "function", "panelMarkup is not exposed");

  surface.setLocale("en");
  const english = surface.panelMarkup();
  const englishLabels = [
    "Collect everything",
    "Send everything to BetterHuskyCT",
    "Clear basket",
  ];
  for (const label of englishLabels) {
    assert.ok(english.includes(label), `the English panel lost: ${label}`);
  }

  surface.setLocale("zh-CN");
  const chinese = surface.panelMarkup();

  // Every translated label must be present in the markup, in Chinese.
  for (const key of ["collectAll", "sendDeadlines", "clearBasket"]) {
    const text = surface.t(key);
    assert.match(text, /[\u4e00-\u9fff]/, `not translated: ${key}`);
    assert.ok(chinese.includes(text), `the rendered panel is missing the translation for ${key}`);
  }

  // And no label that was translated may still be sitting there in English.
  // This is the check that catches a template string somebody forgot to wire up.
  for (const label of englishLabels) {
    assert.ok(!chinese.includes(label), `the Chinese panel still contains: ${label}`);
  }

  surface.setLocale("en");
});

test("the panel leads with the guidance and Collect everything", () => {
  // Anchored on the closing backtick of the template literal, not on the first
  // `</div>` — a comment inside the markup contains one, and slicing there cut
  // the panel down to 291 characters and made this test lie. (It did.)
  const start = SOURCE.indexOf('<div class="body">');
  const end = SOURCE.indexOf("`;", start);
  assert.ok(start !== -1 && end > start, "could not find the panel template");
  const panel = SOURCE.slice(start, end);

  // The guidance first: it is what says which button this page wants, and it
  // used to be the last element in the panel.
  const hintAt = panel.indexOf('data-role="hint"');
  const collectAt = panel.indexOf('data-act="collectall"');
  assert.ok(hintAt !== -1, "the panel lost its hint");
  assert.ok(hintAt < collectAt, "the guidance is not at the top of the panel");

  // Collect everything leads, then Send. Collect is the primary to start with; the
  // panel hands that to Send once the basket has something in it (tested on a
  // mounted panel in helper-basket.test.ts).
  const todosAt = panel.indexOf('data-act="todos"');
  assert.ok(collectAt !== -1 && todosAt !== -1, "the panel lost a button");
  assert.ok(collectAt < todosAt, "the panel's actions are out of order");
  assert.match(panel, /class="act primary" data-act="collectall"/, "Collect everything is not the primary button");
  // One primary in the markup: Collect everything.
  const primaries = [...panel.matchAll(/class="act primary" data-act="([a-z]+)"( hidden)?/g)];
  assert.deepEqual(
    primaries.map((match) => [match[1], Boolean(match[2])]),
    [["collectall", false]],
  );
});
