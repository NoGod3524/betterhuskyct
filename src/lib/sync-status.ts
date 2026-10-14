import { isRecord } from "./is-record.ts";

/**
 * What the last sync read, course by course, and when each part was last read at all.
 *
 * Without it, a course with no work in it looks the same as a course whose data the helper could
 * not read this time. The helper sends which parts it read with the end of a sync started here;
 * this keeps, for each part, the last time it was read and whether the latest sync missed it.
 */
export const SYNC_STATUS_KEY = "huskypilot.syncStatus.v1";
/** Fired on the window when the status is written, so what shows it reads it again. */
export const SYNC_STATUS_CHANGED = "huskypilot:sync-status";

const MAX_COURSES = 60;

/** What the helper says it read in one sync. */
export type ReadReport = {
  dueDates: boolean;
  todo: boolean;
  courses: Array<{ id: string; code: string | null; announcements: boolean; grades: boolean; files: boolean }>;
};

/** One part: when it was last read, and whether the latest sync missed it. */
export type PartStatus = { lastRead: string | null; missed: boolean };
export type CourseStatus = { id: string; code: string | null; announcements: PartStatus; grades: PartStatus; files: PartStatus };
export type SyncStatus = { version: 1; lastSync: string; dueDates: PartStatus; todo: PartStatus; courses: CourseStatus[] };

export const COURSE_PARTS = ["announcements", "grades", "files"] as const;
export type CoursePart = (typeof COURSE_PARTS)[number];

/** The helper's report, or null if it is not one. */
export function parseReadReport(value: unknown): ReadReport | null {
  if (!isRecord(value) || typeof value.dueDates !== "boolean" || typeof value.todo !== "boolean" || !Array.isArray(value.courses)) return null;
  const courses: ReadReport["courses"] = [];
  for (const raw of value.courses.slice(0, MAX_COURSES)) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id || raw.id.length > 100) return null;
    if (typeof raw.announcements !== "boolean" || typeof raw.grades !== "boolean" || typeof raw.files !== "boolean") return null;
    const code = typeof raw.code === "string" && raw.code ? raw.code.slice(0, 40) : null;
    courses.push({ id: raw.id, code, announcements: raw.announcements, grades: raw.grades, files: raw.files });
  }
  return { dueDates: value.dueDates, todo: value.todo, courses };
}

const part = (read: boolean, before: PartStatus | undefined, at: string): PartStatus => ({
  lastRead: read ? at : (before?.lastRead ?? null),
  missed: !read,
});

/**
 * The status after a sync: what it read is read now, what it missed keeps the time it was last
 * read. The course list is the sync's: a course from an earlier term drops out.
 */
export function applyReadReport(before: SyncStatus | null, report: ReadReport, now: Date): SyncStatus {
  const at = now.toISOString();
  const earlier = new Map((before?.courses ?? []).map((course) => [course.id, course]));
  return {
    version: 1,
    lastSync: at,
    dueDates: part(report.dueDates, before?.dueDates, at),
    todo: part(report.todo, before?.todo, at),
    courses: report.courses.map((course) => {
      const old = earlier.get(course.id);
      return {
        id: course.id,
        code: course.code ?? old?.code ?? null,
        announcements: part(course.announcements, old?.announcements, at),
        grades: part(course.grades, old?.grades, at),
        files: part(course.files, old?.files, at),
      };
    }),
  };
}

function parsePart(value: unknown): PartStatus | null {
  if (!isRecord(value) || typeof value.missed !== "boolean") return null;
  const lastRead = typeof value.lastRead === "string" && !Number.isNaN(Date.parse(value.lastRead)) ? value.lastRead : null;
  return { lastRead, missed: value.missed };
}

/** What is stored, or null for nothing or a damaged value. */
export function parseSyncStatus(value: unknown): SyncStatus | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.lastSync !== "string" || Number.isNaN(Date.parse(value.lastSync))) return null;
  const dueDates = parsePart(value.dueDates);
  const todo = parsePart(value.todo);
  if (!dueDates || !todo || !Array.isArray(value.courses)) return null;
  const courses: CourseStatus[] = [];
  for (const raw of value.courses.slice(0, MAX_COURSES)) {
    if (!isRecord(raw) || typeof raw.id !== "string") return null;
    const parts = COURSE_PARTS.map((name) => parsePart(raw[name]));
    if (parts.some((p) => p === null)) return null;
    const [announcements, grades, files] = parts as PartStatus[];
    courses.push({ id: raw.id, code: typeof raw.code === "string" ? raw.code : null, announcements, grades, files });
  }
  return { version: 1, lastSync: value.lastSync, dueDates, todo, courses };
}

export function readSyncStatus(storage: Pick<Storage, "getItem">): SyncStatus | null {
  try {
    return parseSyncStatus(JSON.parse(storage.getItem(SYNC_STATUS_KEY) || "null"));
  } catch {
    return null;
  }
}

/** Records a sync's report. Storage that refuses is not an error: the status is a convenience. */
export function recordReadReport(storage: Pick<Storage, "getItem" | "setItem">, report: ReadReport, now: Date): SyncStatus {
  const next = applyReadReport(readSyncStatus(storage), report, now);
  try {
    storage.setItem(SYNC_STATUS_KEY, JSON.stringify(next));
  } catch {
    /* shown for this visit only */
  }
  return next;
}

/** What the latest sync missed, as [course label, part] pairs, the overall parts first. */
export function missedParts(status: SyncStatus): Array<{ course: string | null; part: CoursePart | "dueDates" | "todo" }> {
  const out: Array<{ course: string | null; part: CoursePart | "dueDates" | "todo" }> = [];
  if (status.dueDates.missed) out.push({ course: null, part: "dueDates" });
  if (status.todo.missed) out.push({ course: null, part: "todo" });
  for (const course of status.courses) {
    for (const name of COURSE_PARTS) if (course[name].missed) out.push({ course: course.code ?? course.id, part: name });
  }
  return out;
}

/** How long ago, in the largest whole unit: under a minute is "now". */
export function agoUnit(then: string, now: Date): { unit: "now" | "minutes" | "hours" | "days"; count: number } {
  const minutes = Math.max(0, Math.floor((now.valueOf() - Date.parse(then)) / 60_000));
  if (minutes < 1) return { unit: "now", count: 0 };
  if (minutes < 60) return { unit: "minutes", count: minutes };
  if (minutes < 60 * 24) return { unit: "hours", count: Math.floor(minutes / 60) };
  return { unit: "days", count: Math.floor(minutes / (60 * 24)) };
}
