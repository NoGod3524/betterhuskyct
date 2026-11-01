import { createHash, randomBytes } from "node:crypto";
import { parseTaskSnapshot, type TaskSnapshot } from "./task-snapshot.ts";

export const SHARE_TTL_SECONDS = 7 * 24 * 60 * 60;
const PREFIX = "bhc:task-share:v1:";
export type ShareCredentials = { id: string; readToken: string; writeToken: string; expiresAt: string };
type StoredShare = { readHash: string; writeHash: string; expiresAt: string; snapshot: TaskSnapshot };
export type RedisCommand = (command: (string | number)[]) => Promise<unknown>;
export class ShareUnavailable extends Error { constructor() { super("Task sharing is unavailable."); } }
export class ShareQuotaExceeded extends Error { constructor() { super("Daily task-share creation quota reached."); } }
export const validShareId = (value: string) => /^[a-f0-9]{32}$/.test(value);
export const validShareToken = (value: string) => /^[a-f0-9]{64}$/.test(value);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Dedicated, server-only storage. No memory fallback: revocation must survive cold starts. */
export function taskShareRedis(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): RedisCommand {
  if (env.BHC_TASK_SHARING_ENABLED !== "true" || !env.BHC_TASK_REDIS_REST_URL || !env.BHC_TASK_REDIS_REST_TOKEN) throw new ShareUnavailable();
  let url: URL;
  try { url = new URL(env.BHC_TASK_REDIS_REST_URL); } catch { throw new ShareUnavailable(); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new ShareUnavailable();
  return async (command) => {
    try {
      const response = await fetchImpl(url.toString(), { method: "POST", headers: {
        Authorization: `Bearer ${env.BHC_TASK_REDIS_REST_TOKEN}`, "Content-Type": "application/json",
      }, body: JSON.stringify(command), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new ShareUnavailable();
      const value = await response.json();
      if (!value || typeof value !== "object" || !("result" in value) || "error" in value) throw new ShareUnavailable();
      return value.result;
    } catch { throw new ShareUnavailable(); }
  };
}

/** Compare and mutate in one Redis operation; an in-flight update cannot resurrect a revoked link. */
const MUTATE = `local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local old = cjson.decode(raw)
if old.writeHash ~= ARGV[1] then return 0 end
if ARGV[2] == 'delete' then redis.call('DEL', KEYS[1]); return 1 end
old.snapshot = cjson.decode(ARGV[3])
old.expiresAt = ARGV[4]
redis.call('SET', KEYS[1], cjson.encode(old), 'EX', ARGV[5])
return 1`;

export class TaskShareStore {
  private readonly command: RedisCommand;
  private readonly now: () => number;
  constructor(command: RedisCommand, now: () => number = Date.now) { this.command = command; this.now = now; }
  async create(snapshot: TaskSnapshot): Promise<ShareCredentials> {
    const safeSnapshot = parseTaskSnapshot(snapshot);
    // A shared ceiling also bounds storage on serverless hosts with many warm instances.
    const budget = await this.command(["EVAL", "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 86400) end; return n", 1,
      PREFIX + "create-budget:" + Math.floor(this.now() / 86400000)]);
    if (typeof budget !== "number" || !Number.isFinite(budget)) throw new ShareUnavailable();
    if (budget > 100) throw new ShareQuotaExceeded();
    const id = randomBytes(16).toString("hex");
    const readToken = randomBytes(32).toString("hex");
    const writeToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(this.now() + SHARE_TTL_SECONDS * 1000).toISOString();
    const record: StoredShare = { readHash: hash(readToken), writeHash: hash(writeToken), expiresAt, snapshot: safeSnapshot };
    if (await this.command(["SET", PREFIX + id, JSON.stringify(record), "EX", SHARE_TTL_SECONDS, "NX"]) !== "OK") throw new ShareUnavailable();
    return { id, readToken, writeToken, expiresAt };
  }
  async read(id: string, token: string): Promise<{ snapshot: TaskSnapshot; expiresAt: string } | null> {
    if (!validShareId(id) || !validShareToken(token)) return null;
    const raw = await this.command(["GET", PREFIX + id]);
    if (raw === null) return null;
    try {
      if (typeof raw !== "string") throw new ShareUnavailable();
      const value = JSON.parse(raw) as StoredShare;
      if (value.readHash !== hash(token) || Date.parse(value.expiresAt) <= this.now()) return null;
      if (!Number.isFinite(Date.parse(value.expiresAt))) throw new ShareUnavailable();
      return { snapshot: parseTaskSnapshot(value.snapshot), expiresAt: value.expiresAt };
    } catch { throw new ShareUnavailable(); }
  }
  async update(id: string, token: string, snapshot: TaskSnapshot): Promise<string | null> {
    if (!validShareId(id) || !validShareToken(token)) return null;
    const expiresAt = new Date(this.now() + SHARE_TTL_SECONDS * 1000).toISOString();
    const result = await this.command(["EVAL", MUTATE, 1, PREFIX + id, hash(token), "update", JSON.stringify(parseTaskSnapshot(snapshot)), expiresAt, SHARE_TTL_SECONDS]);
    return result === 1 ? expiresAt : null;
  }
  async revoke(id: string, token: string): Promise<boolean> {
    if (!validShareId(id) || !validShareToken(token)) return false;
    return await this.command(["EVAL", MUTATE, 1, PREFIX + id, hash(token), "delete"]) === 1;
  }
}
