/**
 * What the student has already looked at, so what is new can be marked.
 *
 * Announcements are told apart by when this browser first saw them (`announced`): one first seen
 * after the student last left the Announcements page is new. Course files are told apart by their
 * keys: one the student has not seen on the Materials page is new. Both are kept in this browser.
 *
 * Until a page has been left once there is nothing to compare with, so nothing is marked: a first
 * sync does not make everything new.
 */
export const SEEN_ANNOUNCEMENTS_KEY = "huskypilot.seen.announcements.v1";
export const SEEN_FILES_KEY = "huskypilot.seen.files.v1";

/** Fired on the window when either is written, so the header's count follows. */
export const SEEN_CHANGED = "huskypilot:seen-changed";

/** The ids of announcements first seen after `seenAt`; none when there is no `seenAt` yet. */
export function unseenAnnouncements(list: readonly { id: string; announced: string }[], seenAt: string | null): Set<string> {
  const since = seenAt ? Date.parse(seenAt) : NaN;
  const out = new Set<string>();
  if (Number.isNaN(since)) return out;
  for (const entry of list) {
    const at = Date.parse(entry.announced);
    if (!Number.isNaN(at) && at > since) out.add(entry.id);
  }
  return out;
}

/** The keys not among those seen; none when nothing has been seen yet. */
export function unseenFiles(keys: readonly string[], seen: readonly string[] | null): Set<string> {
  if (!seen) return new Set();
  const known = new Set(seen);
  return new Set(keys.filter((key) => !known.has(key)));
}

/** The stored list of keys, or null when it is missing or unreadable. */
export function parseSeenFiles(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : null;
  } catch {
    return null;
  }
}

function write(storage: Pick<Storage, "setItem">, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // Blocked or full storage: nothing is marked, which is no worse than before.
  }
}

/** Sets where "new" starts, unless it is already set: the first time the app runs there is no past. */
export function ensureAnnouncementsBaseline(storage: Pick<Storage, "getItem" | "setItem">, now: Date): void {
  try {
    if (storage.getItem(SEEN_ANNOUNCEMENTS_KEY)) return;
  } catch {
    return;
  }
  write(storage, SEEN_ANNOUNCEMENTS_KEY, now.toISOString());
}

export function markAnnouncementsSeen(storage: Pick<Storage, "setItem">, now: Date): void {
  write(storage, SEEN_ANNOUNCEMENTS_KEY, now.toISOString());
}

export function markFilesSeen(storage: Pick<Storage, "setItem">, keys: readonly string[]): void {
  write(storage, SEEN_FILES_KEY, JSON.stringify(keys));
}
