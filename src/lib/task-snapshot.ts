import { isDeadline, type CalendarTask } from "./calendar-types.ts";
import { dueTimestamp, localDay, taskDate } from "./date-utils.ts";
import type { UndatedTodo } from "./undated-todos.ts";

export const SNAPSHOT_MAX_TASKS = 500;
export const SNAPSHOT_MAX_BYTES = 128 * 1024;
export type SharedTask = {
  title: string;
  course: string | null;
  dueAt: string | null;
  date: string | null;
  allDay: boolean;
  completed: boolean | null;
  copies: number;
};
export type TaskSnapshot = {
  version: 1;
  capturedAt: string;
  sourceImportedAt: string | null;
  timeZone: string;
  tasks: SharedTask[];
};

function clean(value: string, max: number): string {
  const result = value.replace(/\s+/g, " ").trim();
  if (!result || result.length > max) throw new Error("Invalid task snapshot.");
  return result;
}

/** Explicit field allowlist: never serialize the calendar, gradebook or notes wholesale. */
export function buildTaskSnapshot(input: {
  tasks: CalendarTask[];
  doneIds: ReadonlySet<string>;
  courseFor: (task: CalendarTask) => string | null;
  undated: UndatedTodo[];
  sourceImportedAt: string | null;
  now?: Date;
  timeZone?: string;
}): TaskSnapshot {
  const grouped = new Map<string, SharedTask>();
  function add(row: SharedTask) {
    const key = JSON.stringify([row.title.toLocaleLowerCase("en-US"), row.course?.toLocaleLowerCase("en-US"), row.dueAt, row.date, row.allDay]);
    const previous = grouped.get(key);
    if (previous) {
      previous.copies++;
      // Conflicting duplicate ticks need review, rather than inventing a completion status.
      if (previous.completed !== row.completed) previous.completed = null;
    } else grouped.set(key, row);
  }
  for (const task of input.tasks.filter(isDeadline)) {
    const due = dueTimestamp(task);
    if (due === null) throw new Error("Invalid task date.");
    const course = input.courseFor(task);
    add({ title: clean(task.title, 500), course: course === null ? null : clean(course, 120), dueAt: new Date(due).toISOString(),
      date: task.allDay ? task.dateKey ?? localDay(taskDate(task)) : null, allDay: task.allDay, completed: input.doneIds.has(task.id), copies: 1 });
  }
  for (const task of input.undated) {
    add({ title: clean(task.title, 500), course: task.course === null ? null : clean(task.course, 120), dueAt: null, date: null, allDay: false, completed: task.done, copies: 1 });
  }
  return parseTaskSnapshot({ version: 1, capturedAt: (input.now ?? new Date()).toISOString(),
    sourceImportedAt: input.sourceImportedAt, timeZone: input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    tasks: [...grouped.values()] });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid task snapshot.");
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid task date.");
  return new Date(value).toISOString();
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error("Unexpected snapshot field.");
}

/** Validate at the server boundary and reconstruct, so extra private fields cannot be retained. */
export function parseTaskSnapshot(value: unknown): TaskSnapshot {
  const root = record(value);
  only(root, ["version", "capturedAt", "sourceImportedAt", "timeZone", "tasks"]);
  if (root.version !== 1 || !Array.isArray(root.tasks) || root.tasks.length > SNAPSHOT_MAX_TASKS || typeof root.timeZone !== "string" || root.timeZone.length > 80) throw new Error("Invalid task snapshot.");
  try { new Intl.DateTimeFormat("en", { timeZone: root.timeZone }); } catch { throw new Error("Invalid time zone."); }
  const tasks = root.tasks.map((value): SharedTask => {
    const row = record(value);
    only(row, ["title", "course", "dueAt", "date", "allDay", "completed", "copies"]);
    if (typeof row.title !== "string" || !(row.course === null || typeof row.course === "string") || typeof row.allDay !== "boolean" || !(row.completed === null || typeof row.completed === "boolean") || !Number.isInteger(row.copies) || Number(row.copies) < 1 || Number(row.copies) > 10000) throw new Error("Invalid task row.");
    if (!(row.date === null || (typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(Date.parse(row.date)) && new Date(row.date).toISOString().slice(0, 10) === row.date))) throw new Error("Invalid date.");
    if ((!row.allDay && row.date !== null) || (row.allDay && row.dueAt === null)) throw new Error("Invalid all-day task.");
    return { title: clean(row.title, 500), course: row.course === null ? null : clean(row.course, 120),
      dueAt: row.dueAt === null ? null : timestamp(row.dueAt), date: row.date as string | null,
      allDay: row.allDay, completed: row.completed, copies: Number(row.copies) };
  });
  const result: TaskSnapshot = { version: 1, capturedAt: timestamp(root.capturedAt),
    sourceImportedAt: root.sourceImportedAt === null ? null : timestamp(root.sourceImportedAt), timeZone: root.timeZone, tasks };
  if (new TextEncoder().encode(JSON.stringify(result)).length > SNAPSHOT_MAX_BYTES) throw new Error("Snapshot too large.");
  return result;
}
