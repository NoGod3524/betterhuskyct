import type { CalendarTask } from "./calendar-types.ts";
import {
  IMPORT_STORAGE_KEY,
  isCalendarTask,
  parseStoredImportPayload,
} from "./import-storage.ts";
import {
  CALENDAR_SOURCE_STORAGE_KEY,
  parseStoredSource,
} from "./calendar-source.ts";

export const SUBSCRIPTIONS_STORAGE_KEY = "huskypilot.subscriptions.v1";

/**
 * Whether new links should be remembered. A preference, not a secret: the URLs
 * themselves live inside the subscriptions that were added while it was on.
 */
export const REMEMBER_SOURCE_KEY = "huskypilot.rememberSource.v1";

const SUBSCRIPTIONS_VERSION = 1;

/** More than this stops being a dashboard and becomes a feed reader. */
export const MAX_SUBSCRIPTIONS = 8;

/**
 * One calendar the user added, from a link or from a downloaded `.ics` file.
 *
 * HuskyCT issues a feed per course, so a semester is several subscriptions, not
 * one. The events are cached here — that is what the app actually renders — and
 * the URL is kept only when the user opted in to remembering it, which is what
 * makes a refresh possible on the next visit.
 */
export type Subscription = {
  id: string;
  /**
   * What to call this calendar on screen. A file import is named after the file
   * — five Blackboard exports all announce themselves as "University of
   * Connecticut", which is no help at all — and a link import after the feed's
   * own `X-WR-CALNAME`.
   */
  name: string | null;
  /** The course this feed belongs to, when the user has said which. */
  courseId: string | null;
  /** `null` when the user chose not to remember this link. */
  url: string | null;
  importedAt: string;
  /** The last refresh failure, cleared by the next success. */
  lastError: string | null;
  events: CalendarTask[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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
    url: typeof value.url === "string" ? value.url : null,
    importedAt: value.importedAt,
    lastError: typeof value.lastError === "string" ? value.lastError : null,
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
  storage.removeItem(IMPORT_STORAGE_KEY);
  storage.removeItem(CALENDAR_SOURCE_STORAGE_KEY);
}

export function restoreRememberSource(storage: Storage): boolean {
  return storage.getItem(REMEMBER_SOURCE_KEY) === "true";
}

export function saveRememberSource(storage: Storage, remember: boolean) {
  storage.setItem(REMEMBER_SOURCE_KEY, remember ? "true" : "false");
}

/**
 * Upgrades the 1.0.x single-import and remembered-URL keys into one
 * subscription, so an existing user keeps both their tasks and their refresh.
 */
export function migrateLegacyImport(storage: Storage): Subscription[] | null {
  const raw = storage.getItem(IMPORT_STORAGE_KEY);
  const sourceRaw = storage.getItem(CALENDAR_SOURCE_STORAGE_KEY);
  if (!raw) {
    storage.removeItem(CALENDAR_SOURCE_STORAGE_KEY);
    return null;
  }

  const parsed = parseStoredImportPayload(raw);
  const source = sourceRaw ? parseStoredSource(sourceRaw) : null;
  storage.removeItem(IMPORT_STORAGE_KEY);
  storage.removeItem(CALENDAR_SOURCE_STORAGE_KEY);
  if (!parsed) return null;

  const subscriptions: Subscription[] = [
    {
      id: newSubscriptionId(),
      name: parsed.calendarName,
      courseId: null,
      url: source?.url ?? null,
      importedAt: parsed.importedAt,
      lastError: null,
      events: parsed.events,
    },
  ];
  saveSubscriptions(storage, subscriptions);
  return subscriptions;
}

export function restoreSubscriptions(storage: Storage): {
  subscriptions: Subscription[];
  recoveredFromCorruptData: boolean;
} {
  const raw = storage.getItem(SUBSCRIPTIONS_STORAGE_KEY);
  if (!raw) {
    const migrated = migrateLegacyImport(storage);
    return { subscriptions: migrated ?? [], recoveredFromCorruptData: false };
  }

  const parsed = parseStoredSubscriptions(raw);
  if (parsed) return { subscriptions: parsed, recoveredFromCorruptData: false };

  clearSubscriptions(storage);
  return { subscriptions: [], recoveredFromCorruptData: true };
}

export function addSubscription(
  subscriptions: Subscription[],
  result: {
    calendarName: string | null;
    importedAt: string;
    events: CalendarTask[];
  },
  options: { courseId?: string | null; url?: string | null; name?: string | null } = {},
): Subscription[] {
  if (subscriptions.length >= MAX_SUBSCRIPTIONS) return subscriptions;

  return [
    ...subscriptions,
    {
      id: newSubscriptionId(),
      name: options.name ?? result.calendarName,
      courseId: options.courseId ?? null,
      url: options.url ?? null,
      importedAt: result.importedAt,
      lastError: null,
      events: result.events,
    },
  ];
}

/**
 * Adds several calendars at once — a batch of dropped files, say — stopping at
 * the cap rather than silently dropping some in the middle.
 */
export function addSubscriptions(
  subscriptions: Subscription[],
  results: Array<{ calendarName: string | null; importedAt: string; events: CalendarTask[] }>,
  options: { courseId?: string | null; name?: (index: number) => string | null } = {},
): Subscription[] {
  return results.reduce(
    (accumulated, result, index) =>
      addSubscription(accumulated, result, {
        courseId: options.courseId ?? null,
        name: options.name ? options.name(index) : null,
      }),
    subscriptions,
  );
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
