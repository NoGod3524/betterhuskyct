/**
 * To-dos with no date: "buy the textbook", "register your clicker", or an exam
 * a syllabus puts in "Week 5" without a day. The to-do list is built from the
 * calendar, which needs a day for everything, so these are kept apart and
 * shown in a group of their own. They stay in this browser, as events the
 * student adds on the calendar do.
 */

export type UndatedTodo = {
  id: string;
  title: string;
  course: string | null;
  note: string | null;
  done: boolean;
  addedAt: string;
};

export const UNDATED_TODOS_KEY = "huskypilot.undatedTodos.v1";
export const MAX_UNDATED_TODOS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseUndatedTodo(value: unknown): UndatedTodo | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  if (typeof value.title !== "string" || !value.title.trim()) return null;
  if (value.course !== null && typeof value.course !== "string") return null;
  if (value.note !== null && typeof value.note !== "string") return null;
  if (typeof value.done !== "boolean") return null;
  if (typeof value.addedAt !== "string" || Number.isNaN(Date.parse(value.addedAt))) return null;
  return {
    id: value.id,
    title: value.title,
    course: value.course as string | null,
    note: value.note as string | null,
    done: value.done,
    addedAt: value.addedAt,
  };
}

export function restoreUndatedTodos(storage: Pick<Storage, "getItem">): UndatedTodo[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(UNDATED_TODOS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_UNDATED_TODOS).flatMap((entry) => {
      const todo = parseUndatedTodo(entry);
      return todo ? [todo] : [];
    });
  } catch {
    return [];
  }
}

export function saveUndatedTodos(storage: Pick<Storage, "setItem">, todos: UndatedTodo[]): void {
  try {
    storage.setItem(UNDATED_TODOS_KEY, JSON.stringify(todos.slice(0, MAX_UNDATED_TODOS)));
  } catch {
    /* kept for this visit */
  }
}

/** Open ones first, in the order they were added; done ones after. */
export function sortUndatedTodos(todos: UndatedTodo[]): UndatedTodo[] {
  return [...todos].sort((left, right) => Number(left.done) - Number(right.done) || (left.addedAt < right.addedAt ? -1 : left.addedAt > right.addedAt ? 1 : 0));
}
