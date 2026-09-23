import { sameCourse, type Course, type CourseBook } from "./courses.ts";
import type { EffortMap } from "./effort.ts";
import {
  MAX_ANNOUNCEMENTS,
  sortAnnouncements,
  type Announcement,
} from "./announcements.ts";
import {
  MAX_SUBSCRIPTIONS,
  createSubscriptionId,
  type Subscription,
} from "./subscriptions.ts";
import type { SyncPayload } from "./sync.ts";

export type LocalState = {
  courses: CourseBook;
  efforts: EffortMap;
  completedIds: Set<string>;
  subscriptions: Subscription[];
  /**
   * Optional, and defaulted to empty below.
   *
   * Every caller has some, so this is not a real optionality — it is a courtesy
   * to the many small fixtures that build a `LocalState` to test something else
   * entirely, which would otherwise all have to learn about announcements to
   * keep testing ticks.
   */
  announcements?: Announcement[];
};

export type MergedState = {
  courses: CourseBook;
  efforts: EffortMap;
  completedIds: Set<string>;
  subscriptions: Subscription[];
  /** How many calendars the link actually added. */
  addedFeeds: number;
  /** The union, newest first, capped. */
  announcements: Announcement[];
  /** How many announcements the link actually added. */
  addedAnnouncements: number;
};

/**
 * Folds a link from another device into what is already here.
 *
 * The rules are chosen so that a sync can only ever add information:
 *
 * - **Ticks are unioned.** A tick is a decision someone made; losing one is
 *   worse than keeping a stale one. The other device having ticked something is
 *   never a reason to untick it here.
 * - **Courses and effort marks take the incoming value**, because importing a
 *   link is an explicit act — the user is saying "this is the set-up I want".
 * - **A calendar already here is left alone.** Matching is by UID, so a device
 *   that imported the same feed keeps its own copy, its own name, and its own
 *   remembered link rather than gaining a duplicate.
 *
 * Course ids are per-device UUIDs, so incoming ids are remapped onto the local
 * course with the same code and component before anything is written.
 *
 * Announcements follow the same rule as ticks — unioned, never removed — but
 * they arrive keyed by course *code* rather than by id, because the producer
 * that collected them was reading a page that only ever names the course.
 */
export function mergeSyncPayload(
  local: LocalState,
  payload: SyncPayload,
): MergedState {
  const { courses, idMap } = mergeCourses(local.courses, payload.courses);

  const efforts: EffortMap = { ...local.efforts, ...payload.efforts };

  const completedIds = new Set(local.completedIds);
  for (const id of payload.completedIds) completedIds.add(id);

  const subscriptions = [...local.subscriptions];
  const knownEvents = new Set(
    subscriptions.flatMap((subscription) => subscription.events.map((event) => event.id)),
  );
  let addedFeeds = 0;

  for (const feed of payload.feeds) {
    if (feed.events.some((event) => knownEvents.has(event.id))) continue;
    if (subscriptions.length >= MAX_SUBSCRIPTIONS) break;

    subscriptions.push({
      id: createSubscriptionId(),
      name: feed.name,
      courseId: feed.courseId ? (idMap.get(feed.courseId) ?? null) : null,
      // The feed URL is a password and never travels; the events came instead.
      url: null,
      importedAt: feed.importedAt,
      lastError: null,
      events: feed.events,
    });
    for (const event of feed.events) knownEvents.add(event.id);
    addedFeeds += 1;
  }

  const { announcements, addedAnnouncements } = mergeAnnouncements(
    local.announcements ?? [],
    payload.announcements,
    courses,
    idMap,
  );

  return {
    courses,
    efforts,
    completedIds,
    subscriptions,
    addedFeeds,
    announcements,
    addedAnnouncements,
  };
}

/**
 * Folds the incoming announcements into the ones already here.
 *
 * Keyed by id, and the incoming reading wins where both sides have one, because
 * an announcement's text is what a later collect knows more about — a body that
 * was empty when the row first appeared may be filled in the second time. Two
 * devices holding the same announcement therefore converge on the same row
 * rather than showing it twice.
 */
function mergeAnnouncements(
  local: Announcement[],
  incoming: Announcement[],
  courses: CourseBook,
  idMap: Map<string, string>,
): { announcements: Announcement[]; addedAnnouncements: number } {
  const byId = new Map<string, Announcement>();
  for (const announcement of local) byId.set(announcement.id, announcement);

  let addedAnnouncements = 0;
  for (const announcement of incoming) {
    if (!byId.has(announcement.id)) addedAnnouncements += 1;
    byId.set(announcement.id, {
      ...announcement,
      // Incoming feeds carry a *remote* course id, which means nothing here.
      // The code is the part that travels, so it is what resolves.
      courseId: resolveAnnouncementCourse(announcement, courses, idMap),
    });
  }

  return {
    announcements: sortAnnouncements([...byId.values()]).slice(0, MAX_ANNOUNCEMENTS),
    addedAnnouncements,
  };
}

/**
 * Which local course an announcement belongs to.
 *
 * Remapping a remote id first, since a payload from *this* app carries real
 * course ids and those remap exactly the way task assignments do. Otherwise the
 * code decides — and when a code is ambiguous because the user has the same
 * course twice with different components, nothing is chosen. A row that shows
 * just "MATH 1070Q" is honest; one that silently picks the lecture over the
 * discussion is not.
 */
function resolveAnnouncementCourse(
  announcement: Announcement,
  courses: CourseBook,
  idMap: Map<string, string>,
): string | null {
  if (announcement.courseId) {
    const remapped = idMap.get(announcement.courseId);
    if (remapped) return remapped;
  }

  if (!announcement.courseCode) return null;

  const wanted = announcement.courseCode.toLowerCase();
  const matches = courses.courses.filter(
    (course) => course.code.toLowerCase() === wanted,
  );

  return matches.length === 1 ? matches[0].id : null;
}

function mergeCourses(
  local: CourseBook,
  incoming: CourseBook,
): { courses: CourseBook; idMap: Map<string, string> } {
  const courses = [...local.courses];
  const idMap = new Map<string, string>();

  for (const course of incoming.courses) {
    const match = courses.find((existing) => sameCourse(existing, course));
    if (match) {
      idMap.set(course.id, match.id);
      continue;
    }

    // A synced course never steals the default; the local book keeps its own.
    const added: Course = { ...course, isDefault: false };
    courses.push(added);
    idMap.set(course.id, added.id);
  }

  const assignments = { ...local.assignments };
  for (const [taskId, courseId] of Object.entries(incoming.assignments)) {
    if (courseId === null) {
      assignments[taskId] = null;
    } else {
      const localId = idMap.get(courseId);
      if (localId) assignments[taskId] = localId;
    }
  }

  return { courses: adoptDefault({ courses, assignments }, incoming, idMap), idMap };
}

/** If nothing here was the default, the incoming choice becomes it. */
function adoptDefault(
  book: CourseBook,
  incoming: CourseBook,
  idMap: Map<string, string>,
): CourseBook {
  if (book.courses.some((course) => course.isDefault)) return book;

  const incomingDefault = incoming.courses.find((course) => course.isDefault);
  const localId = incomingDefault ? idMap.get(incomingDefault.id) : undefined;
  if (!localId) return book;

  return {
    ...book,
    courses: book.courses.map((course) => ({
      ...course,
      isDefault: course.id === localId,
    })),
  };
}
