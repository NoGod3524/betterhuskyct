import type { CalendarTask } from "./calendar-types.ts";
import { isCalendarTask } from "./calendar-task.ts";
import { isRecord } from "./is-record.ts";

export const SUBSCRIPTIONS_STORAGE_KEY = "huskypilot.subscriptions.v1";

/**
 * Keys that earlier versions wrote and nothing reads now: a remembered calendar link, the choice to
 * remember it, and the single calendar of the first versions. The link was a private address, so
 * they are removed when the app opens rather than left behind.
 */
const RETIRED_KEYS = ["huskypilot.rememberSource.v1", "huskypilot.importedCalendar.v1", "huskypilot.calendarSource.v1"];

const SUBSCRIPTIONS_VERSION = 1;

/** More than this stops being a dashboard and becomes a feed reader. */
export const MAX_SUBSCRIPTIONS = 8;

/**
 * One calendar a sync brought, with the events cached here: that is what the app renders.
 *
 * HuskyCT has a feed per course, so a semester can be several subscriptions, not one.
 */
export type Subscription = {
  id: string;
  /** What to call this calendar on screen. */
  name: string | null;
  /** The course this feed belongs to, when the user has said which. */
  courseId: string | null;
  importedAt: string;
  events: CalendarTask[];
};

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function newSubscriptionId(): string {
  const generated = globalThis.crypto?.randomUUID?.();
  if (generated) return generated;
  return `feed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** For a caller building a subscription itself, such as a sync import. */
export const createSubscriptionId = newSubscriptionId;

function parseSubscription(value: unknown): Subscription | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  if (!isValidDateString(value.importedAt)) return null;
  if (!Array.isArray(value.events)) return null;
  if (!value.events.every(isCalendarTask)) return null;

  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : null,
    courseId: typeof value.courseId === "string" ? value.courseId : null,
    importedAt: value.importedAt,
    events: value.events,
  };
}

export function parseStoredSubscriptions(rawValue: string): Subscription[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.version !== SUBSCRIPTIONS_VERSION) return null;
  if (!Array.isArray(parsed.subscriptions)) return null;

  const subscriptions: Subscription[] = [];
  const seen = new Set<string>();
  for (const entry of parsed.subscriptions.slice(0, MAX_SUBSCRIPTIONS)) {
    const subscription = parseSubscription(entry);
    if (!subscription || seen.has(subscription.id)) continue;
    seen.add(subscription.id);
    subscriptions.push(subscription);
  }

  return subscriptions;
}

export function saveSubscriptions(storage: Storage, subscriptions: Subscription[]) {
  storage.setItem(
    SUBSCRIPTIONS_STORAGE_KEY,
    JSON.stringify({
      version: SUBSCRIPTIONS_VERSION,
      subscriptions: subscriptions.slice(0, MAX_SUBSCRIPTIONS),
    }),
  );
}

export function clearSubscriptions(storage: Storage) {
  storage.removeItem(SUBSCRIPTIONS_STORAGE_KEY);
}

export function restoreSubscriptions(storage: Storage): {
  subscriptions: Subscription[];
  recoveredFromCorruptData: boolean;
} {
  for (const key of RETIRED_KEYS) storage.removeItem(key);
  const raw = storage.getItem(SUBSCRIPTIONS_STORAGE_KEY);
  if (!raw) return { subscriptions: [], recoveredFromCorruptData: false };

  const parsed = parseStoredSubscriptions(raw);
  if (parsed) {
    // A calendar saved while links were remembered still holds its address: write it back without.
    if (/"(?:url|lastError)"\s*:/.test(raw)) saveSubscriptions(storage, parsed);
    return { subscriptions: parsed, recoveredFromCorruptData: false };
  }

  clearSubscriptions(storage);
  return { subscriptions: [], recoveredFromCorruptData: true };
}

export function removeSubscription(
  subscriptions: Subscription[],
  id: string,
): Subscription[] {
  return subscriptions.filter((subscription) => subscription.id !== id);
}

export function updateSubscription(
  subscriptions: Subscription[],
  id: string,
  patch: Partial<Omit<Subscription, "id">>,
): Subscription[] {
  return subscriptions.map((subscription) =>
    subscription.id === id ? { ...subscription, ...patch } : subscription,
  );
}

/**
 * Every task on screen, in feed order, with each UID kept once.
 *
 * Two feeds for the same course would otherwise show the same class meeting
 * twice, and a re-import must not double the list.
 */
export function mergeTasks(subscriptions: Subscription[]): CalendarTask[] {
  const merged: CalendarTask[] = [];
  const seen = new Set<string>();

  for (const subscription of subscriptions) {
    for (const task of subscription.events) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      merged.push(task);
    }
  }

  return merged;
}

/**
 * The ticks that still belong to a task on screen.
 *
 * A tick outlives its task in storage — the feed is re-imported without it, or
 * the calendar is removed — and a tick with nothing to tick would still count
 * towards "done" everywhere that counts. Storage keeps it; the screen does not.
 */
export function ticksForTasks(
  ticks: Iterable<string>,
  subscriptions: Subscription[],
): Set<string> {
  const present = new Set(mergeTasks(subscriptions).map((task) => task.id));
  return new Set([...ticks].filter((id) => present.has(id)));
}

/**
 * Which subscription owns each task, so a row's course label can be found.
 *
 * Built once per render pass rather than searched per row: a semester's worth of
 * events across several feeds is small, but a linear scan per task is not free.
 */
export function taskOwnerIndex(
  subscriptions: Subscription[],
): Map<string, string> {
  const owners = new Map<string, string>();

  for (const subscription of subscriptions) {
    for (const task of subscription.events) {
      if (!owners.has(task.id)) owners.set(task.id, subscription.id);
    }
  }

  return owners;
}

/** The most recent successful import, for the sidebar's timestamp. */
export function latestImportAt(subscriptions: Subscription[]): string | null {
  let latest: number | null = null;

  for (const subscription of subscriptions) {
    const at = Date.parse(subscription.importedAt);
    if (Number.isNaN(at)) continue;
    if (latest === null || at > latest) latest = at;
  }

  return latest === null ? null : new Date(latest).toISOString();
}
