import { createHash } from "node:crypto";

import { z } from "zod";

import { MAX_ANNOUNCEMENT_BODY } from "@/lib/announcements";
import { extractPlan, isIsoDay, MAX_PLAN_ITEMS, MAX_PLAN_TEXT, parsePlanAnswer } from "@/lib/plan-models";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";
import { createSummaryCache } from "@/lib/summary-cache";
import { ModelError, providersFromEnv } from "@/lib/summary-models";

export const runtime = "nodejs";
// A syllabus is long: room for one slow answer, a fallback and a retry.
export const maxDuration = 120;

/**
 * A syllabus is read once per course and announcements once each, so a person
 * sends a handful of these after a sync and then none. Four a minute lets that
 * handful through and keeps one person from spending everyone's free quota.
 */
const limiter = createRateLimiter({ windowMs: 60_000, max: 4 });

/**
 * Answers shared by everyone who sends the same source — the students of one
 * course reading one syllabus — keyed by a hash of the request, as summaries are.
 */
const cache = createSummaryCache({
  onError: (command) => console.error("Plan cache failed", { command }),
});

const requestSchema = z
  .object({
    kind: z.enum(["syllabus", "announcements"]),
    courseLabel: z.string().trim().min(1).max(80),
    term: z.string().trim().max(60).nullable(),
    today: z.string().refine(isIsoDay),
    text: z.string().max(MAX_PLAN_TEXT),
    announcements: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(200),
          body: z.string().max(MAX_ANNOUNCEMENT_BODY),
          posted: z.string().max(120).nullable(),
        }),
      )
      .max(40),
    provider: z.enum(["auto", "glm", "gemini", "groq"]).optional(),
  })
  .refine((request) =>
    request.kind === "syllabus"
      ? request.text.trim().length > 0 && request.announcements.length === 0
      : request.announcements.length > 0 && request.text.length === 0,
  );

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

  const { provider: choice = "auto", ...content } = parsed.data;
  // "Today" moves every day but rarely changes what a source says; it is left
  // out of the key so a syllabus read yesterday is not read again today.
  const key = createHash("sha256")
    .update(`plan\u0000${JSON.stringify({ ...content, today: undefined })}` + (choice === "auto" ? "" : `\u0000${choice}`))
    .digest("hex");

  let allowed = providers;
  if (choice !== "auto") {
    allowed = providers.filter((provider) => provider.id === choice);
    if (allowed.length === 0) return json({ problem: "choice-unavailable" }, 422);
    if (!allowed[0].servesCountry(country)) return json({ problem: "region" }, 403);
  }

  const hit = await cache.get(key, geminiAllowed);
  const cached = hit ? parsePlanAnswer(hit.summary, content.announcements.length) : null;
  if (hit && cached) return json({ items: cached, provider: hit.provider });

  const limit = limiter(clientKey(request));
  if (!limit.allowed) {
    return json({ problem: "rate-limited" }, 429, { "Retry-After": String(limit.retryAfterSeconds) });
  }

  try {
    const { items, provider } = await extractPlan(content, {
      providers: allowed,
      country,
      onError: (error) =>
        console.error("Plan model failed", { provider: error.provider, problem: error.problem, status: error.status }),
    });
    const kept = items.slice(0, MAX_PLAN_ITEMS);
    await cache.set(key, JSON.stringify({ items: kept }), provider);
    return json({ items: kept, provider });
  } catch (error) {
    const problem = error instanceof ModelError ? error.problem : "failed";
    if (problem === "busy") return json({ problem: "busy" }, 503, { "Retry-After": "10" });
    if (problem === "refused") return json({ problem: "refused" }, 422);
    return json({ problem: "failed" }, 502);
  }
}
