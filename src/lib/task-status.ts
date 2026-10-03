/**
 * Which deadlines are already done, worked out from HuskyCT instead of from
 * ticks.
 *
 * A tick only means something if the student remembers to make it, and nobody
 * does: a homework handed in on HuskyCT stayed "to do" here until it was ticked
 * a second time by hand. HuskyCT already knows. Its gradebook says "1 attempt
 * submitted" next to a homework, or shows a score, so a deadline whose title and
 * course match a gradebook row that says so is done.
 *
 * It errs towards leaving a task open. A task marked done wrongly drops out of
 * the to-do list, the plan and the reminders, which is worse than one that stays
 * a little longer: so a task is matched only on its course *and* its whole
 * title, and not when two rows share that title and only one of them is done.
 * A student can always reopen one (`reopened`), and a manual tick still counts.
 */
import type { CalendarTask } from "./calendar-types.ts";
import { isDeadline } from "./calendar-types.ts";
import { isCounted, type GradeItem, type GradesSnapshot } from "./grades.ts";

/** Why HuskyCT says a deadline is done: handed in, or already graded. */
export type DoneReason = "submitted" | "graded";

/** What the page shows beside a done task: those two, or the student's own tick. */
export type DoneLabel = DoneReason | "ticked";

/**
 * A title as two systems would both spell it: the calendar says "Section 4.1
 * Homework", maybe with "is due" after it; the gradebook may add "(Content
 * isn't available)". Case, spacing and punctuation do not tell tasks apart.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\((?:content )?isn['’]t available\)/g, " ")
    .replace(/\s*[-–—:,]?\s*\b(?:is\s+)?due\s*$/, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** `MATH 1070Q`, `math-1070q` and `MATH1070Q` are one course. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** What a gradebook row says about whether the work is in, or null if it does not say. */
export function doneReasonOf(item: GradeItem): DoneReason | null {
  // A score out of some points: someone has graded it, so there is nothing left to hand in.
  if (isCounted(item)) return "graded";
  if (item.label && /\bcomplete\b/i.test(item.label)) return "graded";
  // "1 attempt submitted" (and "2 attempts submitted (1 Late)"), but not "Attempt 2 started".
  if (item.status && /\battempts?\s+submitted\b/i.test(item.status)) return "submitted";
  if (item.status && /^first participated\b/i.test(item.status)) return "submitted";
  return null;
}

type TitleState = { rows: number; done: number; reason: DoneReason };

function stronger(a: DoneReason, b: DoneReason): DoneReason {
  return a === "graded" || b === "graded" ? "graded" : "submitted";
}

/**
 * The deadlines the gradebook says are done, with the reason.
 *
 * `codeOf` is the course the student sees on the task (their own pick, the
 * feed's, or the catalogue's). A task with no course is matched on its title
 * alone only if every row in the gradebook with that title is done.
 */
export function autoDoneTasks(
  tasks: CalendarTask[],
  grades: GradesSnapshot | null,
  codeOf: (task: CalendarTask) => string | null,
): Map<string, DoneReason> {
  const done = new Map<string, DoneReason>();
  if (!grades) return done;

  const byCourse = new Map<string, Map<string, TitleState>>();
  const everywhere = new Map<string, TitleState>();
  const note = (map: Map<string, TitleState>, title: string, reason: DoneReason | null) => {
    const state = map.get(title) ?? { rows: 0, done: 0, reason: "submitted" as DoneReason };
    state.rows += 1;
    if (reason) {
      state.done += 1;
      state.reason = stronger(state.reason, reason);
    }
    map.set(title, state);
  };

  for (const course of grades.courses) {
    // Two courses can share a code (a lecture and its lab): they are one course here.
    const code = course.code ? normalizeCode(course.code) : null;
    const titles = code ? (byCourse.get(code) ?? new Map<string, TitleState>()) : null;
    if (code && titles) byCourse.set(code, titles);
    for (const item of course.items) {
      const title = normalizeTitle(item.title);
      if (!title) continue;
      const reason = doneReasonOf(item);
      if (titles) note(titles, title, reason);
      note(everywhere, title, reason);
    }
  }

  const allDone = (state: TitleState | undefined) => (state && state.done === state.rows ? state.reason : null);
  for (const task of tasks) {
    if (!isDeadline(task)) continue;
    const title = normalizeTitle(task.title);
    if (!title) continue;
    const code = codeOf(task);
    const reason = code ? allDone(byCourse.get(normalizeCode(code))?.get(title)) : allDone(everywhere.get(title));
    if (reason) done.set(task.id, reason);
  }
  return done;
}

