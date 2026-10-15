import type { EventEdit, EventOverlay } from "./event-overlay.ts";
import { isRecord } from "./is-record.ts";

/**
 * A deadline the teacher moved, and what follows it.
 *
 * A task's id is its source UID and its start, so moving the deadline changes its id. Everything
 * the student did to the task is kept under that id: ticks, a reopening, a note, a correction, the
 * course picked for it. The merge already knows the new task is the old one (the UID is the
 * same); a `Move` says so, and the helpers below carry each kind of saved choice across, so a
 * deadline moved from Friday to Sunday is still ticked, still noted, still its course's.
 */
export type Move = {
  uid: string;
  /** The task id before, and after. */
  from: string;
  to: string;
  /** The start before, and after. */
  fromStart: string;
  toStart: string;
};

/** What the student sees beside a moved task, until it expires or is dismissed. */
export type MoveNotice = { from: string; to: string; at: string };
export type MoveLog = Record<string, MoveNotice>;

export const MOVES_STORAGE_KEY = "huskypilot.moves.v1";
/** Fired on the window when the log is written, so the open page reads it again. */
export const MOVES_CHANGED = "huskypilot:moves-changed";
/** A notice is shown this long. */
export const MOVE_NOTICE_DAYS = 7;
const MAX_NOTICES = 200;

/** Where a state kept under task ids wants the moves applied: the old id's value goes to the new id. */
export function moveSet(ids: Set<string>, moves: Move[]): Set<string> {
  const out = new Set(ids);
  for (const move of moves) {
    if (out.delete(move.from)) out.add(move.to);
  }
  return out;
}

export function moveMap<V>(entries: Map<string, V>, moves: Move[]): Map<string, V> {
  const out = new Map(entries);
  for (const move of moves) {
    if (!out.has(move.from)) continue;
    const value = out.get(move.from) as V;
    out.delete(move.from);
    // A value already under the new id is the newer word.
    if (!out.has(move.to)) out.set(move.to, value);
  }
  return out;
}

export function moveRecord<V>(record: Record<string, V>, moves: Move[]): Record<string, V> {
  const out = { ...record };
  for (const move of moves) {
    if (!(move.from in out)) continue;
    const value = out[move.from];
    delete out[move.from];
    if (!(move.to in out)) out[move.to] = value;
  }
  return out;
}

/** What an edit says about when, as opposed to what the student wrote about the task. */
const TIMING: ReadonlyArray<string> = ["start", "end", "dateKey", "allDay"] satisfies Array<keyof EventEdit>;

/**
 * A note, a new title, a place, and a deletion follow the task. A correction of its time does not:
 * it named a time on the old deadline, and the teacher's new time is the right one now.
 */
export function moveOverlay(overlay: EventOverlay, moves: Move[]): EventOverlay {
  const edits = moveRecord(overlay.edits, moves);
  for (const move of moves) {
    if (!(move.from in overlay.edits) || !edits[move.to]) continue;
    const kept = Object.fromEntries(Object.entries(edits[move.to]).filter(([key]) => !TIMING.includes(key)));
    if (Object.keys(kept).length > 0) edits[move.to] = kept as EventEdit;
    else delete edits[move.to];
  }
  return { edits, deletedIds: [...moveSet(new Set(overlay.deletedIds), moves)] };
}

// --- the notices -------------------------------------------------------------------------

/**
 * Records this sync's moves. A task moved again replaces its earlier notice, so it says from the
 * last time to the new one, not a chain.
 */
export function recordMoves(log: MoveLog, moves: Move[], now: Date): MoveLog {
  if (moves.length === 0) return log;
  const out: MoveLog = { ...log };
  for (const move of moves) {
    delete out[move.from];
    out[move.to] = { from: move.fromStart, to: move.toStart, at: now.toISOString() };
  }
  return trim(out);
}

/** Notices still within their week. */
export function activeNotices(log: MoveLog, now: Date): MoveLog {
  const limit = MOVE_NOTICE_DAYS * 86_400_000;
  return Object.fromEntries(Object.entries(log).filter(([, notice]) => now.valueOf() - Date.parse(notice.at) < limit));
}

export function dismissNotice(log: MoveLog, taskId: string): MoveLog {
  if (!(taskId in log)) return log;
  const out = { ...log };
  delete out[taskId];
  return out;
}

function trim(log: MoveLog): MoveLog {
  const entries = Object.entries(log);
  if (entries.length <= MAX_NOTICES) return log;
  entries.sort(([, a], [, b]) => Date.parse(a.at) - Date.parse(b.at));
  return Object.fromEntries(entries.slice(entries.length - MAX_NOTICES));
}

export function parseMoveLog(value: unknown): MoveLog {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.notices)) return {};
  const out: MoveLog = {};
  for (const [id, raw] of Object.entries(value.notices)) {
    if (!isRecord(raw)) continue;
    const { from, to, at } = raw;
    if (typeof from !== "string" || typeof to !== "string" || typeof at !== "string") continue;
    if ([from, to, at].some((text) => Number.isNaN(Date.parse(text)))) continue;
    out[id] = { from, to, at };
  }
  return trim(out);
}

export function restoreMoveLog(storage: Pick<Storage, "getItem">): MoveLog {
  try {
    return parseMoveLog(JSON.parse(storage.getItem(MOVES_STORAGE_KEY) || "null"));
  } catch {
    return {};
  }
}

/** Throws if the browser refuses, so a caller saving with other things can roll them back. */
export function saveMoveLog(storage: Pick<Storage, "setItem" | "removeItem">, log: MoveLog): void {
  if (Object.keys(log).length === 0) storage.removeItem(MOVES_STORAGE_KEY);
  else storage.setItem(MOVES_STORAGE_KEY, JSON.stringify({ version: 1, notices: log }));
}
