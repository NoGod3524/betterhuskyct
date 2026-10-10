import type { Announcement } from "./announcements.ts";
import { postedTime } from "./announcements.ts";
import { normaliseCourseCode } from "./courses.ts";
import { parseStoredGrades } from "./grades.ts";

/**
 * Narrowing the announcements by what is known about them: when they were posted, whether they are
 * new since the last visit, whether the rules found something to do in them, whether they changed.
 * A filter that matches nothing says so on the page; none of them drops an announcement for good.
 */
export type Recency = "all" | "7" | "30";

export type Filters = { recency: Recency; onlyNew: boolean; onlyActions: boolean; onlyChanged: boolean };

export const NO_FILTERS: Filters = { recency: "all", onlyNew: false, onlyActions: false, onlyChanged: false };

export const isFiltering = (filters: Filters) => filters.recency !== "all" || filters.onlyNew || filters.onlyActions || filters.onlyChanged;

/** When it was posted if the page said so, else when this browser first saw it. */
export function effectiveAt(announcement: Pick<Announcement, "posted" | "announced">): number {
  return postedTime(announcement.posted) ?? Date.parse(announcement.announced);
}

export type FilterContext = {
  now: number;
  unseen: ReadonlySet<string>;
  hasActions: (announcementId: string) => boolean;
  isChanged: (announcementId: string) => boolean;
};

export function applyFilters<T extends Pick<Announcement, "id" | "posted" | "announced">>(list: readonly T[], filters: Filters, context: FilterContext): T[] {
  const since = filters.recency === "all" ? null : context.now - Number(filters.recency) * 86_400_000;
  return list.filter((announcement) => {
    if (since !== null && !(effectiveAt(announcement) >= since)) return false;
    if (filters.onlyNew && !context.unseen.has(announcement.id)) return false;
    if (filters.onlyActions && !context.hasActions(announcement.id)) return false;
    if (filters.onlyChanged && !context.isChanged(announcement.id)) return false;
    return true;
  });
}

// --- the original on HuskyCT ------------------------------------------------------------------------

/** The course ids HuskyCT uses, by course code, from the grades the helper brought; empty if there are none. */
export function huskyctCourseIds(gradesRaw: string | null): Map<string, string> {
  const ids = new Map<string, string>();
  if (!gradesRaw) return ids;
  try {
    const snapshot = parseStoredGrades(JSON.parse(gradesRaw));
    for (const course of snapshot?.courses ?? []) if (course.code) ids.set(normaliseCourseCode(course.code).toUpperCase(), course.id);
  } catch {
    // Unreadable: no ids, and the link goes to HuskyCT's course list.
  }
  return ids;
}

/** Where to read the original: the course's announcements on HuskyCT when its id is known, else the course list. */
export function originalUrl(courseCode: string | null, ids: Map<string, string>): string {
  const id = courseCode ? ids.get(normaliseCourseCode(courseCode).toUpperCase()) : undefined;
  return id && /^_\d+_\d+$/.test(id) ? `https://lms.uconn.edu/ultra/courses/${id}/announcements` : "https://lms.uconn.edu/ultra/course";
}
