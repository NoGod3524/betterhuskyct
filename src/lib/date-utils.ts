import type { CalendarTask } from "./calendar-types.ts";

/** Midnight at the start of the given date, in the viewer's local time zone. */
export function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/** The local calendar day of a moment as 2026-10-09: what a date input holds and a day key is. */
export function localDay(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

/** A new date shifted by the given number of calendar days. */
export function addDays(value: Date, days: number): Date {
  const copy = new Date(value);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/**
 * The day a task belongs to: the all-day `dateKey` when present, otherwise its
 * start timestamp. Keeping all-day events on their own date avoids the classic
 * "shows up on the previous day" UTC-midnight bug.
 */
export function taskDate(task: CalendarTask): Date {
  if (task.allDay && task.dateKey) {
    return new Date(`${task.dateKey}T00:00:00`);
  }
  return new Date(task.start);
}

/**
 * The moment a task is actually due: its start time, or the end of the day for
 * an all-day task (an all-day deadline means "by the end of that day").
 * Returns `null` when the task has an unparseable date.
 */
export function dueTimestamp(task: CalendarTask): number | null {
  const date = taskDate(task);
  if (Number.isNaN(date.valueOf())) return null;

  if (task.allDay) {
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay.valueOf();
  }

  return date.valueOf();
}
