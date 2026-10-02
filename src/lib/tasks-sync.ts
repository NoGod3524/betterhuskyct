/**
 * Deadlines and announcements, delivered straight into BetterHuskyCT, tab to
 * tab — the same `postMessage` route course materials and grades already use,
 * in place of pasting a `#sync=` link and confirming it on a banner.
 *
 * The payload is the sync payload already defined in `sync.ts`; only how it
 * arrives is new. It is still untrusted input from another origin, so it is
 * read with the same strict parser a sync link goes through, and a message
 * that does not fit is dropped whole rather than half-applied.
 */
import { HUSKYCT_ORIGINS } from "@/lib/materials";
import { parseSyncPayloadValue, type SyncPayload } from "@/lib/sync";

/** Bumped only if the messages change shape; both sides check it. */
export const TASKS_PROTOCOL = "betterhuskyct/tasks@1";

export type IncomingTasksMessage =
  | { kind: "hello" }
  | { kind: "sync"; payload: SyncPayload };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A message from the helper, or null. Anything but exactly one of the two kinds is ignored. */
export function parseTasksMessage(data: unknown): IncomingTasksMessage | null {
  if (!isRecord(data) || data.protocol !== TASKS_PROTOCOL) return null;
  if (data.kind === "hello") return { kind: "hello" };
  if (data.kind === "sync") {
    const payload = parseSyncPayloadValue(data.payload);
    return payload ? { kind: "sync", payload } : null;
  }
  return null;
}

type Source = { postMessage(message: unknown, targetOrigin: string): void };
export type TasksEvent = { origin: string; data: unknown; source: Source | null };

/**
 * Answers the helper, one message at a time. Only HuskyCT's origins are heard,
 * and every reply goes back to the exact origin that asked: `hello` is
 * answered with `ready`, and a payload with `stored` once `onSync` has
 * applied it (or failed to), so the helper knows whether to say it arrived.
 *
 * `onSync` applies the payload straight away — there is no confirmation
 * banner on this route, unlike the `#sync=` link, because the student already
 * pressed "Collect everything" and does not need to be asked twice.
 */
export function createTasksReceiver(options: { onSync: (payload: SyncPayload) => boolean }) {
  return function receive(event: TasksEvent): void {
    if (!HUSKYCT_ORIGINS.has(event.origin) || !event.source) return;
    const message = parseTasksMessage(event.data);
    if (!message) return;
    const source = event.source;
    const reply = (body: Record<string, unknown>) =>
      source.postMessage({ protocol: TASKS_PROTOCOL, ...body }, event.origin);

    if (message.kind === "hello") {
      reply({ kind: "ready" });
      return;
    }
    let ok: boolean;
    try {
      ok = options.onSync(message.payload);
    } catch {
      ok = false;
    }
    reply({ kind: "stored", ok });
  };
}
