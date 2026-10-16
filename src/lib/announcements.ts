/**
 * Course announcements use HuskyCT's course and announcement ids when available.
 * Legacy records keep their original content hash. API timestamps are ISO; old
 * page text is retained without guessing which timezone or instant it described.
 */

import { contentHash } from "./content-hash.ts";
import { isRecord } from "./is-record.ts";

export const ANNOUNCEMENTS_STORAGE_KEY = "huskypilot.announcements.v1";
const ANNOUNCEMENTS_STORAGE_VERSION = 1;

/**
 * Caps, because this travels in a URL fragment.
 *
 * A fragment is not a database: the whole payload has to fit in about 32 KB
 * once gzipped and base64url'd, and a term of announcements with full bodies
 * can approach that on its own. The helper's own guard is 32 KB for a term of
 * 120 deadlines at ~1.4 KB, so these numbers leave the deadlines plenty of room.
 */
export const MAX_ANNOUNCEMENTS = 400;
export const MAX_ANNOUNCEMENT_BODY = 1_200;

export type Announcement = {
  /** Source identity when available, otherwise the legacy content hash. */
  id: string;
  /** HuskyCT ids, independent of this device's local course UUID. */
  sourceId?: string;
  sourceCourseId?: string;
  /** Resolved to a local course when one matches; null when none does. */
  courseId: string | null;
  /** The course as the page named it, so an unmatched one is still readable. */
  courseCode: string | null;
  title: string;
  body: string;
  /** An ISO timestamp from the API, or the original text from an older collector. */
  posted: string | null;
  /** When this device (or the device that sent it) actually saw it. */
  announced: string;
};

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isAnnouncement(value: unknown): value is Announcement {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (value.sourceId === undefined || (typeof value.sourceId === "string" && value.sourceId.length > 0)) &&
    (value.sourceCourseId === undefined || (typeof value.sourceCourseId === "string" && value.sourceCourseId.length > 0)) &&
    (typeof value.courseId === "string" || value.courseId === null) &&
    (typeof value.courseCode === "string" || value.courseCode === null) &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    (typeof value.posted === "string" || value.posted === null) &&
    isValidDateString(value.announced)
  );
}

/**
 * Source ids survive edits and timezone changes. Without both source ids, keep
 * the legacy hash: matching only a title or date cannot establish a migration.
 */
export function computeAnnouncementId(input: {
  courseCode: string | null;
  title: string;
  posted: string | null;
  sourceId?: string;
  sourceCourseId?: string;
}): string {
  if (input.sourceCourseId && input.sourceId) {
    return `huskyct-announcement:${encodeURIComponent(JSON.stringify([input.sourceCourseId, input.sourceId]))}`;
  }
  return contentHash(
    `${input.courseCode ?? ""}|${input.title}|${input.posted ?? ""}`,
  );
}

function clamp(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

/** Collapses the whitespace the helper's `textOf` already collapses, then trims. */
function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * Reads what a producer sent, and returns only the entries that are usable.
 *
 * Lenient by design, and the opposite of `parseSyncPayload`'s all-or-nothing
 * rule. That strictness exists because a *link* is untrusted input that must not
 * be half-applied. This is downstream of that check, and an announcement with no
 * body is a perfectly normal announcement — the title is the part that carries
 * the meaning. Dropping the whole batch because one row is thin would be the
 * wrong trade.
 */
export function parseAnnouncementCandidates(
  value: unknown,
  now: Date = new Date(),
): Announcement[] {
  if (!Array.isArray(value)) return [];

  const stamp = now.toISOString();
  const byId = new Map<string, Announcement>();

  for (const entry of value) {
    if (!isRecord(entry)) continue;

    const title = text(entry.title);
    // Not `!!title`: a title is the one thing an announcement cannot lose, and
    // this is the same guard the helper applies before it records a row.
    if (!title) continue;

    const rawCode = text(entry.courseCode);
    const courseCode = rawCode.length > 0 ? rawCode : null;
    const rawPosted = text(entry.posted);
    const posted = rawPosted.length > 0 ? rawPosted : null;
    const announced = isValidDateString(entry.announced) ? entry.announced : stamp;
    const sourceId = text(entry.sourceId);
    const sourceCourseId = text(entry.sourceCourseId);
    const source = {
      ...(sourceId ? { sourceId } : {}),
      ...(sourceCourseId ? { sourceCourseId } : {}),
    };

    const announcement: Announcement = {
      id: computeAnnouncementId({ courseCode, title, posted, ...source }),
      ...source,
      courseId: null,
      courseCode,
      title: clamp(title, 200),
      body: clamp(text(entry.body), MAX_ANNOUNCEMENT_BODY),
      posted,
      announced,
    };

    // A batch is allowed to repeat itself; the last reading wins, because a
    // producer working down a page has the fullest copy of a row last.
    byId.set(announcement.id, announcement);
  }

  return [...byId.values()].slice(0, MAX_ANNOUNCEMENTS);
}

export function parseStoredAnnouncements(rawValue: string): Announcement[] | null {
  try {
    const parsed = JSON.parse(rawValue);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== ANNOUNCEMENTS_STORAGE_VERSION) return null;
    if (
      !Array.isArray(parsed.announcements) ||
      !parsed.announcements.every(isAnnouncement)
    ) {
      return null;
    }

    return parsed.announcements.slice(0, MAX_ANNOUNCEMENTS);
  } catch {
    return null;
  }
}

