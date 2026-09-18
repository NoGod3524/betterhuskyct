import { isDeadline, type CalendarTask } from "./calendar-types.ts";
import { dueTimestamp, startOfLocalDay } from "./date-utils.ts";
import {
  SESSION_MINUTES,
  effortFor,
  minutesFor,
  type EffortLevel,
  type EffortMap,
} from "./effort.ts";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A task with everything the plan needs to judge whether it is reachable. */
export type PlannedTask = {
  task: CalendarTask;
  effort: EffortLevel;
  minutes: number;
  dueAt: number;
  /** Negative once the deadline has passed. */
  hoursUntilDue: number;
  /** Whole days from today to the due day; negative when overdue. */
  daysLeft: number;
  sessionsNeeded: number;
  /** Sittings available: one per day, today through the due day. */
  sessionsAvailable: number;
  overdue: boolean;
  /**
   * True when the work no longer fits in the days remaining — the honest
   * "you need to start now" signal.
   */
  atRisk: boolean;
};

export type Plan = {
  overdue: PlannedTask[];
  atRisk: PlannedTask[];
  upcoming: PlannedTask[];
  /** Minutes of work suggested for today (overdue + at risk). */
  focusMinutes: number;
};

export function plannedTask(
  task: CalendarTask,
  now: Date,
  effort: EffortLevel,
): PlannedTask | null {
  const dueAt = dueTimestamp(task);
  if (dueAt === null) return null;

  const minutes = minutesFor(effort);
  const sessionsNeeded = Math.max(1, Math.ceil(minutes / SESSION_MINUTES));
  const daysLeft = Math.round(
    (startOfLocalDay(new Date(dueAt)).valueOf() -
      startOfLocalDay(now).valueOf()) /
      MS_PER_DAY,
  );
  const overdue = dueAt < now.valueOf();
  const sessionsAvailable = Math.max(1, daysLeft + 1);

  return {
    task,
    effort,
    minutes,
    dueAt,
    hoursUntilDue: (dueAt - now.valueOf()) / MS_PER_HOUR,
    daysLeft,
    sessionsNeeded,
    sessionsAvailable,
    overdue,
    atRisk: !overdue && sessionsNeeded > sessionsAvailable,
  };
}

/** Overdue first, then at risk, then soonest, then the biggest. */
export function orderPlannedTasks(items: PlannedTask[]): PlannedTask[] {
  return [...items].sort((left, right) => {
    if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
    if (left.atRisk !== right.atRisk) return left.atRisk ? -1 : 1;
    if (left.dueAt !== right.dueAt) return left.dueAt - right.dueAt;
    return right.minutes - left.minutes;
  });
}

/**
 * Turn the current tasks into an honest work plan.
 *
 * Pure and locale-free: it only compares amounts of work with days remaining,
 * so the caller owns all wording and formatting.
 */
export function buildPlan(
  tasks: CalendarTask[],
  completedIds: Set<string>,
  efforts: EffortMap,
  now: Date = new Date(),
  upcomingLimit = 6,
): Plan {
  const planned = orderPlannedTasks(
    tasks
      .filter((task) => !completedIds.has(task.id) && isDeadline(task))
      .map((task) => plannedTask(task, now, effortFor(efforts, task.id)))
      .filter((item): item is PlannedTask => item !== null),
  );

  const overdue = planned.filter((item) => item.overdue);
  const atRisk = planned.filter((item) => item.atRisk);
  const upcoming = planned
    .filter((item) => !item.overdue && !item.atRisk)
    .slice(0, upcomingLimit);

  const focusMinutes = [...overdue, ...atRisk].reduce(
    (total, item) => total + item.minutes,
    0,
  );

  return { overdue, atRisk, upcoming, focusMinutes };
}
