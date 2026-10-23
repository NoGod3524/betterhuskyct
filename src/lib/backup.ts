import { isRecord } from "./is-record.ts";
import { writeStorageBatch } from "./storage-batch.ts";
import { parsePlanState, PLAN_DATA_KEY, PLAN_STORAGE_KEY, savePlanState } from "./ai-plan.ts";
import { MAX_CUSTOM_EVENTS } from "./custom-events.ts";
import { MAX_UNDATED_TODOS } from "./undated-todos.ts";
import { MAX_SUBSCRIPTIONS, parseStoredSubscriptions, SUBSCRIPTIONS_STORAGE_KEY } from "./subscriptions.ts";
import { detectMoves, findReceivingSubscription } from "./sync-merge.ts";
import { moveOverlay, moveRecord, moveSet } from "./moved-deadlines.ts";
import { parseEventOverlay } from "./event-overlay.ts";
import { CHANGES_KEY, mergeChangeStores, parseChanges } from "./changes.ts";
import { COURSES_STORAGE_KEY, parseStoredCourseBook, sameCourse } from "./courses.ts";
import { ANNOUNCEMENTS_STORAGE_KEY } from "./announcements.ts";

/**
 * A backup is every `huskypilot.*` value this browser holds, as the text each module saved, in one
 * JSON file. It is the values themselves and not a re-description of them: each module already
 * reads its own value defensively, so a backup from an older version, or an edited one, is as safe
 * to load as what was in storage to begin with.
 *
 * Not in it: the materials' files (the helper brings them again, and the Materials page exports
 * them), and the keys earlier versions wrote a private calendar link to, which nothing reads now.
 */
export const BACKUP_FORMAT = "betterhuskyct-backup";
export const BACKUP_VERSION = 1;

/** A backup bigger than this is not one this app made. */
export const BACKUP_MAX_BYTES = 40 * 1024 * 1024;

/** What a person sees in the summary, and the stored keys that make it up. */
export const BACKUP_GROUPS = [
  { id: "tasks", keys: ["huskypilot.completedTasks.demo.v1", "huskypilot.completedTasks.imported.v1", "huskypilot.completedTasks.custom.v1", "huskypilot.reopened.v1", "huskypilot.syncedDone.v1"] },
  { id: "calendar", keys: ["huskypilot.subscriptions.v1", "huskypilot.customEvents.v1", "huskypilot.eventOverlay.v1", "huskypilot.undatedTodos.v1", "huskypilot.academicCalendar.v1", "huskypilot.reminders.v1"] },
  { id: "announcements", keys: ["huskypilot.announcements.v1", "huskypilot.announcementActions.v1", "huskypilot.announcementVersions.v1", "huskypilot.seen.announcements.v1", "huskypilot.seen.files.v1"] },
  { id: "grades", keys: ["huskypilot.grades.v1"] },
  { id: "changes", keys: [CHANGES_KEY] },
  { id: "courses", keys: ["huskypilot.courses.v1", "huskypilot.courseLabel.v1", "huskypilot.courseColors.v1"] },
  { id: "ai", keys: ["huskypilot.aiPlan.v1", "huskypilot.aiPlanData.v1", "huskypilot.summaryModel.v1"] },
  { id: "settings", keys: ["huskypilot.locale.v1", "huskypilot.theme.v1", "huskypilot.materials.open.v1", "huskypilot.syncStatus.v1", "huskypilot.moves.v1"] },
] as const;

export type BackupGroupId = (typeof BACKUP_GROUPS)[number]["id"];

export const BACKUP_KEYS: readonly string[] = BACKUP_GROUPS.flatMap((group) => group.keys);

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  /** Storage key to the text stored under it. */
  data: Record<string, string>;
};

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createBackup(storage: Reader, now: Date, appVersion: string): Backup {
  const data: Record<string, string> = {};
  for (const key of BACKUP_KEYS) {
    const value = storage.getItem(key);
    if (value !== null) data[key] = value;
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), appVersion, data };
}

