import type { CalendarTask } from "./calendar-types.ts";
import { localDay } from "./date-utils.ts";

/**
 * Events the student added on the calendar page itself — office hours, a
 * study group, a reminder HuskyCT never carried. Not a correction of
 * anything imported, so they live apart from `event-overlay.ts` and are
 * never touched by reverting it.
 */
export type CustomEvent = CalendarTask & { note: string | null };

const STORAGE_KEY = "huskypilot.customEvents.v1";
const ID_PREFIX = "custom-";
export const MAX_CUSTOM_EVENTS = 500;

export function isCustomEventId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function parseCustomEvent(value: unknown): CustomEvent | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !isCustomEventId(value.id)) return null;
  if (typeof value.title !== "string" || !value.title.trim()) return null;
  if (!isValidDateString(value.start)) return null;
  if (value.end !== null && !isValidDateString(value.end)) return null;
  if (typeof value.allDay !== "boolean") return null;
  if (value.course !== null && typeof value.course !== "string") return null;
  if (value.location !== null && typeof value.location !== "string") return null;
  if (value.note !== null && typeof value.note !== "string") return null;
  if (typeof value.dateKey !== "string" && value.dateKey !== null) return null;

  return {
    id: value.id,
    title: value.title,
    course: value.course as string | null,
    start: value.start,
    dateKey: value.dateKey,
    end: value.end as string | null,
    allDay: value.allDay,
    location: value.location as string | null,
    kind: "assignment",
    note: value.note as string | null,
  };
}

export function restoreCustomEvents(storage: Storage): CustomEvent[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_CUSTOM_EVENTS).flatMap((entry) => {
      const event = parseCustomEvent(entry);
      return event ? [event] : [];
    });
  } catch {
    return [];
  }
}

export function saveCustomEvents(storage: Storage, events: CustomEvent[]): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, MAX_CUSTOM_EVENTS)));
}

export function createCustomEventId(): string {
  return ID_PREFIX + (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

export type CustomEventInput = {
  title: string;
  course: string | null;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  note: string | null;
};

/**
 * The local calendar day `start` falls on. The calendar page passes local
 * midnight as a UTC ISO string, so slicing the string would land a day early
 * anywhere ahead of UTC; `taskDate` reads the key back as a local date too.
 */
const localDateKey = (start: string) => localDay(new Date(start));

export function buildCustomEvent(input: CustomEventInput): CustomEvent {
  return {
    id: createCustomEventId(),
    title: input.title,
    course: input.course,
    start: input.start,
    dateKey: input.allDay ? localDateKey(input.start) : null,
    end: input.end,
    allDay: input.allDay,
    location: input.location,
    kind: "assignment",
    note: input.note,
  };
}

export function editCustomEvent(events: CustomEvent[], id: string, patch: Partial<CustomEventInput>): CustomEvent[] {
  return events.map((event) => {
    if (event.id !== id) return event;
    const start = patch.start ?? event.start;
    const allDay = patch.allDay ?? event.allDay;
    return {
      ...event,
      title: patch.title ?? event.title,
      course: patch.course !== undefined ? patch.course : event.course,
      start,
      dateKey: allDay ? localDateKey(start) : null,
      end: patch.end !== undefined ? patch.end : event.end,
      allDay,
      location: patch.location !== undefined ? patch.location : event.location,
      note: patch.note !== undefined ? patch.note : event.note,
    };
  });
}

export function removeCustomEvent(events: CustomEvent[], id: string): CustomEvent[] {
  return events.filter((event) => event.id !== id);
}
