import type { CalendarImportResult } from "./calendar-types.ts";

/**
 * The page's side of `POST /api/calendar/import`.
 *
 * Taken out of the provider so its failure paths can be tested with a stand-in
 * `fetch`. Those paths are the point: anything that is not this endpoint's own
 * JSON — no connection, or a platform page for a timeout or an oversized body —
 * used to reach the reader as the parser's words ("Failed to fetch",
 * "Unexpected token '<'"), which say neither what happened nor what to do.
 */

export const IMPORT_ENDPOINT = "/api/calendar/import";

/** A link to fetch, or the text of a file the page has already read. */
export type ImportRequest = { url: string } | { ics: string };

/** The caller owns the wording, as everywhere else in `src/lib`. */
export type ImportMessages = {
  /** The endpoint could not be reached, or did not answer with its own JSON. */
  unavailable: string;
  /** The endpoint answered with an error but gave no message of its own. */
  failed: string;
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Imports one calendar, or throws an `Error` whose message is fit to show.
 *
 * The endpoint's own error messages are passed through untouched — they are
 * specific ("returned an error (404)") and already written for a reader.
 */
export async function requestCalendarImport(
  payload: ImportRequest,
  messages: ImportMessages,
  fetchImpl: FetchLike = fetch,
): Promise<CalendarImportResult> {
  let response: Response;
  let result: CalendarImportResult & { error?: string };
  try {
    response = await fetchImpl(IMPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    result = await response.json();
  } catch {
    throw new Error(messages.unavailable);
  }

  if (!response.ok) {
    throw new Error(result.error ?? messages.failed);
  }

  return result;
}
