import { z } from "zod";

import type { ProviderId } from "./summary-models.ts";

const TTL_SECONDS = 6 * 60 * 60;
const MAX_ENTRIES = 500;
const TIMEOUT_MS = 1_000;
const PREFIX = "betterhuskyct:summary:v1:";

const entrySchema = z.object({
  // A plan answer (dates and a syllabus summary, as JSON) runs longer than a summary.
  summary: z.string().trim().min(1).max(64_000),
  provider: z.enum(["glm", "gemini", "groq"]),
  at: z.number().int().nonnegative(),
});
type Entry = z.infer<typeof entrySchema>;

/** Only server environment variables: no credentials ever reach the page. */
function connection(env: Record<string, string | undefined>) {
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!env.UPSTASH_REDIS_REST_URL || !token) return null;
  try {
    const url = new URL(env.UPSTASH_REDIS_REST_URL);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return { url: url.href, token };
  } catch {
    return null;
  }
}

/**
 * The existing per-instance cache, with an optional Upstash layer for cold
 * instances. Redis sees only a request hash and the derived summary, never
 * the original announcements. Cache failures leave model requests working.
 */
export function createSummaryCache(options: {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onError?: (command: "GET" | "SET") => void;
  /** How long an answer is kept; six hours unless said otherwise. */
  ttlSeconds?: number;
} = {}) {
  const ttlSeconds = options.ttlSeconds ?? TTL_SECONDS;
  const local = new Map<string, Entry>();
  const now = options.now ?? Date.now;

  function usable(entry: Entry, geminiAllowed: boolean) {
    const age = now() - entry.at;
    return age >= 0 && age < ttlSeconds * 1_000 && (entry.provider !== "gemini" || geminiAllowed);
  }

  function keep(key: string, entry: Entry) {
    // Most recently used last. A remote hit keeps its original generation time.
    local.delete(key);
    local.set(key, entry);
    while (local.size > MAX_ENTRIES) local.delete(local.keys().next().value!);
  }

  async function command(args: ["GET" | "SET", ...(string | number)[]]): Promise<unknown> {
    const config = connection(options.env ?? process.env);
    if (!config) return null;
    try {
      const response = await (options.fetchImpl ?? fetch)(config.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error("cache-unavailable");
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || "error" in body || !("result" in body)) {
        throw new Error("cache-unavailable");
      }
      return body.result;
    } catch {
      // Never log the Redis URL, token, response text or cached content.
      options.onError?.(args[0]);
      return null;
    }
  }

  return {
    async get(key: string, geminiAllowed: boolean): Promise<Entry | null> {
      const hit = local.get(key);
      if (hit && usable(hit, geminiAllowed)) {
        keep(key, hit);
        return hit;
      }
      if (hit) local.delete(key);

      const stored = await command(["GET", PREFIX + key]);
      if (typeof stored !== "string") return null;
      try {
        const parsed = entrySchema.safeParse(JSON.parse(stored));
        if (!parsed.success || !usable(parsed.data, geminiAllowed)) return null;
        keep(key, parsed.data);
        return parsed.data;
      } catch {
        return null;
      }
    },

    async set(key: string, summary: string, provider: ProviderId): Promise<void> {
      const entry = { summary, provider, at: now() };
      keep(key, entry);
      // Await the bounded write: serverless work can stop once the response is sent.
      await command(["SET", PREFIX + key, JSON.stringify(entry), "EX", ttlSeconds]);
    },
  };
}
