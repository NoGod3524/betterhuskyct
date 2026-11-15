import { similarTitles, type Suggestion } from "./ai-plan.ts";
import { isDeadline, type CalendarTask } from "./calendar-types.ts";
import type { CustomEventInput } from "./custom-events.ts";
import { localDay, taskDate } from "./date-utils.ts";
import type { PlanItem } from "./plan-models.ts";
import type { UndatedTodo } from "./undated-todos.ts";

/**
 * A suggestion from the model, held against the calendar: whether it is already there, already
 * over, or on a weekday its source does not name; and, once the student adds it, the event or the
 * undated to-do it becomes.
 */

const WEEKDAYS: Array<[RegExp, number]> = [
  [/\bsun(day)?\b/i, 0],
  [/\bmon(day)?\b/i, 1],
  [/\btue(s|sday)?\b/i, 2],
  [/\bwed(nesday)?\b/i, 3],
  [/\bthu(r|rs|rsday)?\b/i, 4],
  [/\bfri(day)?\b/i, 5],
  [/\bsat(urday)?\b/i, 6],
];

/**
 * Whether the source names a weekday that the date does not fall on. A
 * syllabus copied from last year keeps "Tuesday, October 14" when the 14th is
 * now a Wednesday, and this is how that shows. Only checked when exactly one
 * weekday is named, since a line like "Mon/Wed" says nothing about the date.
 */
export function weekdayMismatch(item: Pick<PlanItem, "date" | "evidence">): boolean {
  if (!item.date) return false;
  const named = WEEKDAYS.filter(([pattern]) => pattern.test(item.evidence));
  if (named.length !== 1) return false;
  const [year, month, day] = item.date.split("-").map(Number);
  return new Date(year, month - 1, day).getDay() !== named[0][1];
}

export type SuggestionFlags = {
  /** Something on that day with a title like it is already in the calendar. */
  inCalendar: boolean;
  weekday: boolean;
  past: boolean;
};

export function suggestionFlags(suggestion: Suggestion, tasks: CalendarTask[], today: string): SuggestionFlags {
  const date = suggestion.date;
  const inCalendar =
    !!date &&
    tasks.some((task) => isDeadline(task) && localDay(taskDate(task)) === date && similarTitles(task.title, suggestion.title));
  return { inCalendar, weekday: weekdayMismatch(suggestion), past: !!date && date < today };
}

/** Ticked to be added unless it is already there or already over. */
export function selectedByDefault(flags: SuggestionFlags): boolean {
  return !flags.inCalendar && !flags.past;
}

/** `YYYY-MM-DD` and `HH:MM` as that moment here. */
export function localInstant(day: string, time: string | null): string {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = (time ?? "00:00").split(":").map(Number);
  return new Date(year, month - 1, date, hour, minute).toISOString();
}

function noteFor(suggestion: Suggestion): string {
  const where = suggestion.fromLabel ? `${suggestion.fromLabel}` : suggestion.from;
  return suggestion.evidence ? `AI · ${where}: "${suggestion.evidence}"` : `AI · ${where}`;
}

/** A dated suggestion as a calendar event; the day may have been changed on the list. */
export function suggestionToEvent(suggestion: Suggestion, day: string): CustomEventInput {
  const time = day === suggestion.date ? suggestion.time : null;
  return {
    id: `custom-${suggestion.id}`,
    title: suggestion.title,
    course: suggestion.course,
    start: localInstant(day, time),
    end: null,
    allDay: time === null,
    location: null,
    note: noteFor(suggestion),
  };
}

export function suggestionToUndated(suggestion: Suggestion, addedAt: string): UndatedTodo {
  return {
    id: suggestion.id,
    title: suggestion.title,
    course: suggestion.course,
    note: noteFor(suggestion),
    done: false,
    addedAt,
  };
}
