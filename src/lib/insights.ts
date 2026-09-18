import { isDeadline, type CalendarTask } from "./calendar-types.ts";
import { startOfLocalDay, taskDate } from "./date-utils.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;
const WEEKS = 4;

export type CourseInsight = {
  /** `null` groups tasks that have no course attached. */
  course: string | null;
  total: number;
  completed: number;
};

export type Insights = {
  total: number;
  completed: number;
  /** Completed / total, as a fraction between 0 and 1. */
  completionRate: number;
  /** Per-course workload, busiest first. */
  byCourse: CourseInsight[];
  /** Task counts for the next 4 rolling weeks (length 4). */
  byWeek: number[];
  /** Task counts for the next 7 days (length 7). */
  nextSevenDays: number[];
};

function dayOffsetFrom(now: Date, task: CalendarTask): number | null {
  const start = startOfLocalDay(taskDate(task));
  if (Number.isNaN(start.valueOf())) return null;

  // `Math.round` keeps the bucket stable across daylight-saving transitions,
  // where a "day" can be 23 or 25 hours long.
  return Math.round((start.valueOf() - startOfLocalDay(now).valueOf()) / DAY_MS);
}

/**
 * Derive workload insights from the tasks currently on screen.
 *
 * Pure and locale-free: the caller owns all formatting, which keeps the maths
 * easy to test. Only deadlines count — a lecture is not work you complete, so
 * including one would drag the completion rate down and inflate its course's
 * workload. Every deadline contributes to `total`, `completed`, and `byCourse`;
 * only those dated today or later contribute to the time buckets, so past
 * deadlines never distort the upcoming workload.
 */
export function computeInsights(
  tasks: CalendarTask[],
  completedIds: Set<string>,
  now: Date = new Date(),
): Insights {
  const byWeek = new Array<number>(WEEKS).fill(0);
  const nextSevenDays = new Array<number>(DAYS_PER_WEEK).fill(0);
  const courseTotals = new Map<string | null, CourseInsight>();
  let completed = 0;
  let total = 0;

  for (const task of tasks) {
    if (!isDeadline(task)) continue;
    total += 1;

    const isCompleted = completedIds.has(task.id);
    if (isCompleted) completed += 1;

    const courseKey = task.course ?? null;
    const existing = courseTotals.get(courseKey);
    if (existing) {
      existing.total += 1;
      if (isCompleted) existing.completed += 1;
    } else {
      courseTotals.set(courseKey, {
        course: courseKey,
        total: 1,
        completed: isCompleted ? 1 : 0,
      });
    }

    const offset = dayOffsetFrom(now, task);
    if (offset === null || offset < 0) continue;

    if (offset < DAYS_PER_WEEK) nextSevenDays[offset] += 1;

    const week = Math.floor(offset / DAYS_PER_WEEK);
    if (week < WEEKS) byWeek[week] += 1;
  }

  const byCourse = [...courseTotals.values()].sort((left, right) => {
    if (right.total !== left.total) return right.total - left.total;
    if (left.course === null) return 1;
    if (right.course === null) return -1;
    return left.course.localeCompare(right.course);
  });

  return {
    total,
    completed,
    completionRate: total === 0 ? 0 : completed / total,
    byCourse,
    byWeek,
    nextSevenDays,
  };
}
