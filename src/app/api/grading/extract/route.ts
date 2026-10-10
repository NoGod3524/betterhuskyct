import { createHash } from "node:crypto";

import { z } from "zod";

import { extractGrading, MAX_GRADING_TEXT, parseGradingResult } from "@/lib/grading-models";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";
import { createSummaryCache } from "@/lib/summary-cache";
import { ModelError, providersFromEnv } from "@/lib/summary-models";

export const runtime = "nodejs";
export const maxDuration = 60;

/** A syllabus is read for its grading once, when a student asks; a few a minute is plenty. */
const limiter = createRateLimiter({ windowMs: 60_000, max: 4 });

/** Shared by everyone who sends the same syllabus text, kept for a term, as the plan's are. */
const cache = createSummaryCache({
  onError: (command) => console.error("Grading cache failed", { command }),
  ttlSeconds: 120 * 24 * 60 * 60,
});

const requestSchema = z.object({
  courseLabel: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(MAX_GRADING_TEXT),
});

const MAX_BODY_LENGTH = 150_000;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(request: Request) {
  const providers = providersFromEnv(process.env);
  if (providers.length === 0) return json({ problem: "not-configured" }, 503);

  const raw = await request.text();
  if (raw.length > MAX_BODY_LENGTH) return json({ problem: "invalid" }, 413);

  let parsed;
  try {
    parsed = requestSchema.safeParse(JSON.parse(raw));
  } catch {
    return json({ problem: "invalid" }, 400);
  }
  if (!parsed.success) return json({ problem: "invalid" }, 400);

  const country = request.headers.get("x-vercel-ip-country");
  const geminiAllowed = providers.some((provider) => provider.id === "gemini" && provider.servesCountry(country));
  const key = createHash("sha256").update(`grading\u0000${JSON.stringify(parsed.data)}`).digest("hex");

  const hit = await cache.get(key, geminiAllowed);
  const cached = hit ? parseGradingResult(hit.summary) : null;
  if (hit && cached) return json({ ...cached, provider: hit.provider });

  const limit = limiter(clientKey(request));
  if (!limit.allowed) return json({ problem: "rate-limited" }, 429, { "Retry-After": String(limit.retryAfterSeconds) });

  try {
    const { parts, note, provider } = await extractGrading(parsed.data, {
      providers,
      country,
      onError: (error) =>
        console.error("Grading model failed", { provider: error.provider, problem: error.problem, status: error.status }),
    });
    await cache.set(key, JSON.stringify({ parts, note }), provider);
    return json({ parts, note, provider });
  } catch (error) {
    const problem = error instanceof ModelError ? error.problem : "failed";
    if (problem === "busy") return json({ problem: "busy" }, 503, { "Retry-After": "10" });
    if (problem === "refused") return json({ problem: "refused" }, 422);
    return json({ problem: "failed" }, 502);
  }
}