// --- reopened ----------------------------------------------------------------------------

/** Tasks the student says are *not* done although HuskyCT's gradebook looks as if they are. */
export const REOPENED_STORAGE_KEY = "huskypilot.reopened.v1";

export function restoreReopened(storage: Pick<Storage, "getItem">): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(REOPENED_STORAGE_KEY) || "null");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length < 500).slice(0, 2000));
  } catch {
    return new Set();
  }
}

export function saveReopened(storage: Pick<Storage, "setItem" | "removeItem">, ids: Set<string>): void {
  try {
    if (ids.size === 0) storage.removeItem(REOPENED_STORAGE_KEY);
    else storage.setItem(REOPENED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* the choice holds for this visit and is forgotten after */
  }
}

/**
 * Every task that is done, and the reason: the student's own tick wins the
 * label, then HuskyCT's word; a task they reopened is not done however the
 * gradebook reads.
 */
export function doneLabels(
  manual: Set<string>,
  auto: Map<string, DoneReason>,
  reopened: Set<string>,
): Map<string, DoneLabel> {
  const out = new Map<string, DoneLabel>();
  for (const [id, reason] of auto) if (!reopened.has(id)) out.set(id, reason);
  for (const id of manual) out.set(id, "ticked");
  return out;
}

// --- from another device ------------------------------------------------------------------

/**
 * What HuskyCT's gradebook said on another device, kept here beside this device's
 * own reading. A phone has no gradebook of its own (the helper runs on a computer),
 * so without this, work handed in on the computer would show as open on the phone.
 */
export const SYNCED_DONE_STORAGE_KEY = "huskypilot.syncedDone.v1";
const REASONS: ReadonlyArray<DoneReason> = ["submitted", "graded"];

/** A reason read from storage or a link: anything else is dropped rather than trusted. */
export function parseDoneReason(value: unknown): DoneReason | null {
  return typeof value === "string" && (REASONS as ReadonlyArray<string>).includes(value) ? (value as DoneReason) : null;
}

export function restoreSyncedDone(storage: Pick<Storage, "getItem">): Map<string, DoneReason> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SYNCED_DONE_STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    return doneMapFrom(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export function saveSyncedDone(storage: Pick<Storage, "setItem" | "removeItem">, done: Map<string, DoneReason>): void {
  try {
    if (done.size === 0) storage.removeItem(SYNCED_DONE_STORAGE_KEY);
    else storage.setItem(SYNCED_DONE_STORAGE_KEY, JSON.stringify(Object.fromEntries(done)));
  } catch {
    /* forgotten after this visit; the next sync brings it back */
  }
}

/**
 * The union of two sets of done tasks, keeping the stronger reason where both
 * know one. Only ever adds: a sync can say a task is done, never that it is not.
 */
export function mergeDone(local: Map<string, DoneReason>, incoming: Iterable<[string, DoneReason]>): Map<string, DoneReason> {
  const out = new Map(local);
  for (const [id, reason] of incoming) {
    const known = out.get(id);
    out.set(id, known ? stronger(known, reason) : reason);
  }
  return out;
}

/** Keeps only well-formed entries of a record that came from a link. */
export function doneMapFrom(entries: Iterable<[string, unknown]>): Map<string, DoneReason> {
  const out = new Map<string, DoneReason>();
  let kept = 0;
  for (const [id, value] of entries) {
    const reason = parseDoneReason(value);
    if (!id || id.length >= 500 || !reason) continue;
    out.set(id, reason);
    if (++kept >= 5000) break;
  }
  return out;
}
