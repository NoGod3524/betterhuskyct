/**
 * Grades — each course's gradebook rows, kept in this browser.
 *
 * They arrive the way course materials do: after "Collect grades" on HuskyCT,
 * the helper opens this app's Grades page and posts what it read, tab to tab,
 * with `postMessage`. Only HuskyCT's own pages have the student's session, so
 * only they can read a gradebook; this app never talks to HuskyCT itself, and
 * nothing goes through a server.
 *
 * What the helper sends is untrusted input from another origin, so every
 * message is checked here — its origin, its shape, its sizes — before anything
 * is stored, and a message that does not fit is dropped whole.
 */
import { HUSKYCT_ORIGINS } from "@/lib/materials";

/** Bumped only if the messages change shape; both sides check it. */
export const GRADES_PROTOCOL = "betterhuskyct/grades@1";

const MAX_COURSES = 60;
const MAX_ITEMS_PER_COURSE = 1000;
const MAX_TEXT = 400;
const MAX_POINTS = 1_000_000;

/**
 * One gradebook row. `earned` and `possible` are both set when HuskyCT shows a
 * score ("105/100"), both null when it does not; `label` then holds what it
 * shows instead ("Not graded", a letter, "Exempt").
 */
export type GradeItem = {
  /** HuskyCT's id for the row, like `_3853153_1`. */
  id: string;
  title: string;
  /** The line under the title: "1 attempt submitted (1 Late)". */
  status: string | null;
  earned: number | null;
  possible: number | null;
  label: string | null;
};

export type GradesCourse = {
  id: string;
  code: string | null;
  items: GradeItem[];
};

/**
 * A score that is new or different since the last time the student looked.
 *
 * Only scores: an assignment that merely appears in the gradebook is not news
 * until it has a grade. `from` is what the student last saw (null if it had no
 * score, or did not exist), and it stays the same across readings until they
 * mark the change seen, so "was 80" means 80 the last time they knew.
 */
export type GradeChange = {
  courseId: string;
  itemId: string;
  /** "graded": had no score. "changed": had another. "new": did not exist. */
  kind: "graded" | "changed" | "new";
  from: { earned: number; possible: number } | null;
  /** The reading that first showed it. */
  at: string;
};

export type GradesSnapshot = {
  version: 1;
  term: string | null;
  /** When the helper read the gradebooks. */
  takenAt: string;
  courses: GradesCourse[];
  /**
   * What changed, kept until seen. The helper never sends this: it is worked
   * out here from two readings, and a message that carries it has it dropped.
   */
  changes?: GradeChange[];
};

export type IncomingGradesMessage = { kind: "hello" } | { kind: "grades"; grades: GradesSnapshot };

// --- checking what arrives -------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, limit = MAX_TEXT): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= limit ? value : null;
}

function points(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_POINTS ? value : null;
}

const isHuskyctId = (value: unknown): value is string => typeof value === "string" && /^_\d+_\d+$/.test(value);

function readItem(value: unknown): GradeItem | null {
  if (!isRecord(value) || !isHuskyctId(value.id)) return null;
  const title = text(value.title);
  if (!title) return null;
  const status = value.status === null ? null : text(value.status);
  if (value.status !== null && status === null) return null;

  const scored = value.earned !== null || value.possible !== null;
  if (scored) {
    // A score is both halves, and then there is nothing else to show.
    const earned = points(value.earned);
    const possible = points(value.possible);
    if (earned === null || possible === null || value.label !== null) return null;
    return { id: value.id, title, status, earned, possible, label: null };
  }
  const label = value.label === null ? null : text(value.label, 100);
  if (value.label !== null && label === null) return null;
  return { id: value.id, title, status, earned: null, possible: null, label };
}

function readCourse(value: unknown): GradesCourse | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 100);
  const code = value.code === null ? null : text(value.code, 40);
  if (!id || (value.code !== null && code === null)) return null;
  if (!Array.isArray(value.items) || value.items.length > MAX_ITEMS_PER_COURSE) return null;
  const items: GradeItem[] = [];
  for (const raw of value.items) {
    const item = readItem(raw);
    if (!item) return null;
    items.push(item);
  }
  return { id, code, items };
}

export function parseGradesSnapshot(value: unknown): GradesSnapshot | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (!Array.isArray(value.courses) || value.courses.length > MAX_COURSES) return null;
  const courses: GradesCourse[] = [];
  for (const raw of value.courses) {
    const course = readCourse(raw);
    if (!course) return null;
    courses.push(course);
  }
  const term = value.term === null ? null : text(value.term, 60);
  if (value.term !== null && term === null) return null;
  const takenAt = text(value.takenAt, 40);
  if (!takenAt || Number.isNaN(Date.parse(takenAt))) return null;
  return { version: 1, term, takenAt, courses };
}

const MAX_CHANGES = 500;