export function backupFileName(now: Date): string {
  return `betterhuskyct-backup-${now.toISOString().slice(0, 10)}.json`;
}

export type ParseFailure = "empty" | "unreadable" | "notBackup" | "tooNew" | "tooBig" | "nothing";
export type Parsed = { ok: true; backup: Backup } | { ok: false; reason: ParseFailure };

/** Reads a backup file's text. Anything else, or nothing usable in it, is refused with the reason. */
export function parseBackup(text: string): Parsed {
  if (!text.trim()) return { ok: false, reason: "empty" };
  if (text.length > BACKUP_MAX_BYTES) return { ok: false, reason: "tooBig" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT || !isRecord(raw.data)) return { ok: false, reason: "notBackup" };
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) return { ok: false, reason: "notBackup" };
  if (raw.version > BACKUP_VERSION) return { ok: false, reason: "tooNew" };

  // Only this app's own keys, and only text: nothing else is let into storage. Most values are
  // JSON, but the theme, language and model choice are stored as plain words.
  const data: Record<string, string> = {};
  for (const key of BACKUP_KEYS) {
    const value = (raw.data as Record<string, unknown>)[key];
    if (typeof value === "string") data[key] = value;
  }
  if (Object.keys(data).length === 0) return { ok: false, reason: "nothing" };

  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      version: raw.version,
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
      appVersion: typeof raw.appVersion === "string" ? raw.appVersion : "",
      data,
    },
  };
}

/** How many things a stored value holds: the items of a list, or of the first list inside an object. */
function countIn(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (isRecord(value)) {
    for (const inner of Object.values(value)) if (Array.isArray(inner)) return inner.length;
    return Object.keys(value).length;
  }
  return value === null || value === undefined || value === "" ? 0 : 1;
}

/** What is in a backup, by group, so a person can see what they are about to load. */
export function summarize(backup: Backup): Array<{ id: BackupGroupId; items: number }> {
  return BACKUP_GROUPS.map((group) => {
    let items = 0;
    for (const key of group.keys) {
      const text = backup.data[key];
      if (text === undefined) continue;
      try {
        items += countIn(JSON.parse(text));
      } catch {
        items += text ? 1 : 0; // a plain word, like a theme
      }
    }
    return { id: group.id, items };
  }).filter((entry) => entry.items > 0);
}

const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

/**
 * What is here stays; what is only in the backup is added. Lists are joined without repeating an
 * item, objects are merged key by key, and where both have a plain value the one here is kept.
 */
export function mergeValues(here: unknown, there: unknown): unknown {
  if (Array.isArray(here) && Array.isArray(there)) {
    // An item with an id is the same item whatever else differs; otherwise it is the same if it reads the same.
    const identity = (item: unknown) => {
      const id = isRecord(item) ? (item.id ?? item.uid) : undefined;
      return typeof id === "string" ? "id:" + id : JSON.stringify(item);
    };
    const merged = [...here];
    const positions = new Map(here.map((item, index) => [identity(item), index]));
    for (const item of there) {
      const key = identity(item);
      const index = positions.get(key);
      if (index === undefined) {
        positions.set(key, merged.length);
        merged.push(item);
      } else {
        // A calendar or gradebook can already exist while some of its rows are missing.
        merged[index] = mergeValues(merged[index], item);
      }
    }
    return merged;
  }
  if (isRecord(here) && isRecord(there)) {
    const merged: Record<string, unknown> = { ...here };
    for (const [key, value] of Object.entries(there)) {
      if (UNSAFE.has(key)) continue;
      merged[key] = key in here ? mergeValues(here[key], value) : value;
    }
    return merged;
  }
  return here;
}

export type RestoreMode = "merge" | "replace";

function json(raw: string | null | undefined): unknown {
  try { return JSON.parse(raw ?? "null"); } catch { return null; }
}

