import { clientKey, createRateLimiter } from "./rate-limit.ts";
import { readRequestText, RequestBodyError } from "./request-body.ts";
import { parseTaskSnapshot, SNAPSHOT_MAX_BYTES } from "./task-snapshot.ts";
import { ShareQuotaExceeded, ShareUnavailable, taskShareRedis, TaskShareStore } from "./task-share-store.ts";

const limit = createRateLimiter({ windowMs: 60000, max: 30 });
export const shareHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
export const shareJson = (body: unknown, status = 200) => Response.json(body, { status, headers: shareHeaders });
export const shareStore = () => new TaskShareStore(taskShareRedis());
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin && request.headers.get("sec-fetch-site") !== "cross-site";
}
export async function handleShareWrite(request: Request, id?: string, storeFactory = shareStore): Promise<Response> {
  if (!sameOrigin(request)) return shareJson({ error: "Same-origin request required." }, 403);
  if (!limit(clientKey(request)).allowed) return shareJson({ error: "Too many requests." }, 429);
  try {
    const store = storeFactory();
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (request.method === "DELETE" && id) {
      return await store.revoke(id, token) ? shareJson({ revoked: true }) : shareJson({ error: "Share not found." }, 404);
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return shareJson({ error: "JSON required." }, 415);
    const snapshot = parseTaskSnapshot(JSON.parse(await readRequestText(request, SNAPSHOT_MAX_BYTES)));
    if (id) {
      const expiresAt = await store.update(id, token, snapshot);
      return expiresAt ? shareJson({ expiresAt }) : shareJson({ error: "Share not found." }, 404);
    }
    return shareJson(await store.create(snapshot), 201);
  } catch (error) {
    return shareJson({ error: error instanceof ShareUnavailable ? "Task sharing is unavailable." : error instanceof ShareQuotaExceeded ? error.message : "Invalid task snapshot." },
      error instanceof ShareUnavailable ? 503 : error instanceof ShareQuotaExceeded ? 429 : error instanceof RequestBodyError ? error.status : 400);
  }
}
