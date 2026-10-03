import type { CalendarTask } from "./calendar-types.ts";

/**
 * What the calendar page changed about an imported event, kept apart from the
 * feed itself.
 *
 * Re-importing a calendar replaces a feed's events wholesale — that is how a
 * moved deadline moves — so a correction stored *on* the task would be wiped
 * by the next collection. Keeping it here, keyed by task id, means a re-import
 * does not erase it: the edit is re-applied to whichever task now has that id.
 * A task HuskyCT dropped, or gave a new id (its own time changed), simply has
 * nothing to apply the edit to, which is the one case this cannot help.
 */
export type EventEdit = {
  title?: string;
  start?: string;
  end?: string | null;
  allDay?: boolean;
  location?: string | null;
  note?: string;
};

export type EventOverlay = {
  edits: Record<string, EventEdit>;
  /** Hidden, not forgotten: still in `edits` if the student also noted something before deleting it. */
  deletedIds: string[];
};

export const EMPTY_OVERLAY: EventOverlay = { edits: {}, deletedIds: [] };

const STORAGE_KEY = "huskypilot.eventOverlay.v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function parseEdit(value: unknown): EventEdit | null {
  if (!isRecord(value)) return null;
  const edit: EventEdit = {};
  if (value.title !== undefined) {
    if (typeof value.title !== "string" || !value.title.trim()) return null;
    edit.title = value.title;
  }
  if (value.start !== undefined) {
    if (!isValidDateString(value.start)) return null;
    edit.start = value.start;
  }
  if (value.end !== undefined) {
    if (value.end !== null && !isValidDateString(value.end)) return null;
    edit.end = value.end;
  }
  if (value.allDay !== undefined) {
    if (typeof value.allDay !== "boolean") return null;
    edit.allDay = value.allDay;
  }
  if (value.location !== undefined) {
    if (value.location !== null && typeof value.location !== "string") return null;
    edit.location = value.location;
  }
  if (value.note !== undefined) {
    if (typeof value.note !== "string") return null;
    edit.note = value.note;
  }
  return edit;
}

/**
 * A bad edit is dropped on its own, not the whole overlay: this is the
 * student's own corrections, read back from their own browser, not input
 * from anywhere else — losing every edit over one corrupted entry would be a
 * worse failure than just losing that one.
 */
export function parseEventOverlay(value: unknown): EventOverlay | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.edits)) return null;
  const edits: Record<string, EventEdit> = {};
  for (const [taskId, raw] of Object.entries(value.edits)) {
    if (!taskId) continue;
    const edit = parseEdit(raw);
    if (edit) edits[taskId] = edit;
  }
  if (!Array.isArray(value.deletedIds) || !value.deletedIds.every((id) => typeof id === "string")) return null;
  return { edits, deletedIds: [...new Set(value.deletedIds)] };
}

export function restoreEventOverlay(storage: Storage): EventOverlay {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_OVERLAY;
    return parseEventOverlay(JSON.parse(raw)) ?? EMPTY_OVERLAY;
  } catch {
    return EMPTY_OVERLAY;
  }
}

export function saveEventOverlay(storage: Storage, overlay: EventOverlay): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(overlay));
}

export function clearEventOverlay(storage: Storage): void {
  storage.removeItem(STORAGE_KEY);
}

/** Merges a correction into whatever this task already had. */
export function setEventEdit(overlay: EventOverlay, taskId: string, edit: EventEdit): EventOverlay {
  return { ...overlay, edits: { ...overlay.edits, [taskId]: { ...overlay.edits[taskId], ...edit } } };
}

export function deleteEvent(overlay: EventOverlay, taskId: string): EventOverlay {
  if (overlay.deletedIds.includes(taskId)) return overlay;
  return { ...overlay, deletedIds: [...overlay.deletedIds, taskId] };
}

/** Back to exactly what HuskyCT sent: drops the edit and the deletion both. */
export function restoreEvent(overlay: EventOverlay, taskId: string): EventOverlay {
  const { [taskId]: dropped, ...edits } = overlay.edits;
  void dropped;
  return { edits, deletedIds: overlay.deletedIds.filter((id) => id !== taskId) };
}

export function noteFor(overlay: EventOverlay, taskId: string): string | null {
  return overlay.edits[taskId]?.note ?? null;
}

/**
 * The feed's tasks, corrected — edits merged in, deletions dropped.
 *
 * Applied after every merge of the raw feeds, never baked into storage, so
 * the raw tasks a re-import produces are exactly what `mergeTasks` gave
 * before this ran.
 */
function withEdit(task: CalendarTask, edit: EventEdit): CalendarTask {
  const start = edit.start ?? task.start;
  const allDay = edit.allDay ?? task.allDay;
  return {
    ...task,
    title: edit.title ?? task.title,
    start,
    // Recomputed whenever either half of the pair moves, never from only one.
    dateKey: allDay ? start.slice(0, 10) : null,
    end: edit.end !== undefined ? edit.end : task.end,
    allDay,
    location: edit.location !== undefined ? edit.location : task.location,
  };
}

export function applyOverlay(tasks: CalendarTask[], overlay: EventOverlay): CalendarTask[] {
  if (overlay.deletedIds.length === 0 && Object.keys(overlay.edits).length === 0) return tasks;
  const deleted = new Set(overlay.deletedIds);
  const out: CalendarTask[] = [];
  for (const task of tasks) {
    if (deleted.has(task.id)) continue;
    const edit = overlay.edits[task.id];
    out.push(edit ? withEdit(task, edit) : task);
  }
  return out;
}
