import { createHash } from "node:crypto";

import { z } from "zod";

import { MAX_ANNOUNCEMENT_BODY } from "@/lib/announcements";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";
import {
  ModelError,
  providersFromEnv,
  summarizeAnnouncements,
  type ProviderId,
} from "@/lib/summary-models";

export const runtime = "nodejs";
// Room for a fallback and one retry, each inside the 30 s model timeout.
export const maxDuration = 60;

/**
 * Model calls spend free quota shared by everyone, so each person is rationed.
 * Six a minute is plenty for clicking through one's courses. Answers from the
 * cache below cost nothing and are not counted.
 */
const limiter = createRateLimiter({ windowMs: 60_000, max: 6 });

/**
 * Summaries made recently, shared between everyone who sends the same
 * announcements — in practice, the students of one course. Keyed by a hash of
 * the request, so only someone who already holds those exact announcements can
 * get the summary. In memory only, for a few hours, never written anywhere.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { summary: string; provider: ProviderId; at: number }>();

function cached(key: string, geminiAllowed: boolean) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // A Gemini free-tier answer is not handed to a reader Gemini's terms exclude.
  if (entry.provider === "gemini" && !geminiAllowed) return null;
  // Most recently used last, so the oldest is evicted first.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function remember(key: string, summary: string, provider: ProviderId) {
  cache.set(key, { summary, provider, at: Date.now() });
  while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

/** What the page may send. The page trims to fit; this refuses what it would not send. */
const requestSchema = z.object({
  courseLabel: z.string().trim().min(1).max(80),
  locale: z.enum(["en", "zh-CN"]),
  announcements: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        body: z.string().max(MAX_ANNOUNCEMENT_BODY),
        posted: z.string().max(120).nullable(),
      }),
    )
    .min(1)
    .max(40),
});

const MAX_BODY_LENGTH = 100_000;

/** Answers carry a `problem` code, never prose: the page owns the wording. */
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

  // Vercel's own header; absent elsewhere, which counts as "unknown".
  const country = request.headers.get("x-vercel-ip-country");
  const geminiAllowed = providers.some((provider) => provider.id === "gemini" && provider.servesCountry(country));
  const key = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");

  const hit = cached(key, geminiAllowed);
  if (hit) return json({ summary: hit.summary, provider: hit.provider });

  const limit = limiter(clientKey(request));
  if (!limit.allowed) {
    return json({ problem: "rate-limited" }, 429, { "Retry-After": String(limit.retryAfterSeconds) });
  }

  try {
    const { text, provider } = await summarizeAnnouncements(parsed.data, {
      providers,
      country,
      // The provider and status only: the announcements themselves are never logged.
      onError: (error) =>
        console.error("Summary model failed", {
          provider: error.provider,
          problem: error.problem,
          status: error.status,
        }),
    });
    remember(key, text, provider);
    return json({ summary: text, provider });
  } catch (error) {
    const problem = error instanceof ModelError ? error.problem : "failed";
    if (problem === "busy") return json({ problem: "busy" }, 503, { "Retry-After": "5" });
    if (problem === "refused") return json({ problem: "refused" }, 422);
    return json({ problem: "failed" }, 502);
  }
}
