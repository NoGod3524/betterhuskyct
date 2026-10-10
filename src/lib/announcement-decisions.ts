import type { Announcement } from "./announcements.ts";
import { latestChange, type Change, type VersionStore } from "./announcement-versions.ts";

/**
 * What the student has decided about the candidates found in announcements, kept in this browser:
 * which they dismissed, which they added to the to-do (and which task that made, so a change to
 * the announcement can be set beside it), and which changes they have looked at.
 */

export type Added = {
  /** The task it made: a custom calendar event, or a to-do with no date. */
  taskId: string;
  taskKind: "event" | "undated";
  announcementId: string;
  /** The sentence it came from, as written, to see whether the announcement still says it. */
  sentence: string;
  /** The day it was added for (`YYYY-MM-DD`), or null for a to-do with none. */
  day: string | null;
  title: string;
  addedAt: string;
  /** The `at` of the announcement's latest version when it was added or last looked at. */
  versionAt: string | null;
};

export type Decisions = {
  version: 1;
  dismissed: Record<string, true>;
  added: Record<string, Added>;
  /** An announcement's id → the `at` of the latest version whose change the student has looked at. */
  reviewed: Record<string, string>;
};

export const DECISIONS_KEY = "huskypilot.announcementActions.v1";
export const DECISIONS_CHANGED = "huskypilot:announcement-actions-changed";
export const EMPTY_DECISIONS: Decisions = { version: 1, dismissed: {}, added: {}, reviewed: {} };
const MAX_ENTRIES = 1500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";

function parseAdded(value: unknown): Added | null {
  if (!isRecord(value)) return null;
  if (!isString(value.taskId) || !value.taskId || !isString(value.announcementId) || !isString(value.sentence) || !isString(value.title) || !isString(value.addedAt)) return null;
  if (value.taskKind !== "event" && value.taskKind !== "undated") return null;
  if (value.day !== null && !isString(value.day)) return null;
  if (value.versionAt !== null && !isString(value.versionAt)) return null;
  return {
    taskId: value.taskId,
    taskKind: value.taskKind,
    announcementId: value.announcementId,
    sentence: value.sentence,
    day: value.day,
    title: value.title,
    addedAt: value.addedAt,
    versionAt: value.versionAt,
  };
}

export function parseDecisions(raw: string | null): Decisions {
  if (!raw) return EMPTY_DECISIONS;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1) return EMPTY_DECISIONS;
    const dismissed: Decisions["dismissed"] = {};
    if (isRecord(value.dismissed)) for (const id of Object.keys(value.dismissed).slice(0, MAX_ENTRIES)) dismissed[id] = true;
    const added: Decisions["added"] = {};
    if (isRecord(value.added)) {
      for (const [id, entry] of Object.entries(value.added).slice(0, MAX_ENTRIES)) {
        const parsed = parseAdded(entry);
        if (parsed) added[id] = parsed;
      }
    }
    const reviewed: Decisions["reviewed"] = {};
    if (isRecord(value.reviewed)) for (const [id, at] of Object.entries(value.reviewed).slice(0, MAX_ENTRIES)) if (isString(at)) reviewed[id] = at;
    return { version: 1, dismissed, added, reviewed };
  } catch {
    return EMPTY_DECISIONS;
  }
}

export const dismiss = (decisions: Decisions, candidateId: string): Decisions => ({ ...decisions, dismissed: { ...decisions.dismissed, [candidateId]: true } });

export function undismiss(decisions: Decisions, candidateId: string): Decisions {
  const dismissed = { ...decisions.dismissed };
  delete dismissed[candidateId];
  return { ...decisions, dismissed };
}

export const markAdded = (decisions: Decisions, candidateId: string, added: Added): Decisions => ({ ...decisions, added: { ...decisions.added, [candidateId]: added } });

export function forgetAdded(decisions: Decisions, candidateId: string): Decisions {
  const added = { ...decisions.added };
  delete added[candidateId];
  return { ...decisions, added };
}

/** The student has looked at an announcement's latest change. */
export const markReviewed = (decisions: Decisions, announcementId: string, versionAt: string): Decisions => ({ ...decisions, reviewed: { ...decisions.reviewed, [announcementId]: versionAt } });

/** The student has looked at what a change means for a task they added from it. */
export function markLinkChecked(decisions: Decisions, candidateId: string, versionAt: string): Decisions {
  const entry = decisions.added[candidateId];
  return entry ? { ...decisions, added: { ...decisions.added, [candidateId]: { ...entry, versionAt } } } : decisions;
}

/** The task was moved to the day the announcement now names: what the link remembers moves with it. */
export function markLinkMoved(decisions: Decisions, candidateId: string, moved: { day: string; sentence: string; versionAt: string }): Decisions {
  const entry = decisions.added[candidateId];
  return entry ? { ...decisions, added: { ...decisions.added, [candidateId]: { ...entry, day: moved.day, sentence: moved.sentence, versionAt: moved.versionAt } } } : decisions;
}

// --- changes the student has not looked at ---------------------------------------------------------

/** Whether an announcement has a change the student has not looked at. */
export function isUnreviewed(change: Change | null, decisions: Decisions): boolean {
  return change !== null && decisions.reviewed[change.announcementId] !== change.after.at;
}

export type LinkNotice = {
  candidateId: string;
  added: Added;
  change: Change;
  reasons: Array<"date-changed" | "cancelled" | "sentence-changed">;
  /** Days the announcement now names that it did not before, to offer as the new day. */
  newDays: string[];
};

const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Tasks that were made from an announcement that has changed since: the day it was added for is no
 * longer named, or it now speaks of a cancellation, or the sentence it came from is gone. A change
 * that touches none of these (a fixed typo elsewhere) raises nothing. Nothing is changed for the
 * student: the notice only asks them to look.
 */
export function linkNotices(decisions: Decisions, announcements: readonly Announcement[], versions: VersionStore): LinkNotice[] {
  const byId = new Map(announcements.map((announcement) => [announcement.id, announcement]));
  const notices: LinkNotice[] = [];
  for (const [candidateId, added] of Object.entries(decisions.added)) {
    const announcement = byId.get(added.announcementId);
    if (!announcement) continue;
    const list = versions[added.announcementId];
    const latest = list?.[list.length - 1];
    if (!latest || added.versionAt === latest.at) continue;
    const change = latestChange(added.announcementId, list, announcement.posted);
    if (!change) continue;
    const reasons: LinkNotice["reasons"] = [];
    if (added.day && change.datesRemoved.includes(added.day)) reasons.push("date-changed");
    if (change.cancelled) reasons.push("cancelled");
    if (!squash(`${latest.title}. ${latest.body}`).includes(squash(added.sentence))) reasons.push("sentence-changed");
    if (reasons.length === 0) continue;
    notices.push({ candidateId, added, change, reasons, newDays: change.datesAdded });
  }
  return notices;
}
