import ical, {
  type CalendarComponent,
  type EventInstance,
  type ParameterValue,
  type VEvent,
  type VTodo,
} from "node-ical";

import type { CalendarImportResult, CalendarTask, TaskKind } from "./calendar-types.ts";

const MAX_EVENTS = 500;
const FUTURE_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;

type CalendarDate = Date & { dateOnly?: true; tz?: string };

/**
 * Blackboard encodes where an entry came from in its UID: class meetings come
 * from the calendar, graded items from the gradebook. Nothing else in the feed
 * distinguishes them, and it is the only way to tell a class from an assignment.
 */
export function blackboardKind(uid: string): TaskKind | null {
  if (uid.includes(".calendar.CalendarEntry-")) return "class";
  if (uid.includes(".gradebook2.GradableItem-")) return "assignment";
  // HuskyCT Helper's own to-do export. Those items are read from the course's
  // to-do list, which only ever lists graded work — so unlike a calendar entry,
  // there is no ambiguity to resolve.
  if (uid.startsWith("huskyct-todo-")) return "assignment";
  return null;
}

function textValue(value: ParameterValue | undefined) {
  if (!value) return "";
  return typeof value === "string" ? value : value.val;
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function allDayKey(value: CalendarDate) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: value.tz ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function splitCourseAndTitle(rawTitle: string, categories?: string[]) {
  const title = cleanText(rawTitle) || "Untitled calendar event";
  const category = categories?.map(cleanText).find((item) => item.length > 1 && item.length <= 40);

  const bracketed = title.match(/^\[([^\]]{2,32})\]\s*(.+)$/);
  if (bracketed) {
    return { course: bracketed[1].trim(), title: bracketed[2].trim() };
  }

  const prefixed = title.match(/^([^:—]{2,30})\s*(?::|—)\s+(.+)$/);
  if (prefixed && /[A-Z]{2,}|\d{3,4}/.test(prefixed[1])) {
    return { course: prefixed[1].trim(), title: prefixed[2].trim() };
  }

  return { course: category ?? null, title };
}

function taskFromEvent(
  event: VEvent,
  start: Date,
  end: Date | undefined,
  allDay: boolean,
): CalendarTask {
  const { course, title } = splitCourseAndTitle(
    textValue(event.summary),
    event.categories,
  );

  return {
    id: `${event.uid}:${start.toISOString()}`,
    course,
    title,
    start: start.toISOString(),
    dateKey: allDay ? allDayKey(start) : null,
    end: end?.toISOString() ?? null,
    allDay,
    location: cleanText(textValue(event.location)) || null,
    kind: blackboardKind(event.uid),
  };
}

function taskFromInstance(instance: EventInstance) {
  return taskFromEvent(
    instance.event,
    instance.start,
    instance.end,
    instance.isFullDay,
  );
}

function taskFromTodo(todo: VTodo) {
  const start = todo.due ?? todo.start;
  if (!start) return null;
  const { course, title } = splitCourseAndTitle(
    textValue(todo.summary),
    todo.categories,
  );

  return {
    id: `${todo.uid}:${start.toISOString()}`,
    course,
    title,
    start: start.toISOString(),
    dateKey:
      start.dateOnly === true || todo.datetype === "date"
        ? allDayKey(start)
        : null,
    end: null,
    allDay: start.dateOnly === true || todo.datetype === "date",
    location: cleanText(textValue(todo.location)) || null,
    kind: blackboardKind(todo.uid),
  } satisfies CalendarTask;
}

function isCalendarComponent(value: CalendarComponent | undefined): value is CalendarComponent {
  return Boolean(value && typeof value === "object" && "type" in value);
}

export async function parseCalendar(
  icsText: string,
  now: Date = new Date(),
): Promise<CalendarImportResult> {
  const parsed = await ical.async.parseICS(icsText);
  const from = new Date(now.valueOf() - 24 * 60 * 60 * 1000);
  const to = new Date(now.valueOf() + FUTURE_WINDOW_MS);
  const tasks: CalendarTask[] = [];

  for (const component of Object.values(parsed)) {
    if (!isCalendarComponent(component)) continue;

    if (component.type === "VEVENT") {
      if (component.status === "CANCELLED" || component.recurrenceid) continue;

      if (component.rrule) {
        const instances = ical.expandRecurringEvent(component, { from, to });
        tasks.push(...instances.map(taskFromInstance));
      } else if (component.start >= from && component.start <= to) {
        tasks.push(
          taskFromEvent(
            component,
            component.start,
            component.end,
            component.start.dateOnly === true || component.datetype === "date",
          ),
        );
      }
    }

    if (
      component.type === "VTODO" &&
      component.status !== "CANCELLED" &&
      component.status !== "COMPLETED"
    ) {
      const task = taskFromTodo(component);
      if (task) {
        const start = new Date(task.start);
        if (start >= from && start <= to) tasks.push(task);
      }
    }
  }

  const uniqueTasks = Array.from(
    new Map(tasks.map((task) => [task.id, task])).values(),
  )
    .sort(
      (left, right) =>
        new Date(left.start).valueOf() - new Date(right.start).valueOf(),
    )
    .slice(0, MAX_EVENTS);

  return {
    calendarName: parsed.vcalendar?.["WR-CALNAME"] ?? null,
    importedAt: now.toISOString(),
    events: uniqueTasks,
  };
}
