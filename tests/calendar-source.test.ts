import assert from "node:assert/strict";
import test from "node:test";

import {
  isUsableSourceUrl,
  parseStoredSource,
} from "../src/lib/calendar-source.ts";

const NOW = new Date(2026, 8, 8, 10, 0, 0);
const URL_OK = "https://lms.uconn.edu/webapps/calendar/calendarFeed/abc/learn.ics";

test("isUsableSourceUrl accepts an https feed URL", () => {
  assert.equal(isUsableSourceUrl(URL_OK), true);
  assert.equal(isUsableSourceUrl("  " + URL_OK + "  "), true);
});

test("isUsableSourceUrl rejects anything the importer would refuse", () => {
  assert.equal(isUsableSourceUrl("http://example.com/calendar.ics"), false);
  assert.equal(isUsableSourceUrl("https://user:pass@example.com/a.ics"), false);
  assert.equal(isUsableSourceUrl("not a url"), false);
  assert.equal(isUsableSourceUrl(""), false);
  assert.equal(isUsableSourceUrl("https://example.com/" + "a".repeat(2100)), false);
  assert.equal(isUsableSourceUrl(42), false);
  assert.equal(isUsableSourceUrl(null), false);
});

test("parseStoredSource rejects other versions and non-https URLs", () => {
  assert.equal(
    parseStoredSource(
      JSON.stringify({ version: 99, url: URL_OK, savedAt: NOW.toISOString() }),
    ),
    null,
  );
  assert.equal(
    parseStoredSource(
      JSON.stringify({
        version: 1,
        url: "http://example.com/a.ics",
        savedAt: NOW.toISOString(),
      }),
    ),
    null,
  );
  assert.equal(
    parseStoredSource(JSON.stringify({ version: 1, url: URL_OK, savedAt: "nope" })),
    null,
  );
});

