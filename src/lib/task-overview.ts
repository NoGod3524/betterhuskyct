import { isDeadline, type CalendarTask } from "./calendar-types.ts";
import { addDays, dueTimestamp, startOfLocalDay } from "./date-utils.ts";

/**
 * A plain count of what is on the to-do list, and nothing it cannot know.
 *
 * What is counted is the items on the list: deadlines HuskyCT gave and ones the student added (not
 * class meetings), with those already done left out, and the to-dos with no day set apart. The
 * numbers are numbers of items. They say nothing of how long anything takes or how hard it is, and
 * two items due on the same day are only that: with no start or end times there is no telling
 * whether they clash.
 */
export type Entry = {
  id: string;
  title: string;
  course: string | null;
  /** The task, for the ones with a day. */
  task: CalendarTask | null;
  /** The to-do with no day, for those. */
  undatedId: string | null;
};

export type DayCount = { day: string; entries: Entry[] };

export type Overview = {
  /** Not done, due from now to the end of the seventh day counting today. */
  next7: Entry[];
  /** Not done and due before now. */
  overdue: Entry[];
  /** Not done, with no day. */
  undated: Entry[];
  /** The seven days from today, each with what is due on it. */
  byDay: DayCount[];
  /** What is in `next7`, by course; those with none under null. */
  byCourse: Array<{ course: string | null; entries: Entry[] }>;
};

const dayKeyOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function buildOverview(
  tasks: readonly CalendarTask[],
  doneIds: ReadonlySet<string>,
  undated: ReadonlyArray<{ id: string; title: string; course: string | null; done: boolean }>,
  now: Date,
  courseOf: (task: CalendarTask) => string | null,
): Overview {
  const today = startOfLocalDay(now);
  const horizon = addDays(today, 7).valueOf();
  const overdue: Entry[] = [];
  const next7: Entry[] = [];
  const days = Array.from({ length: 7 }, (_, index) => ({ day: dayKeyOf(addDays(today, index)), entries: [] as Entry[] }));
  const dayIndex = new Map(days.map((entry, index) => [entry.day, index]));

  const dated = tasks
    .filter((task) => isDeadline(task) && !doneIds.has(task.id))
    .map((task) => ({ task, due: dueTimestamp(task) }))
    .filter((item): item is { task: CalendarTask; due: number } => item.due !== null)
    .sort((left, right) => left.due - right.due);

  for (const { task, due } of dated) {
    const entry: Entry = { id: task.id, title: task.title, course: courseOf(task), task, undatedId: null };
    if (due < now.valueOf()) {
      overdue.push(entry);
    } else if (due < horizon) {
      next7.push(entry);
      const index = dayIndex.get(dayKeyOf(new Date(due)));
      if (index !== undefined) days[index].entries.push(entry);
    }
  }

  const byCourse = new Map<string | null, Entry[]>();
  for (const entry of next7) byCourse.set(entry.course, [...(byCourse.get(entry.course) ?? []), entry]);

  return {
    next7,
    overdue,
    undated: undated.filter((todo) => !todo.done).map((todo) => ({ id: todo.id, title: todo.title, course: todo.course, task: null, undatedId: todo.id })),
    byDay: days,
    byCourse: [...byCourse.entries()].map(([course, entries]) => ({ course, entries })).sort((left, right) => right.entries.length - left.entries.length || String(left.course).localeCompare(String(right.course))),
  };
}
