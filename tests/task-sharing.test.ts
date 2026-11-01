import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskSnapshot, parseTaskSnapshot, type TaskSnapshot } from "../src/lib/task-snapshot.ts";
import { TaskShareStore, taskShareRedis, ShareUnavailable, SHARE_TTL_SECONDS, type RedisCommand } from "../src/lib/task-share-store.ts";
import { handleShareWrite } from "../src/lib/task-share-http.ts";
import { handleTaskMcp } from "../src/lib/task-share-mcp.ts";
import type { CalendarTask } from "../src/lib/calendar-types.ts";

const now = Date.parse("2026-11-01T12:00:00Z");
const task = (id: string, patch: Partial<CalendarTask> = {}): CalendarTask => ({ id, title: "Practice 1", course: "TEST 1000", start: "2026-11-06T17:00:00Z", dateKey: null, end: null, allDay: false, location: "Private room", ...patch });
const snapshot = (): TaskSnapshot => buildTaskSnapshot({ tasks: [task("private-source-id")], doneIds: new Set(), courseFor: () => "TEST 1000", undated: [], sourceImportedAt: "2026-10-31T15:00:00Z", now: new Date(now), timeZone: "America/New_York" });

function memoryRedis() {
  let clock = now;
  let creations = 0;
  const rows = new Map<string, { value: string; expires: number }>();
  const command: RedisCommand = async ([verb, keyValue, ...args]) => {
    const key = String(keyValue);
    for (const [k, row] of rows) if (row.expires <= clock) rows.delete(k);
    if (verb === "GET") return rows.get(key)?.value ?? null;
    if (verb === "SET") {
      if (args.includes("NX") && rows.has(key)) return null;
      rows.set(key, { value: String(args[0]), expires: clock + Number(args[2]) * 1000 }); return "OK";
    }
    if (verb === "EVAL") {
      if (String(keyValue).includes("INCR")) return ++creations;
      const actualKey = String(args[1]);
      const stored = rows.get(actualKey);
      if (!stored) return 0;
      const old = JSON.parse(stored.value);
      if (old.writeHash !== args[2]) return 0;
      if (args[3] === "delete") { rows.delete(actualKey); return 1; }
      old.snapshot = JSON.parse(String(args[4])); old.expiresAt = args[5];
      rows.set(actualKey, { value: JSON.stringify(old), expires: clock + Number(args[6]) * 1000 }); return 1;
    }
    throw new Error("Unexpected Redis command");
  };
  return { rows, command, store: new TaskShareStore(command, () => clock), advance: (ms: number) => { clock += ms; } };
}

test("snapshot allowlist excludes classes, source IDs, locations, notes and unconfirmed suggestions", () => {
  const result = buildTaskSnapshot({ tasks: [task("secret-id"), task("class", { kind: "class" })], doneIds: new Set(["secret-id"]), courseFor: () => "TEST 1000", undated: [{ id: "note-id", title: "Buy supplies", course: null, note: "private note", done: false, addedAt: "2026-11-01" }], sourceImportedAt: null, now: new Date(now), timeZone: "America/New_York" });
  const text = JSON.stringify(result);
  assert.equal(result.tasks.length, 2); assert.equal(result.tasks[0].completed, true);
  for (const secret of ["secret-id", "private note", "Private room", "note-id", "addedAt"]) assert.ok(!text.includes(secret));
  assert.equal(result.tasks[1].dueAt, null);
  assert.throws(() => parseTaskSnapshot({ ...result, grades: [] }));
  assert.throws(() => parseTaskSnapshot({ ...result, tasks: [{ ...result.tasks[0], note: "secret" }] }));
});

test("duplicate completion disagreements remain unknown, including a third matching duplicate", () => {
  const result = buildTaskSnapshot({ tasks: [task("a"), task("b", { title: " Practice  1 " }), task("c")], doneIds: new Set(["a", "c"]), courseFor: () => "TEST 1000", undated: [], sourceImportedAt: null, now: new Date(now), timeZone: "America/New_York" });
  assert.equal(result.tasks.length, 1); assert.equal(result.tasks[0].copies, 3); assert.equal(result.tasks[0].completed, null);
});

