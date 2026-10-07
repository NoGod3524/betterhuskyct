import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarImportResult } from "../src/lib/calendar-types.ts";
import { parseStoredImportPayload, serializeImportPayload } from "../src/lib/import-storage.ts";

/**
 * The calendar a version before subscriptions kept in one key. Nothing writes it now; it is
 * read once, to move it into the subscriptions, so what matters is that it reads back whole,
 * and that a damaged one reads as nothing.
 */
function sampleImport(): CalendarImportResult {
  return {
    calendarName: "HuskyCT",
    importedAt: "2026-09-08T00:00:00.000Z",
    events: [
      {
        id: "event-1",
        title: "Homework 1",
        course: "CSE 2050",
        start: "2026-09-10T14:00:00.000Z",
        dateKey: null,
        end: null,
        allDay: false,
        location: null,
      },
    ],
  };
}

test("a stored calendar reads back whole, and carries no feed URL", () => {
  const stored = serializeImportPayload(sampleImport());
  assert.equal("url" in (JSON.parse(stored) as Record<string, unknown>), false);

  const parsed = parseStoredImportPayload(stored);
  assert.ok(parsed);
  assert.equal(parsed.calendarName, "HuskyCT");
  assert.equal(parsed.events[0].title, "Homework 1");
});

test("a damaged stored calendar reads as nothing", () => {
  assert.equal(parseStoredImportPayload("{not-json"), null);
  assert.equal(parseStoredImportPayload(JSON.stringify({ version: 99, events: [] })), null);
});
