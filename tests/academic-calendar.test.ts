import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

import { GET } from "../src/app/api/academic-calendar/route.ts";
import {
  academicByDay,
  importanceOf,
  parseAcademicCalendar,
  parseAcademicEvents,
  resolveDay,
  resolveRange,
  shortTitle,
} from "../src/lib/academic-calendar.ts";

/** The Registrar's 2026-27 tables as they were on 2026-10-05. */
const PAGE = readFileSync(new URL("./fixtures/registrar-academic-calendar-2026-27.html", import.meta.url), "utf8");
const events = parseAcademicCalendar(PAGE);
const find = (title: string) => events.filter((event) => event.title === title);

test("the weekday written beside a date picks its year, so January in a fall table is next year's", () => {
  assert.equal(resolveDay("Mon, Aug 31", 2026), "2026-08-31");
  assert.equal(resolveDay("Mon, Jan 4", 2026), "2027-01-04");
  assert.equal(resolveDay("Fri, June 11", 2027), "2027-06-11");
  assert.equal(resolveDay("Wed, Aug 31", 2026), null, "a weekday no nearby year has was given a date");
  assert.equal(resolveDay("TBA", 2026), null);
  assert.deepEqual(resolveRange("Sun, Nov 22-Sun, Nov 29", 2026), { start: "2026-11-22", end: "2026-11-29" });
  assert.equal(resolveRange("Sun, Nov 29-Sun, Nov 22", 2026), null, "a range ending before it starts");
});

test("the real page reads as the term's breaks, deadlines and finals, with their days", () => {
  assert.deepEqual(
    find("Thanksgiving Recess").map((event) => [event.start, event.end, event.importance, event.term]),
    [["2026-11-22", "2026-11-29", "major", "Fall 2026"]],
  );
  assert.deepEqual(find("Fall semester begins").map((event) => event.start), ["2026-08-31"]);
  assert.deepEqual(find("Spring Recess").map((event) => [event.start, event.end]), [["2027-03-14", "2027-03-21"]]);
  assert.deepEqual(find("Final examinations").map((event) => [event.start, event.end]), [["2027-05-03", "2027-05-08"]]);
  assert.deepEqual(
    find("Last day to add or drop courses").map((event) => event.start),
    ["2026-09-14", "2027-02-01"],
    "the add/drop deadline was not named for what it is",
  );
});

test("a date cell spanning two rows gives its date to both", () => {
  const nov16 = events.filter((event) => event.start === "2026-11-16").map((event) => event.title);
  assert.equal(nov16.length, 2, nov16.join(" | "));
  assert.ok(nov16.some((title) => /withdraw/i.test(title)));
  assert.ok(nov16.some((title) => /Pass\/Fail/.test(title)));
});

test("dates for degree candidates and staff are left out, and registration is a quiet one", () => {
  const all = events.map((event) => event.detail).join("\n");
  for (const missing of [/thesis/i, /degree audit/i, /conferral/i, /grades due/i, /credit by examination/i, /signature required/i]) {
    assert.doesNotMatch(all, missing);
  }
  const registration = events.find((event) => /^Registration for the Winter 2027/.test(event.title));
  assert.equal(registration?.importance, "minor");
  assert.doesNotMatch(registration?.title ?? "", /Student Administration System/);
});

test("what counts as major is what a term is planned around", () => {
  assert.equal(importanceOf("Labor Day – No classes"), "major");
  assert.equal(importanceOf("Last day to withdraw from a course"), "major");
  assert.equal(importanceOf("Commencement ceremonies"), "major");
  assert.equal(importanceOf("Deadline to apply for Summer 2027 graduation to be included in the 2027 Commencement Book"), "minor");
  assert.equal(importanceOf("Semester grades due at 4 pm"), null);
  assert.equal(shortTitle("Tenth day of classes. Courses dropped after this date … Last day to add or drop courses"), "Last day to add or drop courses");
});

test("a page that is not the calendar reads as nothing, not as made-up dates", () => {
  assert.deepEqual(parseAcademicCalendar("<html><body><h3>Fall 2026</h3><p>Coming soon</p></body></html>"), []);
  assert.deepEqual(parseAcademicCalendar(""), []);
});

test("a range covers each of its days and no more", () => {
  const byDay = academicByDay(find("Thanksgiving Recess"));
  assert.deepEqual([...byDay.keys()], ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
});

test("events handed over are checked, and anything malformed is dropped", () => {
  const good = events[0];
  assert.deepEqual(parseAcademicEvents([good, { ...good, start: "2026-13-01" }, { ...good, end: "2026-01-01" }, { ...good, importance: "huge" }, "x"]), [good]);
  assert.deepEqual(parseAcademicEvents(null), []);
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the endpoint reads the Registrar's page and serves it to everyone", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    return new Response(PAGE, { status: 200 });
  }) as typeof fetch;

  const response = await GET();
  const body = await response.json();
  assert.equal(body.source, "registrar");
  assert.equal(body.events.length, events.length);
  assert.deepEqual(asked, ["https://registrar.uconn.edu/academic-calendar/"]);
  assert.match(response.headers.get("Cache-Control") ?? "", /s-maxage=86400/);
});

test("when the page cannot be read, or reads as almost nothing, the saved copy is served and says so", async () => {
  for (const answer of [
    async () => {
      throw new Error("offline");
    },
    async () => new Response("down", { status: 503 }),
    async () => new Response("<h3>Fall 2026</h3><table><tr><td>Mon, Aug 31</td><td>Fall semester begins</td></tr></table>"),
  ]) {
    globalThis.fetch = answer as unknown as typeof fetch;
    const body = await (await GET()).json();
    assert.equal(body.source, "snapshot");
    assert.ok(body.events.length >= 20, "the saved copy is not the year's calendar");
  }
});
