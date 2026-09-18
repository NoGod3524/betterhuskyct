import { isDeadline, type CalendarTask } from "./calendar-types.ts";
import { dueTimestamp } from "./date-utils.ts";

// "When is this task due" is a date concern, so it lives in date-utils and is
// re-exported here to keep existing imports working.
export { dueTimestamp };

export const REMINDER_STORAGE_KEY = "huskypilot.reminders.v1";
const REMINDER_STORAGE_VERSION = 1;

/** How far ahead a task counts as "due soon". */
export const REMINDER_WINDOW_HOURS = 24;
/** Smallest gap between two notifications about the same set of tasks. */
const RENOTIFY_AFTER_MS = 20 * 60 * 60 * 1000;

export type ReminderState = {
  enabled: boolean;
  /** Fingerprint of the task set we last notified about. */
  lastSignature: string | null;
  /** ISO timestamp of the last notification. */
  lastNotifiedAt: string | null;
};

export const DEFAULT_REMINDER_STATE: ReminderState = {
  enabled: false,
  lastSignature: null,
  lastNotifiedAt: null,
};

type StoredReminderPayload = ReminderState & { version: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Tasks due between now and `windowHours` from now, soonest first. */
export function dueSoonTasks(
  tasks: CalendarTask[],
  now: Date = new Date(),
  windowHours: number = REMINDER_WINDOW_HOURS,
): CalendarTask[] {
  const from = now.valueOf();
  const to = from + windowHours * 60 * 60 * 1000;

  return tasks
    .filter((task) => {
      if (!isDeadline(task)) return false;
      const due = dueTimestamp(task);
      return due !== null && due >= from && due <= to;
    })
    .sort((left, right) => (dueTimestamp(left) ?? 0) - (dueTimestamp(right) ?? 0));
}

/** Stable fingerprint of a task set, so we only notify when the set changes. */
export function reminderSignature(tasks: CalendarTask[]): string {
  return tasks
    .map((task) => task.id)
    .sort()
    .join("|");
}

/**
 * Whether a notification is warranted: the set of due tasks changed, or enough
 * time passed since the last one. Prevents repeating the same reminder.
 */
export function shouldNotify(
  state: ReminderState,
  signature: string,
  now: Date = new Date(),
): boolean {
  if (!state.enabled || !signature) return false;
  if (state.lastSignature !== signature) return true;
  if (!state.lastNotifiedAt) return true;

  const last = Date.parse(state.lastNotifiedAt);
  if (Number.isNaN(last)) return true;

  return now.valueOf() - last >= RENOTIFY_AFTER_MS;
}

export function parseStoredReminderState(rawValue: string): ReminderState | null {
  try {
    const parsed = JSON.parse(rawValue);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== REMINDER_STORAGE_VERSION) return null;
    if (typeof parsed.enabled !== "boolean") return null;
    if (
      typeof parsed.lastSignature !== "string" &&
      parsed.lastSignature !== null
    ) {
      return null;
    }
    if (
      typeof parsed.lastNotifiedAt !== "string" &&
      parsed.lastNotifiedAt !== null
    ) {
      return null;
    }

    return {
      enabled: parsed.enabled,
      lastSignature: parsed.lastSignature,
      lastNotifiedAt: parsed.lastNotifiedAt,
    };
  } catch {
    return null;
  }
}

export function restoreReminderState(storage: Storage): ReminderState {
  const raw = storage.getItem(REMINDER_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_REMINDER_STATE };

  const parsed = parseStoredReminderState(raw);
  if (!parsed) {
    storage.removeItem(REMINDER_STORAGE_KEY);
    return { ...DEFAULT_REMINDER_STATE };
  }

  return parsed;
}

export function saveReminderState(storage: Storage, state: ReminderState) {
  const payload: StoredReminderPayload = {
    version: REMINDER_STORAGE_VERSION,
    ...state,
  };

  storage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(payload));
}
