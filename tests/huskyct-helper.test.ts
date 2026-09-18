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
  // environment rather than something the code should work around.
  location: {
    href: "https://huskyct.uconn.edu/ultra/course",
    origin: "https://huskyct.uconn.edu",
    pathname: "/ultra/course",
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(SOURCE, sandbox);

const { mergeCalendars, pathOnly, VERSION } = sandbox.__huskyctHelper as HelperSurface;

test("the userscript parses and exposes its helpers", () => {
  assert.equal(typeof mergeCalendars, "function");
  assert.equal(typeof pathOnly, "function");
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test("pathOnly drops the query string, which is where the token lives", () => {
  const href = "https://huskyct.uconn.edu/webapps/calendar/calendar.ics?token=SECRET&x=1#frag";

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