/** Course UUIDs belong to a device. Align incoming references before the local-first merge. */
function alignBackupCourses(storage: Reader, data: Record<string, string>): void {
  const local = parseStoredCourseBook(storage.getItem(COURSES_STORAGE_KEY) ?? "null");
  const incoming = parseStoredCourseBook(data[COURSES_STORAGE_KEY] ?? "null");
  if (!local || !incoming) return;
  const known = [...local.courses];
  const idMap = new Map<string, string>();
  const courses = incoming.courses.map(course => {
    const match = known.find(item => item.id === course.id) ?? known.find(item => sameCourse(item, course));
    if (!match) known.push(course);
    const id = match?.id ?? course.id;
    idMap.set(course.id, id);
    return { ...course, id };
  });
  const assignments = Object.fromEntries(Object.entries(incoming.assignments).map(([taskId, courseId]) =>
    [taskId, courseId === null ? null : idMap.get(courseId) ?? courseId]));
  data[COURSES_STORAGE_KEY] = JSON.stringify({ version: 1, courses, assignments });
  for (const [key, list] of [[SUBSCRIPTIONS_STORAGE_KEY, "subscriptions"], [ANNOUNCEMENTS_STORAGE_KEY, "announcements"]] as const) {
    const value = json(data[key]);
    if (!isRecord(value) || !Array.isArray(value[list])) continue;
    data[key] = JSON.stringify({ ...value, [list]: value[list].map(item =>
      isRecord(item) && typeof item.courseId === "string"
        ? { ...item, courseId: idMap.get(item.courseId) ?? item.courseId } : item) });
  }
}

/** Refuse values the normal readers would truncate, before a restore can report success. */
function checkTaskCapacity(key: string, raw: string): void {
  const value = json(raw);
  const list = key === SUBSCRIPTIONS_STORAGE_KEY && isRecord(value) ? value.subscriptions : value;
  const limit = key === SUBSCRIPTIONS_STORAGE_KEY ? MAX_SUBSCRIPTIONS
    : key === "huskypilot.customEvents.v1" ? MAX_CUSTOM_EVENTS
      : key === "huskypilot.undatedTodos.v1" ? MAX_UNDATED_TODOS : null;
  if (limit !== null && Array.isArray(list) && list.length > limit) throw new Error("The combined task lists are full.");
}

/** Keep local deadlines authoritative, while filling missing sources and aligning backup decisions. */
function mergeBackupCalendars(storage: Reader, data: Record<string, string>): boolean {
  const here = storage.getItem(SUBSCRIPTIONS_STORAGE_KEY);
  const there = data[SUBSCRIPTIONS_STORAGE_KEY];
  if (!here || !there) return false;
  checkTaskCapacity(SUBSCRIPTIONS_STORAGE_KEY, here);
  checkTaskCapacity(SUBSCRIPTIONS_STORAGE_KEY, there);
  const local = parseStoredSubscriptions(here), incoming = parseStoredSubscriptions(there);
  if (!local || !incoming) return false;

  const localEvents = local.flatMap((feed) => feed.events);
  // Historical generic UIDs can be recurring instances from different windows.
  const moves = detectMoves(incoming.flatMap((feed) => feed.events), localEvents)
    .filter((move) => /^huskyct-(todo|calendar)-/.test(move.uid));
  const moved = new Map(moves.map((move) => [move.from, move.to]));
  const byId = new Map(localEvents.map((event) => [event.id, event]));
  const seen = new Set(byId.keys());
  for (const feed of incoming) {
    const events = feed.events.map((event) => byId.get(moved.get(event.id) ?? event.id) ?? event);
    const target = local.find((entry) => entry.id === feed.id) ?? findReceivingSubscription(local, { ...feed, events });
    const extra = events.filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });
    if (target) local[local.indexOf(target)] = { ...target, events: [...target.events, ...extra] };
    else if (extra.length > 0) local.push({ ...feed, events: extra });
  }
  data[SUBSCRIPTIONS_STORAGE_KEY] = JSON.stringify({ version: 1, subscriptions: local });

  for (const key of ["huskypilot.completedTasks.imported.v1", "huskypilot.reopened.v1", "huskypilot.syncedDone.v1", "huskypilot.courses.v1", "huskypilot.eventOverlay.v1", "huskypilot.moves.v1"]) {
    const value = json(data[key]);
    if (moves.length === 0 || value === null) continue;
    let aligned = value;
    if (key === "huskypilot.reopened.v1" && Array.isArray(value)) aligned = [...moveSet(new Set(value), moves)];
    else if (key === "huskypilot.syncedDone.v1" && isRecord(value)) aligned = moveRecord(value, moves);
    else if (isRecord(value)) {
      if (Array.isArray(value.completedIds)) aligned = { ...value, completedIds: [...moveSet(new Set(value.completedIds), moves)] };
      else if (isRecord(value.assignments)) aligned = { ...value, assignments: moveRecord(value.assignments, moves) };
      else if (isRecord(value.notices)) {
        const notices = { ...value.notices };
        for (const move of moves) delete notices[move.from];
        aligned = { ...value, notices };
      }
      else if (key === "huskypilot.eventOverlay.v1") {
        const overlay = parseEventOverlay(value);
        if (overlay) aligned = moveOverlay(overlay, moves);
      }
    }
    data[key] = JSON.stringify(aligned);
  }
  return true;
}