export function serializeAnnouncements(announcements: Announcement[]): string {
  return JSON.stringify({
    version: ANNOUNCEMENTS_STORAGE_VERSION,
    announcements: announcements.slice(0, MAX_ANNOUNCEMENTS),
  });
}

/**
 * Restores what is saved, and clears it if it does not read back.
 *
 * Same bargain as the rest of the storage readers: unreadable data is removed
 * rather than left to fail on every load.
 */
export function restoreAnnouncements(storage: Storage): {
  announcements: Announcement[];
  recoveredFromCorruptData: boolean;
} {
  const raw = storage.getItem(ANNOUNCEMENTS_STORAGE_KEY);
  if (!raw) return { announcements: [], recoveredFromCorruptData: false };

  const parsed = parseStoredAnnouncements(raw);
  if (!parsed) {
    storage.removeItem(ANNOUNCEMENTS_STORAGE_KEY);
    return { announcements: [], recoveredFromCorruptData: true };
  }

  return { announcements: parsed, recoveredFromCorruptData: false };
}

export function saveAnnouncements(storage: Pick<Storage, "setItem">, announcements: Announcement[]) {
  storage.setItem(ANNOUNCEMENTS_STORAGE_KEY, serializeAnnouncements(announcements));
}

export function clearAnnouncements(storage: Storage) {
  storage.removeItem(ANNOUNCEMENTS_STORAGE_KEY);
}

/**
 * Read API instants and legacy local date text. Relative page text has no known instant.
 */
export function postedTime(posted: string | null): number | null {
  const value = (posted ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    const at = Date.parse(value);
    return Number.isNaN(at) ? null : at;
  }
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s+(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(value);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const hour = (Number(match[4]) % 12) + (/p/i.test(match[6]) ? 12 : 0);
  const at = new Date(year, Number(match[1]) - 1, Number(match[2]), hour, Number(match[5])).valueOf();
  return Number.isNaN(at) ? null : at;
}

/** What an announcement is ordered by: when it was posted if that is known, else when it was seen. */
function effectiveTime(announcement: Announcement): number {
  return postedTime(announcement.posted) ?? Date.parse(announcement.announced);
}

/**
 * Newest first, with the sort made total.
 *
 * By when it was posted, where the posted line says so. A sync reads every course at once and
 * stamps every row with one `announced` time, so ordering by that alone left a term's
 * announcements in title order, with the newest anywhere in the list and, since the page shows a
 * dozen first, often out of sight. A row that only says "7 hours ago" falls back to `announced`.
 *
 * Two announcements with the same time are common, so the title and id are the tie-breakers that
 * keep the order stable: a list that reshuffles between loads reads as a bug.
 */
export function sortAnnouncements(announcements: Announcement[]): Announcement[] {
  return [...announcements].sort((left, right) => {
    const leftAt = effectiveTime(left);
    const rightAt = effectiveTime(right);
    if (leftAt !== rightAt) return leftAt < rightAt ? 1 : -1;
    if (left.announced !== right.announced) {
      return left.announced < right.announced ? 1 : -1;
    }
    if (left.title !== right.title) return left.title < right.title ? -1 : 1;
    return left.id < right.id ? -1 : 1;
  });
}
