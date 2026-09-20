import { sameCourse, type Course, type CourseBook } from "./courses.ts";
import type { EffortMap } from "./effort.ts";
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
};

export type MergedState = {
  courses: CourseBook;
  efforts: EffortMap;
  completedIds: Set<string>;
  subscriptions: Subscription[];
  /** How many calendars the link actually added. */
  addedFeeds: number;
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

  return { courses, efforts, completedIds, subscriptions, addedFeeds };
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
