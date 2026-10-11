import type { Announcement } from "./announcements.ts";
import { postedTime } from "./announcements.ts";
import { sentencesOf, mentionsCancellation } from "./announcement-actions.ts";
import { dayKey, findDates } from "./announcement-dates.ts";
import { isRecord } from "./is-record.ts";

/**
 * What an announcement said each time this browser saw it, so that a change to it can be shown.
 *
 * HuskyCT keeps no history that this app can read, so the first reading is the first version and
 * changes are known only from then on: an edit made before the app first saved the announcement
 * cannot be told, and the page says so. An announcement is the same one while its id is (course,
 * title and posting time); a changed title or posting time makes a new announcement, not a new
 * version.
 */

export type Version = { at: string; title: string; body: string };
export type VersionStore = Record<string, Version[]>;

export const VERSIONS_KEY = "huskypilot.announcementVersions.v1";
export const VERSIONS_CHANGED = "huskypilot:announcement-versions-changed";
const MAX_VERSIONS = 6;
const MAX_ANNOUNCEMENTS = 400;

/** The stored versions, or an empty store when they are missing or unreadable. */
export function parseVersions(raw: string | null): VersionStore {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return {};
    const store: VersionStore = {};
    for (const [id, list] of Object.entries(value)) {
      if (!Array.isArray(list)) continue;
      const versions = list.filter(
        (entry): entry is Version => isRecord(entry) && typeof entry.at === "string" && !Number.isNaN(Date.parse(entry.at)) && typeof entry.title === "string" && typeof entry.body === "string",
      );
      if (versions.length > 0) store[id] = versions.slice(-MAX_VERSIONS);
    }
    return store;
  } catch {
    return {};
  }
}

/**
 * The store with what is now known added: an announcement not seen before gets its first version;
 * one whose text is not the last version's gets a new one. The same store comes back when nothing
 * changed, so reading the same sync twice records nothing.
 */
export function recordVersions(store: VersionStore, announcements: readonly Pick<Announcement, "id" | "title" | "body">[], now: Date): VersionStore {
  let next = store;
  for (const announcement of announcements) {
    const versions = store[announcement.id];
    const last = versions?.[versions.length - 1];
    if (last && last.title === announcement.title && last.body === announcement.body) continue;
    if (next === store) next = { ...store };
    next[announcement.id] = [...(versions ?? []), { at: now.toISOString(), title: announcement.title, body: announcement.body }].slice(-MAX_VERSIONS);
  }
  if (next !== store && Object.keys(next).length > MAX_ANNOUNCEMENTS) {
    const keep = Object.entries(next)
      .sort((left, right) => (left[1][left[1].length - 1].at < right[1][right[1].length - 1].at ? 1 : -1))
      .slice(0, MAX_ANNOUNCEMENTS);
    next = Object.fromEntries(keep);
  }
  return next;
}

// --- comparing two texts ---------------------------------------------------------------------------

export type Segment = { kind: "same" | "added" | "removed"; text: string };

/** Word by word: what stayed, what was added and what was taken out, in reading order. */
export function diffText(before: string, after: string): Segment[] {
  const left = before.match(/\S+|\s+/g) ?? [];
  const right = after.match(/\S+|\s+/g) ?? [];
  const rows = left.length + 1;
  const cols = right.length + 1;
  const length = new Uint16Array(rows * cols);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      length[i * cols + j] = left[i] === right[j] ? length[(i + 1) * cols + j + 1] + 1 : Math.max(length[(i + 1) * cols + j], length[i * cols + j + 1]);
    }
  }
  const out: Segment[] = [];
  const push = (kind: Segment["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      push("same", left[i]);
      i += 1;
      j += 1;
    } else if (length[(i + 1) * cols + j] >= length[i * cols + j + 1]) {
      push("removed", left[i]);
      i += 1;
    } else {
      push("added", right[j]);
      j += 1;
    }
  }
  while (i < left.length) push("removed", left[i++]);
  while (j < right.length) push("added", right[j++]);
  return out;
}

export type Change = {
  announcementId: string;
  before: Version;
  after: Version;
  segments: Segment[];
  /** Days the earlier text names that the later one does not, and the reverse (as `YYYY-MM-DD`). */
  datesRemoved: string[];
  datesAdded: string[];
  /** The later text speaks of a cancellation the earlier one did not. */
  cancelled: boolean;
};

/** The days an announcement's text names, as the rules read them, given when it was posted. */
export function daysNamed(text: string, posted: string | null): Set<string> {
  const postedAt = postedTime(posted);
  const days = new Set<string>();
  for (const sentence of sentencesOf(text)) {
    for (const found of findDates(sentence, postedAt)) {
      if (found.date) days.add(dayKey(found.date));
      for (const option of found.options) if (found.basis.includes("range")) days.add(dayKey(option.date));
    }
  }
  return days;
}

/** What changed between the last two versions, or null when there is only one, or they read the same. */
export function latestChange(announcementId: string, versions: readonly Version[] | undefined, posted: string | null): Change | null {
  if (!versions || versions.length < 2) return null;
  const before = versions[versions.length - 2];
  const after = versions[versions.length - 1];
  if (before.body === after.body && before.title === after.title) return null;
  const was = daysNamed(`${before.title}. ${before.body}`, posted);
  const now = daysNamed(`${after.title}. ${after.body}`, posted);
  return {
    announcementId,
    before,
    after,
    segments: diffText(before.body, after.body),
    datesRemoved: [...was].filter((day) => !now.has(day)).sort(),
    datesAdded: [...now].filter((day) => !was.has(day)).sort(),
    cancelled: mentionsCancellation(`${after.title}. ${after.body}`) && !mentionsCancellation(`${before.title}. ${before.body}`),
  };
}

/** Whether a change is one a student would want to look at: a day changed, a cancellation, or a new date. */
export function isNotable(change: Change): boolean {
  return change.cancelled || change.datesRemoved.length > 0 || change.datesAdded.length > 0;
}