test("all-day dates stay on their calendar day across time zones and the DST change", () => {
  const result = buildTaskSnapshot({ tasks: [task("a", { allDay: true, dateKey: "2026-11-01", start: "2026-11-01T00:00:00Z" })], doneIds: new Set(), courseFor: () => null, undated: [], sourceImportedAt: null, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  assert.equal(result.tasks[0].date, "2026-11-01");
  const localDue = new Date(result.tasks[0].dueAt!);
  assert.equal(localDue.getDate(), 1); assert.equal(localDue.getHours(), 23);
});

test("validation rejects excess rows, oversized text, invalid zone and floating timestamps", () => {
  const good = snapshot();
  assert.throws(() => parseTaskSnapshot({ ...good, tasks: Array(501).fill(good.tasks[0]) }));
  assert.throws(() => parseTaskSnapshot({ ...good, tasks: [{ ...good.tasks[0], title: "a".repeat(501) }] }));
  assert.throws(() => parseTaskSnapshot({ ...good, timeZone: "Private/Moon" }));
  assert.throws(() => parseTaskSnapshot({ ...good, capturedAt: "2026-11-01T12:00:00" }));
  assert.throws(() => parseTaskSnapshot({ ...good, tasks: Array(500).fill({ ...good.tasks[0], title: "a".repeat(500) }) }));
});

test("read and write capabilities are separate; revocation cannot be undone by an in-flight update", async () => {
  const redis = memoryRedis(); const share = await redis.store.create(snapshot());
  const raw = [...redis.rows.values()][0].value;
  assert.ok(!raw.includes(share.readToken)); assert.ok(!raw.includes(share.writeToken));
  assert.equal(await redis.store.read(share.id, share.writeToken), null);
  assert.equal(await redis.store.update(share.id, share.readToken, snapshot()), null);
  assert.equal(await redis.store.revoke(share.id, share.readToken), false);
  assert.ok(await redis.store.read(share.id, share.readToken));
  redis.advance(1000); assert.ok(await redis.store.update(share.id, share.writeToken, snapshot()));
  assert.equal(await redis.store.revoke(share.id, share.writeToken), true);
  assert.equal(await redis.store.update(share.id, share.writeToken, snapshot()), null);
  assert.equal(await redis.store.read(share.id, share.readToken), null);
});

test("remote snapshots expire without browser activity", async () => {
  const redis = memoryRedis(); const share = await redis.store.create(snapshot());
  redis.advance(SHARE_TTL_SECONDS * 1000 + 1);
  assert.equal(await redis.store.read(share.id, share.readToken), null);
});

test("shared creation budget bounds storage across publishers", async () => {
  const redis = memoryRedis();
  for (let i = 0; i < 100; i++) await redis.store.create(snapshot());
  await assert.rejects(redis.store.create(snapshot()), /quota reached/);
  assert.equal(redis.rows.size, 100);
});

test("Redis is explicitly enabled and fails closed without leaking provider errors", async () => {
  assert.throws(() => taskShareRedis({}), ShareUnavailable);
  assert.throws(() => taskShareRedis({ BHC_TASK_SHARING_ENABLED: "true", BHC_TASK_REDIS_REST_URL: "http://localhost", BHC_TASK_REDIS_REST_TOKEN: "test" }), ShareUnavailable);
  const command = taskShareRedis({ BHC_TASK_SHARING_ENABLED: "true", BHC_TASK_REDIS_REST_URL: "https://redis.invalid", BHC_TASK_REDIS_REST_TOKEN: "synthetic-token" }, async (_url, init) => {
    assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    return Response.json({ error: "provider-secret-detail" }, { status: 500 });
  });
  await assert.rejects(command(["GET", "test"]), (error: Error) => error.message === "Task sharing is unavailable.");
});

test("publisher rejects cross-origin requests and extra private fields, and returns no-store", async () => {
  const redis = memoryRedis();
  const request = (body: unknown, origin = "https://bhc.invalid") => new Request("https://bhc.invalid/api/task-share", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await handleShareWrite(request(snapshot(), "https://evil.invalid"), undefined, () => redis.store)).status, 403);
  assert.equal((await handleShareWrite(request({ ...snapshot(), cookie: "private" }), undefined, () => redis.store)).status, 400);
  const result = await handleShareWrite(request(snapshot()), undefined, () => redis.store);
  assert.equal(result.status, 201); assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  assert.ok((await result.json()).writeToken);
});

test("MCP initializes, lists only a read-only tool, reads and rejects mutations and bad tokens", async () => {
  const redis = memoryRedis(); const share = await redis.store.create(snapshot());
  const call = async (method: string, params: unknown = {}, token = share.readToken, hasId = true, origin?: string) => handleTaskMcp(new Request("https://bhc.invalid/api/mcp/tasks/test", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", ...(hasId ? { id: 1 } : {}), method, params }) }), share.id, token, () => redis.store);
  assert.equal((await (await call("initialize", { protocolVersion: "2025-11-25" })).json()).result.protocolVersion, "2025-11-25");
  const tools = (await (await call("tools/list")).json()).result.tools;
  assert.deepEqual(tools.map((row: { name: string }) => row.name), ["get_tasks"]); assert.equal(tools[0].annotations.readOnlyHint, true);
  assert.deepEqual((await (await call("tools/call", { name: "get_tasks", arguments: {} })).json()).result.structuredContent.snapshot, snapshot());
  assert.equal((await (await call("tools/call", { name: "delete_tasks" })).json()).error.code, -32602);
  assert.equal((await call("tools/list", {}, share.writeToken)).status, 404);
  assert.equal((await call("tools/list", {}, share.readToken, true, "https://evil.invalid")).status, 403);
  const notification = await call("notifications/initialized", {}, share.readToken, false); assert.equal(notification.status, 202); assert.equal(await notification.text(), "");
});