function readChange(value: unknown): GradeChange | null {
  if (!isRecord(value) || !isHuskyctId(value.itemId)) return null;
  const courseId = text(value.courseId, 100);
  const at = text(value.at, 40);
  if (!courseId || !at || Number.isNaN(Date.parse(at))) return null;
  if (value.kind !== "graded" && value.kind !== "changed" && value.kind !== "new") return null;
  let from: GradeChange["from"] = null;
  if (value.from !== null) {
    if (!isRecord(value.from)) return null;
    const earned = points(value.from.earned);
    const possible = points(value.from.possible);
    if (earned === null || possible === null) return null;
    from = { earned, possible };
  }
  // "graded" and "new" had no score to remember; "changed" had one.
  if ((value.kind === "changed") !== (from !== null)) return null;
  return { courseId, itemId: value.itemId, kind: value.kind, from, at };
}

/**
 * The grades as this browser stored them: a reading, plus the changes worked
 * out when it arrived. Anything that does not fit is dropped, as with a
 * message; a change that does not fit is dropped alone, not the grades.
 */
export function parseStoredGrades(value: unknown): GradesSnapshot | null {
  const snapshot = parseGradesSnapshot(value);
  if (!snapshot || !isRecord(value) || !Array.isArray(value.changes)) return snapshot;
  const changes = value.changes.slice(0, MAX_CHANGES).flatMap((raw) => {
    const change = readChange(raw);
    return change ? [change] : [];
  });
  return changes.length ? { ...snapshot, changes } : snapshot;
}

/** A message from the helper, or null. Anything but exactly one of the two kinds is ignored. */
export function parseGradesMessage(data: unknown): IncomingGradesMessage | null {
  if (!isRecord(data) || data.protocol !== GRADES_PROTOCOL) return null;
  if (data.kind === "hello") return { kind: "hello" };
  if (data.kind === "grades") {
    const grades = parseGradesSnapshot(data.grades);
    return grades ? { kind: "grades", grades } : null;
  }
  return null;
}

// --- reading the numbers ---------------------------------------------------------

export type GradeSummary = {
  /** Rows with a score out of more than zero points — the ones that count. */
  graded: number;
  total: number;
  earned: number;
  possible: number;
  /** Earned over possible, to a tenth of a percent; null while nothing counts. */
  percent: number | null;
};

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** A row that adds to the total: a score out of some points. `0/0` practice work does not. */
export function isCounted(item: GradeItem): item is GradeItem & { earned: number; possible: number } {
  return item.earned !== null && item.possible !== null && item.possible > 0;
}

/**
 * The graded work so far. It is a sum of what HuskyCT shows, nothing more:
 * category weights, dropped scores and extra-credit rules are not on the page,
 * so this is not the course grade and the app says so wherever it shows it.
 */
export function summarizeCourse(course: GradesCourse): GradeSummary {
  let earned = 0;
  let possible = 0;
  let graded = 0;
  for (const item of course.items) {
    if (!isCounted(item)) continue;
    graded++;
    earned += item.earned;
    possible += item.possible;
  }
  earned = round(earned, 2);
  possible = round(possible, 2);
  return {
    graded,
    total: course.items.length,
    earned,
    possible,
    percent: possible > 0 ? round((earned / possible) * 100, 1) : null,
  };
}

/** 105 -> "105", 81.3 -> "81.3", 81.30000000000001 -> "81.3". */
export function formatPoints(value: number): string {
  return String(round(value, 2));
}

/** A course's gradebook on HuskyCT, when its id is one. */
export function huskyctGradesUrl(course: GradesCourse): string | null {
  return isHuskyctId(course.id) ? `https://lms.uconn.edu/ultra/courses/${course.id}/grades` : null;
}

// --- the store ---------------------------------------------------------------------

/** Where the grades live. localStorage in the page; memory in tests. */
export type GradesStore = {
  get(): Promise<GradesSnapshot | null>;
  put(snapshot: GradesSnapshot): Promise<void>;
  clear(): Promise<void>;
};

/**
 * Courses are told apart by HuskyCT's id, which the helper always sends. Not by
 * code: a term can hold two courses with one code (a lecture and its lab both
 * read "STAT 1000Q"), and a reading of one must not replace the other.
 */
const courseKey = (course: GradesCourse) => course.id;

type Score = { earned: number; possible: number };

const scoreOf = (item: GradeItem | undefined): Score | null =>
  item && isCounted(item) ? { earned: item.earned, possible: item.possible } : null;

const sameScore = (a: Score | null, b: Score | null) =>
  a === null || b === null ? a === b : a.earned === b.earned && a.possible === b.possible;

/**
 * What a reading shows that the stored one did not, item by item, for courses
 * the student already had. A course seen for the first time is the baseline,
 * not a wall of "new".
 */
function diffCourse(before: GradesCourse, after: GradesCourse, at: string): GradeChange[] {
  const previous = new Map(before.items.map((item) => [item.id, item]));
  const changes: GradeChange[] = [];
  for (const item of after.items) {
    const now = scoreOf(item);
    if (!now) continue; // a score going away is not news
    const was = previous.get(item.id);
    const from = scoreOf(was);
    if (sameScore(from, now)) continue;
    changes.push({
      courseId: after.id,
      itemId: item.id,
      kind: !was ? "new" : from ? "changed" : "graded",
      from,
      at,
    });
  }
  return changes;
}

