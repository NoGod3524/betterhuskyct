import type { CalendarTask } from "./calendar-types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** Whether a value read from storage or from a sync is shaped like a task. */
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
