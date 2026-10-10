import { SummaryError, type SummaryProblem } from "./announcement-summary.ts";
import { parseGradingResult, type GradingResult } from "./grading-models.ts";

export const GRADING_ENDPOINT = "/api/grading/extract";

const KNOWN: Record<string, SummaryProblem> = {
  "not-configured": "unavailable",
  busy: "busy",
  "rate-limited": "rate-limited",
  refused: "refused",
  region: "region",
  failed: "failed",
};

/**
 * Asks the app's endpoint to read how a syllabus grades the course. Failures are `SummaryError`s
 * with the same problems a summary's are, since the same models are behind it. The answer is
 * checked again here, so what the page shows does not depend on the server having checked it.
 */
export async function requestGrading(
  request: { courseLabel: string; text: string },
  fetchImpl: (input: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<GradingResult> {
  let response: Response;
  let body: { parts?: unknown; note?: unknown; problem?: unknown };
  try {
    response = await fetchImpl(GRADING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    body = await response.json();
  } catch {
    throw new SummaryError("unavailable");
  }
  const result = response.ok && Array.isArray(body.parts) ? parseGradingResult(JSON.stringify({ parts: body.parts, note: body.note })) : null;
  if (result) return result;
  const problem = typeof body.problem === "string" ? KNOWN[body.problem] : undefined;
  throw new SummaryError(problem ?? "failed");
}