/**
 * Changes still worth showing after a reading: those the student has not seen,
 * for items that still have the score they were flagged for, plus what this
 * reading added. A change carried over keeps its original `from`, so the
 * student is told what changed since they last knew, however many readings ago.
 */
function carryChanges(current: GradesSnapshot | null, incoming: GradesSnapshot): GradeChange[] {
  if (!current) return [];
  const before = new Map(current.courses.map((course) => [course.id, course]));
  const reached = new Set(incoming.courses.map(courseKey));
  const fresh = incoming.courses.flatMap((course) => {
    const old = before.get(course.id);
    return old ? diffCourse(old, course, incoming.takenAt) : [];
  });
  const freshKey = (change: GradeChange) => change.courseId + "\u0000" + change.itemId;
  const freshByItem = new Map(fresh.map((change) => [freshKey(change), change]));

  const out: GradeChange[] = [];
  for (const old of current.changes ?? []) {
    if (!reached.has(old.courseId)) {
      out.push(old); // this reading did not reach the course: nothing to update
      continue;
    }
    const course = incoming.courses.find((entry) => entry.id === old.courseId);
    const now = scoreOf(course?.items.find((item) => item.id === old.itemId));
    if (!now) continue; // the item, or its score, is gone
    const again = freshByItem.get(freshKey(old));
    if (again) {
      // Changed again before it was seen: the delta is from what they last saw.
      freshByItem.delete(freshKey(old));
      if (sameScore(old.from, now)) continue; // back where it started
      out.push({ ...old, kind: old.kind === "new" ? "new" : old.from ? "changed" : "graded", at: incoming.takenAt });
    } else if (!sameScore(old.from, now) || old.kind === "new") {
      out.push(old); // still differs from what they saw, and nothing newer
    }
  }
  out.push(...freshByItem.values());
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_CHANGES);
}

/**
 * A newer reading's courses replace the same courses in the stored one;
 * courses it did not reach are kept. A reading stopped halfway never empties
 * the others. What the reading changes about scores is worked out against the
 * stored one, and kept until the student marks it seen.
 */
export function mergeGrades(current: GradesSnapshot | null, incoming: GradesSnapshot): GradesSnapshot {
  const incomingKeys = new Set(incoming.courses.map(courseKey));
  const kept = (current?.courses ?? []).filter((course) => !incomingKeys.has(courseKey(course)));
  const changes = carryChanges(current, incoming);
  return {
    version: 1,
    term: incoming.term ?? current?.term ?? null,
    takenAt: incoming.takenAt,
    courses: [...incoming.courses, ...kept].sort(
      (a, b) => (a.code ?? a.id).localeCompare(b.code ?? b.id) || a.id.localeCompare(b.id),
    ),
    ...(changes.length ? { changes } : {}),
  };
}

/** The same grades with every change marked seen. */
export function markChangesSeen(snapshot: GradesSnapshot): GradesSnapshot {
  const { changes, ...rest } = snapshot;
  void changes;
  return rest;
}

// --- receiving from the helper ------------------------------------------------------

export type GradesReceiveState = {
  phase: "idle" | "connected" | "done" | "failed";
  courses: number;
  items: number;
};

type Source = { postMessage(message: unknown, targetOrigin: string): void };
export type GradesEvent = { origin: string; data: unknown; source: Source | null };

/**
 * Answers the helper, one message at a time. Only HuskyCT's origins are heard,
 * and every reply goes back to the exact origin that asked: `hello` is
 * answered with `ready`, and a reading with `stored` once it is kept (or could
 * not be), so the helper knows whether to say it arrived.
 */
export function createGradesReceiver(options: { store: GradesStore; onChange?: (state: GradesReceiveState) => void }) {
  let state: GradesReceiveState = { phase: "idle", courses: 0, items: 0 };
  const update = (patch: Partial<GradesReceiveState>) => {
    state = { ...state, ...patch };
    options.onChange?.(state);
  };

  return async function receive(event: GradesEvent): Promise<void> {
    if (!HUSKYCT_ORIGINS.has(event.origin) || !event.source) return;
    const message = parseGradesMessage(event.data);
    if (!message) return;
    const source = event.source;
    const reply = (payload: Record<string, unknown>) => source.postMessage({ protocol: GRADES_PROTOCOL, ...payload }, event.origin);

    if (message.kind === "hello") {
      reply({ kind: "ready" });
      if (state.phase !== "connected") update({ phase: "connected", courses: 0, items: 0 });
      return;
    }
    try {
      await options.store.put(mergeGrades(await options.store.get(), message.grades));
      reply({ kind: "stored", ok: true });
      update({
        phase: "done",
        courses: message.grades.courses.length,
        items: message.grades.courses.reduce((total, course) => total + course.items.length, 0),
      });
    } catch {
      reply({ kind: "stored", ok: false });
      update({ phase: "failed" });
    }
  };
}
