import type { CalendarImportResult, CalendarTask } from "./calendar-types.ts";

export const IMPORT_STORAGE_KEY = "huskypilot.importedCalendar.v1";
const IMPORT_STORAGE_VERSION = 1;
type StoredImportPayload = {
  version: number;
  calendarName: string | null;
  importedAt: string;
  events: CalendarTask[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isCalendarTask(value: unknown): value is CalendarTask {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (typeof value.course === "string" || value.course === null) &&
    isValidDateString(value.start) &&
    (typeof value.dateKey === "string" || value.dateKey === null) &&
    (isValidDateString(value.end) || value.end === null) &&
    typeof value.allDay === "boolean" &&
    (typeof value.location === "string" || value.location === null)
  );
}

export function parseStoredImportPayload(rawValue: string): StoredImportPayload | null {
  try {
    const parsed = JSON.parse(rawValue);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== IMPORT_STORAGE_VERSION) return null;
    if (typeof parsed.calendarName !== "string" && parsed.calendarName !== null) {
      return null;
    }
    if (!isValidDateString(parsed.importedAt)) return null;
    if (!Array.isArray(parsed.events) || !parsed.events.every(isCalendarTask)) {
      return null;
    }

    return {
      version: IMPORT_STORAGE_VERSION,
      calendarName: parsed.calendarName,
      importedAt: parsed.importedAt,
      events: parsed.events,
    };
  } catch {
    return null;
  }
}

export function serializeImportPayload(result: CalendarImportResult): string {
  const payload: StoredImportPayload = {
    version: IMPORT_STORAGE_VERSION,
    calendarName: result.calendarName,
    importedAt: result.importedAt,
    events: result.events,
  };

  return JSON.stringify(payload);
}
