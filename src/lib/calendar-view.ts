import type { CalendarTask, TaskGroup } from "./calendar-types.ts";
import { addDays, startOfLocalDay, taskDate } from "./date-utils.ts";
import { DEFAULT_LOCALE, intlLocale, t, type Locale } from "./i18n.ts";
import { ymd } from "./format-date.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const shortDate = (value: Date) => ymd(value);

export function groupTasks(
  events: CalendarTask[],
  now: Date = new Date(),
  locale: Locale = DEFAULT_LOCALE,
): TaskGroup[] {
  const today = startOfLocalDay(now);
  const tomorrow = addDays(today, 1);
  const dayAfterTomorrow = addDays(today, 2);
  const horizon = addDays(today, 7);

  const upcoming = events
    .filter((event) => {
      const start = taskDate(event);
      if (Number.isNaN(start.valueOf()) || start >= horizon) return false;

      if (event.allDay) return start >= today;
      return start >= now;
    })
    .sort(
      (left, right) =>
        taskDate(left).valueOf() - taskDate(right).valueOf(),
    );

  return [
    {
      key: "today",
      title: t(locale, "group.today"),
      dateLabel: shortDate(today),
      accentClass: "bg-[#e6533c]",
      tasks: upcoming.filter((event) => taskDate(event) < tomorrow),
    },
    {
      key: "tomorrow",
      title: t(locale, "group.tomorrow"),
      dateLabel: shortDate(tomorrow),
      accentClass: "bg-[#e9a23b]",
      tasks: upcoming.filter((event) => {
        const start = taskDate(event);
        return start >= tomorrow && start < dayAfterTomorrow;
      }),
    },
    {
      key: "week",
      title: t(locale, "group.week"),
      dateLabel: `${shortDate(dayAfterTomorrow)}–${shortDate(addDays(today, 6))}`,
      accentClass: "bg-[#2a71d8]",
      tasks: upcoming.filter((event) => {
        const start = taskDate(event);
        return start >= dayAfterTomorrow && start < horizon;
      }),
    },
  ];
}

function atLocalTime(base: Date, dayOffset: number, hours: number, minutes = 0) {
  const date = addDays(startOfLocalDay(base), dayOffset);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

export function createDemoTasks(now: Date = new Date()): CalendarTask[] {
  const nextHour = Math.min(Math.max(now.getHours() + 2, 9), 23);

  return [
    {
      id: "demo-cse-problem-set",
      course: "CSE 2050",
      title: "Data Structures — Problem Set 1",
      start: atLocalTime(now, 0, nextHour, 30),
      dateKey: null,
      end: null,
      allDay: false,
      location: null,
    },
    {
      id: "demo-math-webassign",
      course: "MATH 2110Q",
      title: "WebAssign: Section 2.3",
      start: atLocalTime(now, 0, 23, 59),
      dateKey: null,
      end: null,
      allDay: false,
      location: null,
    },
    {
      id: "demo-engl-response",
      course: "ENGL 1007",
      title: "Reading response: The Hidden City",
      start: atLocalTime(now, 1, 15, 30),
      dateKey: null,
      end: null,
      allDay: false,
      location: null,
    },
    {
      id: "demo-econ-quiz",
      course: "ECON 1201",
      title: "Chapter 3 quiz",
      start: atLocalTime(now, 3, 8),
      dateKey: null,
      end: null,
      allDay: false,
      location: null,
    },
    {
      id: "demo-cse-lab",
      course: "CSE 2050",
      title: "Lab 1: Linked lists",
      start: atLocalTime(now, 4, 17),
      dateKey: null,
      end: null,
      allDay: false,
      location: null,
    },
    {
      id: "demo-math-quiz",
      course: "MATH 2110Q",
      title: "Weekly practice quiz",
      start: atLocalTime(now, 6, 23, 59),
      dateKey: null,
      end: null,
      allDay: false,
      location: null,
    },
  ];
}

export function formatTaskTime(
  task: CalendarTask,
  group: TaskGroup["key"],
  locale: Locale = DEFAULT_LOCALE,
) {
  if (task.allDay) {
    return group === "week"
      ? `${new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short" }).format(taskDate(task))} · ${t(locale, "time.allDay")}`
      : t(locale, "time.allDay");
  }

  const start = new Date(task.start);
  const time = new Intl.DateTimeFormat(intlLocale(locale), {
    hour: "numeric",
    minute: "2-digit",
  }).format(start);

  if (group === "week") {
    const weekday = new Intl.DateTimeFormat(intlLocale(locale), {
      weekday: "short",
    }).format(start);
    return `${weekday} · ${time}`;
  }

  return time;
}

export function isDueSoon(task: CalendarTask, now: Date = new Date()) {
  if (task.allDay) return false;
  const difference = new Date(task.start).valueOf() - now.valueOf();
  return difference >= 0 && difference <= DAY_MS / 2;
}
