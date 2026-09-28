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

export type GradesSnapshot = {
  version: 1;
  term: string | null;
  /** When the helper read the gradebooks. */
  takenAt: string;
  courses: GradesCourse[];
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

export function memoryGradesStore(): GradesStore {
  let snapshot: GradesSnapshot | null = null;
  return {
    get: async () => snapshot,
    put: async (next) => {
      snapshot = next;
    },
    clear: async () => {
      snapshot = null;
    },
  };
}

/** A course is the same course by its code when it has one, else by its id. */
function courseKey(course: GradesCourse): string {
  return course.code ? "code:" + course.code.toUpperCase() : "id:" + course.id;
}

/**
 * A newer reading's courses replace the same courses in the stored one;
 * courses it did not reach are kept. A reading stopped halfway never empties
 * the others.
 */
export function mergeGrades(current: GradesSnapshot | null, incoming: GradesSnapshot): GradesSnapshot {
  const incomingKeys = new Set(incoming.courses.map(courseKey));
  const kept = (current?.courses ?? []).filter((course) => !incomingKeys.has(courseKey(course)));
  return {
    version: 1,
    term: incoming.term ?? current?.term ?? null,
    takenAt: incoming.takenAt,
    courses: [...incoming.courses, ...kept].sort((a, b) => (a.code ?? a.id).localeCompare(b.code ?? b.id)),
  };
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
