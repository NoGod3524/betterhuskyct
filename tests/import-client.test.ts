import assert from "node:assert/strict";
import test from "node:test";

import {
  IMPORT_ENDPOINT,
  requestCalendarImport,
  type ImportMessages,
} from "../src/lib/import-client.ts";

const MESSAGES: ImportMessages = {
  unavailable: "The import service could not be reached.",
  failed: "The calendar could not be imported.",
};

const CALENDAR = { calendarName: "MATH 1070Q", importedAt: "2026-09-24T12:00:00.000Z", events: [] };

/** A `fetch` that answers every call with the same response, and records it. */
function answering(make: () => Response) {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const fetchImpl = async (input: string, init: RequestInit) => {
    calls.push({ input, init });
    return make();
  };
  return { fetchImpl, calls };
}

test("a successful import returns the endpoint's calendar", async () => {
  const { fetchImpl, calls } = answering(() => Response.json(CALENDAR));

  const result = await requestCalendarImport({ url: "https://example.edu/a.ics" }, MESSAGES, fetchImpl);

  assert.deepEqual(result, CALENDAR);
  assert.equal(calls[0].input, IMPORT_ENDPOINT);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { url: "https://example.edu/a.ics" });
});

test("a platform error page reads as a sentence, not as the JSON parser", async () => {
  // What a hosting timeout actually returns: HTML with a 504. Parsing it used
  // to put "Unexpected token '<'" in front of the reader.
  const { fetchImpl } = answering(
    () => new Response("<!doctype html><title>504</title>", { status: 504, headers: { "content-type": "text/html" } }),
  );

  await assert.rejects(requestCalendarImport({ ics: "BEGIN:VCALENDAR" }, MESSAGES, fetchImpl), {
    message: MESSAGES.unavailable,
  });
});

test("no connection at all reads as the same sentence", async () => {
  const fetchImpl = async (): Promise<Response> => {
    throw new TypeError("Failed to fetch");
  };

  await assert.rejects(requestCalendarImport({ url: "https://example.edu/a.ics" }, MESSAGES, fetchImpl), {
    message: MESSAGES.unavailable,
  });
});

test("the endpoint's own error message is passed through untouched", async () => {
  const { fetchImpl } = answering(() =>
    Response.json({ error: "The calendar server returned an error (404)." }, { status: 400 }),
  );

  await assert.rejects(requestCalendarImport({ url: "https://example.edu/a.ics" }, MESSAGES, fetchImpl), {
    message: "The calendar server returned an error (404).",
  });
});

test("an error with no message of its own falls back to the caller's wording", async () => {
  const { fetchImpl } = answering(() => Response.json({}, { status: 422 }));

  await assert.rejects(requestCalendarImport({ url: "https://example.edu/a.ics" }, MESSAGES, fetchImpl), {
    message: MESSAGES.failed,
  });
});
