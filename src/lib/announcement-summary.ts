import type { Announcement } from "./announcements.ts";
import type { ProviderId, SummaryItem, SummaryLocale, SummaryRequest } from "./summary-models.ts";

/**
 * The page's side of summarising a course's announcements.
 *
 * The summary itself is made by a hosted model behind the app's own endpoint
 * (see `summary-models.ts`), because API keys cannot live in the page. This decides what is
 * sent — newest first, and no more than a summary needs — and turns every way
 * the request can fail into one short reason the page can say.
 */

export const SUMMARY_ENDPOINT = "/api/announcements/summarize";

/** More than this is a term's archive, not what a student needs summarised now. */
export const MAX_SUMMARY_ANNOUNCEMENTS = 30;
/** Roughly 5,000 tokens: plenty for a course, and quick on a free model. */
export const MAX_SUMMARY_CHARACTERS = 20_000;

/** Newest first, so anything cut to fit is the oldest news. */
export function newestFirst(announcements: Announcement[]): Announcement[] {
  return [...announcements].sort((left, right) =>
    left.announced === right.announced ? 0 : left.announced < right.announced ? 1 : -1,
  );
}

function asItem(announcement: Announcement): SummaryItem {
  return {
    title: announcement.title.slice(0, 200),
    body: announcement.body,
    posted: announcement.posted ? announcement.posted.slice(0, 120) : null,
  };
}

function sizeOf(item: SummaryItem): number {
  return item.title.length + item.body.length + (item.posted?.length ?? 0);
}

/**
 * What to send for one course: the newest announcements that fit the caps.
 *
 * `omitted` counts the older ones left out, so the page can say the summary did
 * not read everything rather than implying it did.
 */
export function buildSummaryRequest(
  announcements: Announcement[],
  courseLabel: string,
  locale: SummaryLocale,
): { request: SummaryRequest; omitted: number } {
  const ordered = newestFirst(announcements);
  const items: SummaryItem[] = [];
  let characters = 0;

  for (const announcement of ordered) {
    if (items.length >= MAX_SUMMARY_ANNOUNCEMENTS) break;
    const item = asItem(announcement);
    // The newest one always goes, whatever its size: an announcement's body is
    // already capped when it is stored, so one never overflows the endpoint.
    if (items.length > 0 && characters + sizeOf(item) > MAX_SUMMARY_CHARACTERS) break;
    items.push(item);
    characters += sizeOf(item);
  }

  return {
    request: { courseLabel: courseLabel.slice(0, 80), locale, announcements: items },
    omitted: ordered.length - items.length,
  };
}

/**
 * Why a summary did not come back. The page owns the wording.
 *
 * - `busy`: the free model was serving someone else
 * - `rate-limited`: this person asked too often in the last minute
 * - `refused`: the provider's content filter stopped it
 * - `unavailable`: no connection, or the feature is not set up on this server
 * - `failed`: anything else
 */
export type SummaryProblem = "busy" | "rate-limited" | "refused" | "unavailable" | "failed";

export class SummaryError extends Error {
  readonly problem: SummaryProblem;

  constructor(problem: SummaryProblem) {
    super(problem);
    this.name = "SummaryError";
    this.problem = problem;
  }
}

const KNOWN_PROBLEMS: Record<string, SummaryProblem> = {
  busy: "busy",
  "rate-limited": "rate-limited",
  refused: "refused",
  "not-configured": "unavailable",
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** A summary, and which service wrote it — the page says so under the text. */
export type ReceivedSummary = { text: string; provider: ProviderId | null };

const PROVIDERS: readonly ProviderId[] = ["glm", "gemini"];

export async function requestSummary(
  request: SummaryRequest,
  fetchImpl: FetchLike = fetch,
): Promise<ReceivedSummary> {
  let response: Response;
  let body: { summary?: unknown; problem?: unknown; provider?: unknown };
  try {
    response = await fetchImpl(SUMMARY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    body = await response.json();
  } catch {
    // No connection, or a platform page instead of the endpoint's JSON.
    throw new SummaryError("unavailable");
  }

  if (response.ok && typeof body.summary === "string" && body.summary.trim()) {
    const provider = PROVIDERS.find((id) => id === body.provider) ?? null;
    return { text: body.summary.trim(), provider };
  }
  const problem = typeof body.problem === "string" ? KNOWN_PROBLEMS[body.problem] : undefined;
  throw new SummaryError(problem ?? "failed");
}

/**
 * What a summary was made from — the announcements and the language — so one
 * kept for the session is reused only while both are still the same.
 */
export function summarySignature(announcements: Announcement[], locale: SummaryLocale): string {
  return `${locale}\n${announcements
    .map((announcement) => announcement.id)
    .sort()
    .join("|")}`;
}
