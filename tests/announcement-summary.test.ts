import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SUMMARY_ANNOUNCEMENTS,
  MAX_SUMMARY_CHARACTERS,
  SUMMARY_ENDPOINT,
  SummaryError,
  buildSummaryRequest,
  newestFirst,
  requestSummary,
  summarySignature,
} from "../src/lib/announcement-summary.ts";
import type { Announcement } from "../src/lib/announcements.ts";

function announcement(n: number, patch: Partial<Announcement> = {}): Announcement {
  return {
    id: `a${n}`,
    courseId: "course-1",
    courseCode: "MATH 1070Q",
    title: `Announcement ${n}`,
    body: `Body of announcement ${n}.`,
    posted: `Posted on 9/${n}/26`,
    // Later n = newer.
    announced: new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString(),
    ...patch,
  };
}

test("a request carries the course's announcements newest first", () => {
  const { request, omitted } = buildSummaryRequest(
    [announcement(1), announcement(3), announcement(2)],
    "MATH 1070Q",
    "zh-CN",
  );

  assert.deepEqual(
    request.announcements.map((item) => item.title),
    ["Announcement 3", "Announcement 2", "Announcement 1"],
  );
  assert.equal(request.courseLabel, "MATH 1070Q");
  assert.equal(request.locale, "zh-CN");
  assert.equal(omitted, 0);
  // Only what the summary needs: no ids, course ids or collection times.
  assert.deepEqual(Object.keys(request.announcements[0]).sort(), ["body", "posted", "title"]);
});

test("a long history is cut to the newest, and says how much was left out", () => {
  const many = Array.from({ length: MAX_SUMMARY_ANNOUNCEMENTS + 5 }, (_, index) => announcement(index + 1));
  const { request, omitted } = buildSummaryRequest(many, "MATH 1070Q", "en");

  assert.equal(request.announcements.length, MAX_SUMMARY_ANNOUNCEMENTS);
  assert.equal(omitted, 5);
  assert.equal(request.announcements[0].title, `Announcement ${MAX_SUMMARY_ANNOUNCEMENTS + 5}`);
});

test("the character budget cuts the oldest, but never the newest", () => {
  const long = (n: number) => announcement(n, { body: "x".repeat(MAX_SUMMARY_CHARACTERS / 2) });
  const { request, omitted } = buildSummaryRequest([long(1), long(2), long(3)], "MATH 1070Q", "en");

  assert.ok(request.announcements.length >= 1);
  assert.equal(request.announcements[0].title, "Announcement 3");
  assert.equal(request.announcements.length + omitted, 3);
  assert.ok(omitted >= 1, "three half-budget announcements all fitted");
});

test("a summary comes back from the endpoint", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ summary: "  - Quiz on Friday.  ", provider: "gemini" });
  };
  const { request } = buildSummaryRequest([announcement(1)], "MATH 1070Q", "en");

  assert.deepEqual(await requestSummary(request, fetchImpl), { text: "- Quiz on Friday.", provider: "gemini" });
  assert.equal(calls[0].url, SUMMARY_ENDPOINT);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), request);
});

test("a provider the page does not know is credited to no one in particular", async () => {
  const { request } = buildSummaryRequest([announcement(1)], "MATH 1070Q", "en");
  const answer = async () => Response.json({ summary: "- ok", provider: "somebody-new" });

  assert.deepEqual(await requestSummary(request, answer), { text: "- ok", provider: null });
});

test("each problem the endpoint names becomes a reason the page can say", async () => {
  const { request } = buildSummaryRequest([announcement(1)], "MATH 1070Q", "en");
  const cases: Array<[Response, string]> = [
    [Response.json({ problem: "busy" }, { status: 503 }), "busy"],
    [Response.json({ problem: "rate-limited" }, { status: 429 }), "rate-limited"],
    [Response.json({ problem: "refused" }, { status: 422 }), "refused"],
    // A server with no key is, to the reader, a feature that isn't there.
    [Response.json({ problem: "not-configured" }, { status: 503 }), "unavailable"],
    [Response.json({ problem: "something-new" }, { status: 500 }), "failed"],
    [Response.json({ summary: "   " }), "failed"],
    // A platform error page instead of the endpoint's JSON.
    [new Response("<html>504</html>", { status: 504 }), "unavailable"],
  ];

  for (const [response, expected] of cases) {
    await assert.rejects(
      requestSummary(request, async () => response),
      (error) => error instanceof SummaryError && error.problem === expected,
      `expected ${expected}`,
    );
  }

  await assert.rejects(
    requestSummary(request, async () => {
      throw new TypeError("Failed to fetch");
    }),
    (error) => error instanceof SummaryError && error.problem === "unavailable",
  );
});

test("a summary is reused only for the same announcements in the same language", () => {
  const two = [announcement(1), announcement(2)];

  assert.equal(summarySignature(two, "en"), summarySignature([...two].reverse(), "en"));
  assert.notEqual(summarySignature(two, "en"), summarySignature([...two, announcement(3)], "en"));
  assert.notEqual(summarySignature(two, "en"), summarySignature(two, "zh-CN"));
  assert.deepEqual(
    newestFirst(two).map((entry) => entry.id),
    ["a2", "a1"],
  );
});
