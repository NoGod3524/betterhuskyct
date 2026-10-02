/**
 * The to-do list: every deadline still to hand in, nearest first, and what is
 * done set apart.
 *
 * It is not the dashboard's "this week" board, which it used to be a copy of. It
 * reaches back to what is overdue and forward to what is coming, leaves out the
 * classes (they are on the calendar), and puts finished work away where it can
 * be found but does not crowd the list.
 */
import { isDeadline, type CalendarTask } from "./calendar-types.ts";
import { addDays, dueTimestamp, startOfLocalDay } from "./date-utils.ts";

/** How far back an unfinished deadline is still worth a red "overdue", and how far on a later one is listed. */
export const OVERDUE_DAYS = 21;
export const LOOKAHEAD_DAYS = 60;

export type TodoSectionKey = "overdue" | "today" | "tomorrow" | "week" | "later";

export type Todo = {
  /** Not done yet, by when they are due. */
  open: Record<TodoSectionKey, CalendarTask[]>;
  /** Done, most recently due first, within the same window. */
  done: CalendarTask[];
  openCount: number;
};

export function buildTodo(tasks: CalendarTask[], doneIds: Set<string>, now: Date): Todo {
  const today = startOfLocalDay(now).valueOf();
  const tomorrow = addDays(startOfLocalDay(now), 1).valueOf();
  const dayAfter = addDays(startOfLocalDay(now), 2).valueOf();
  const nextWeek = addDays(startOfLocalDay(now), 7).valueOf();
  const from = now.valueOf() - OVERDUE_DAYS * 86_400_000;
  const to = addDays(startOfLocalDay(now), LOOKAHEAD_DAYS).valueOf();

  const open: Todo["open"] = { overdue: [], today: [], tomorrow: [], week: [], later: [] };
  const done: Array<{ task: CalendarTask; due: number }> = [];
  const dated: Array<{ task: CalendarTask; due: number }> = [];
  for (const task of tasks) {
    if (!isDeadline(task)) continue;
    const due = dueTimestamp(task);
    if (due === null || due < from || due >= to) continue;
    dated.push({ task, due });
  }
  dated.sort((a, b) => a.due - b.due);

  for (const { task, due } of dated) {
    if (doneIds.has(task.id)) {
      done.push({ task, due });
    } else if (due < now.valueOf()) {
      open.overdue.push(task);
    } else if (due < tomorrow && due >= today) {
      open.today.push(task);
    } else if (due < dayAfter) {
      open.tomorrow.push(task);
    } else if (due < nextWeek) {
      open.week.push(task);
    } else {
      open.later.push(task);
    }
  }

  const openCount = Object.values(open).reduce((total, list) => total + list.length, 0);
  return { open, done: done.sort((a, b) => b.due - a.due).map((entry) => entry.task), openCount };
}
