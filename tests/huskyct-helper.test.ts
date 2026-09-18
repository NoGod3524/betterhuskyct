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
  listOf: (body: unknown) => unknown[] | null;
  queryKeys: (url: string) => string;
  cookieNames: () => string[];
  apiTraffic: () => Array<Record<string, unknown>> | null;
  newestApiUrl: () => string | null;
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
  listOf,
  queryKeys,
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

/**
 * A copy of the script running against a stubbed page.
 *
 * `readyState: "loading"` keeps the panel from mounting: these tests exercise
 * the data helpers, and there is no DOM here for a panel to mount into.
 */
function helperWith(page: Record<string, unknown>): HelperSurface {
  const box: Record<string, unknown> = {
    console,
    URL,
    Blob: class {},
    setTimeout,
    clearTimeout,
    navigator: {},
    location: {
      href: "https://lms.uconn.edu/ultra/course",
      origin: "https://lms.uconn.edu",
      pathname: "/ultra/course",
    },
    document: { cookie: "", readyState: "loading", addEventListener() {} },
    ...page,
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(SOURCE, box);

  return box.__huskyctHelper as HelperSurface;
}

/**
 * The diagnosis report exists to be pasted into a chat window, so the only part
 * of a URL it may reproduce is the parameter *names*. A value can be a record
 * id, and it can be a token.
 */
test("queryKeys reports parameter names and never their values", () => {
  const url =
    "https://lms.uconn.edu/learn/api/v1/courses/_198430_1/announcements?limit=20&token=SECRET";

  const keys = queryKeys(url);

  assert.equal(keys, "?limit&token");
  assert.ok(!keys.includes("SECRET"));
  assert.ok(!keys.includes("20"));
});

test("queryKeys keeps a repeated parameter to one name", () => {
  assert.equal(queryKeys("/x?a=1&a=2&b=3"), "?a&b");
});

test("queryKeys says nothing when there is no query string", () => {
  assert.equal(queryKeys("/learn/api/v1/users/me"), "");
});

test("queryKeys survives a URL it cannot parse", () => {
  assert.equal(queryKeys("http://[not a url"), "");
});

/** A cookie value is a session. Only the names may leave the browser. */
test("cookieNames lists names and never their values", () => {
  const helper = helperWith({
    document: {
      cookie: "BbRouter=abc123; JSESSIONID=SECRETSESSION; XSRF-TOKEN=SECRETTOKEN",
      readyState: "loading",
      addEventListener() {},
    },
  });

  const names = helper.cookieNames();

  // Spread first: the array comes from inside the VM realm, and a strict deep
  // comparison checks prototypes, so it would not match a host array.
  assert.deepEqual([...names], ["BbRouter", "JSESSIONID", "XSRF-TOKEN"]);
  assert.ok(!JSON.stringify(names).includes("SECRET"));
});

/**
 * This is the evidence the whole diagnosis rests on: what the page's *own*
 * requests got. If it kept the wrong entries, or leaked a query value while
 * keeping them, the report would mislead in a way that is hard to notice.
 */
test("apiTraffic keeps only Learn API calls, with the status each one got", () => {
  const helper = helperWith({
    performance: {
      getEntriesByType: () => [
        {
          name: "https://lms.uconn.edu/learn/api/v1/users/me?x=1",
          initiatorType: "fetch",
          transferSize: 900,
          responseStatus: 200,
        },
        {
          name: "https://lms.uconn.edu/webapps/calendar/calendar.ics?token=SECRET",
          initiatorType: "xmlhttprequest",
          transferSize: 10,
          responseStatus: 200,
        },
        {
          name: "https://lms.uconn.edu/learn/api/v1/courses/_1/announcements?token=SECRET",
          initiatorType: "fetch",
          transferSize: 50,
          responseStatus: 403,
        },
      ],
    },
  });

  const traffic = helper.apiTraffic();
  assert.ok(traffic, "apiTraffic returned nothing");
  assert.equal(traffic.length, 2, "a non-API request was kept");

  assert.equal(traffic[0].path, "/learn/api/v1/users/me");
  assert.equal(traffic[0].query, "?x");
  assert.equal(traffic[0].status, 200);
  assert.equal(traffic[0].bytes, 900);

  assert.equal(traffic[1].status, 403);
  assert.equal(traffic[1].query, "?token");
  assert.ok(!JSON.stringify(traffic).includes("SECRET"));
});

test("apiTraffic reports nothing rather than guessing when timing is absent", () => {
  assert.equal(helperWith({}).apiTraffic(), null);
});

/**
 * The replay target is the one place a raw URL is needed, and it is handed
 * straight to `fetch`. It must still be the newest Learn API call, or the
 * probe would replay something unrelated and prove nothing.
 */
test("newestApiUrl is the last Learn API call, query and all", () => {
  const helper = helperWith({
    performance: {
      getEntriesByType: () => [
        { name: "https://lms.uconn.edu/learn/api/v1/users/me", responseStatus: 200 },
        { name: "https://lms.uconn.edu/learn/api/v1/courses/_1/announcements?limit=20", responseStatus: 200 },
      ],
    },
  });

  assert.equal(
    helper.newestApiUrl(),
    "https://lms.uconn.edu/learn/api/v1/courses/_1/announcements?limit=20",
  );
  assert.equal(helperWith({}).newestApiUrl(), null);
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

test("listOf reads both shapes Ultra returns", () => {
  assert.deepEqual(listOf([1, 2]), [1, 2]);
  assert.deepEqual(listOf({ results: [1, 2] }), [1, 2]);
  assert.equal(listOf({ items: [] }), null);
  assert.equal(listOf(null), null);
  assert.equal(listOf("nope"), null);
});