/**
 * Puts a backup into storage. If anything goes wrong part-way (the disk is full, say), what was
 * there before is put back, so a restore is all of it or none of it.
 */
export function restoreBackup(storage: Writer, backup: Backup, mode: RestoreMode): { ok: true } | { ok: false } {
  try {
    const data = { ...backup.data };
    if (mode === "merge") alignBackupCourses(storage, data);
    const calendarsMerged = mode === "merge" && mergeBackupCalendars(storage, data);
    // Legacy backups keep results beside permission. Copy only their results into the new data key.
    if (data[PLAN_DATA_KEY] === undefined && data[PLAN_STORAGE_KEY] !== undefined) data[PLAN_DATA_KEY] = data[PLAN_STORAGE_KEY];
    writeStorageBatch(storage, (staged) => {
      const put = (key: string, value: string) => { checkTaskCapacity(key, value); staged.setItem(key, value); };
      for (const key of BACKUP_KEYS) {
        // Merge never writes permission, including during rollback or into a fresh browser.
        if (mode === "merge" && key === PLAN_STORAGE_KEY) continue;
        const incoming = data[key];
        if (key === CHANGES_KEY && incoming !== undefined && mode === "merge") {
          put(key, JSON.stringify(mergeChangeStores(parseChanges(storage.getItem(key)), parseChanges(incoming), new Date())));
          continue;
        }
        if (key === PLAN_DATA_KEY && incoming !== undefined) {
          const current = mode === "merge" ? storage.getItem(key) ?? storage.getItem(PLAN_STORAGE_KEY) : null;
          const merged = current === null ? parsePlanState(incoming)
            : parsePlanState(JSON.stringify(mergeValues(parsePlanState(current), parsePlanState(incoming))));
          savePlanState(staged, merged);
          continue;
        }
        if (mode === "replace") {
          if (incoming === undefined) staged.removeItem(key);
          else put(key, incoming);
          continue;
        }
        if (incoming === undefined) continue;
        if (key === SUBSCRIPTIONS_STORAGE_KEY && calendarsMerged) { put(key, incoming); continue; }
        const current = storage.getItem(key);
        if (current === null) {
          put(key, incoming);
          continue;
        }
        let merged: unknown;
        try {
          merged = mergeValues(JSON.parse(current), JSON.parse(incoming));
        } catch {
          continue; // a plain word, or a value that cannot be read: the one here stays
        }
        put(key, JSON.stringify(merged));
      }
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
