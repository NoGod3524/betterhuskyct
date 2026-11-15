import { PLAN_ENDPOINT } from "./ai-plan.ts";
import { SummaryError, type SummaryProblem } from "./announcement-summary.ts";
import { MAX_PLAN_TEXT, parsePlanResult, type PlanItem, type PlanRequest } from "./plan-models.ts";
import type { SummaryChoice } from "./summary-choice.ts";
import type { ProviderId } from "./summary-models.ts";

/** Sending one source to the app's endpoint, and checking what comes back. */

/** One file's text under its name, so the model knows where one ends; cut to fit. */
export function joinSyllabusTexts(texts: Array<{ name: string; text: string }>): string {
  return texts
    .map(({ name, text }) => `=== ${name} ===\n${text}`)
    .join("\n\n")
    .slice(0, MAX_PLAN_TEXT);
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const KNOWN_PROBLEMS: Record<string, SummaryProblem> = {
  busy: "busy",
  "rate-limited": "rate-limited",
  refused: "refused",
  "not-configured": "unavailable",
  region: "region",
  "choice-unavailable": "choice-unavailable",
};

const PROVIDERS: readonly ProviderId[] = ["glm", "gemini", "groq"];

/**
 * Asks the app's endpoint to read one source. Failures are `SummaryError`s with
 * the same problems as a summary's, since it is the same models behind it.
 */
export async function requestPlan(
  request: PlanRequest,
  fetchImpl: FetchLike = fetch,
  choice: SummaryChoice = "auto",
  signal?: AbortSignal,
): Promise<{ items: PlanItem[]; summary: string | null; provider: ProviderId | null }> {
  const sources = request.announcements.length;
  let response: Response;
  let body: { items?: unknown; summary?: unknown; problem?: unknown; provider?: unknown };
  try {
    response = await fetchImpl(PLAN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(choice === "auto" ? request : { ...request, provider: choice }),
      signal,
    });
    body = await response.json();
  } catch {
    throw new SummaryError("unavailable");
  }
  // Checked again here: what the page keeps should not depend on the server having checked it.
  const locale = request.kind === "syllabus" ? (request.locale ?? "en") : null;
  const result =
    response.ok && Array.isArray(body.items)
      ? parsePlanResult(JSON.stringify({ items: body.items, summary: body.summary }), sources, locale)
      : null;
  if (result) {
    return {
      items: result.items,
      summary: request.kind === "syllabus" ? result.summary : null,
      provider: PROVIDERS.find((id) => id === body.provider) ?? null,
    };
  }
  const problem = typeof body.problem === "string" ? KNOWN_PROBLEMS[body.problem] : undefined;
  throw new SummaryError(problem ?? "failed");
}
