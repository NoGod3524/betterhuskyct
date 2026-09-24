import {
  normaliseCourseCode,
  sameCourse,
  type Course,
  type CourseBook,
} from "./courses.ts";
import type { EffortMap } from "./effort.ts";
import type { CalendarTask } from "./calendar-types.ts";
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
import type { SyncFeed, SyncPayload } from "./sync.ts";

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
  /** How many calendars the link actually added — new ones, not merged ones. */
  addedFeeds: number;
  /** Items (counted by UID) that were not on this device before. */
  addedEvents: number;
  /** Items already here whose time or details the link changed. */
  updatedEvents: number;
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
 * - **A calendar already here is updated in place, never duplicated.** A feed
 *   that shares a source UID with one here is merged into it, so the device
 *   keeps its own name, course and remembered link. For each UID the link
 *   mentions, its copy wins (that is how a moved deadline moves); a UID it
 *   does not mention is kept.
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
  let addedFeeds = 0;
  let addedEvents = 0;
  let updatedEvents = 0;

  for (const feed of payload.feeds) {
    // Merge into an existing calendar when this payload continues one, rather
    // than treating the feed as all-or-nothing.
    //
    // The old rule was `if any event is already known, skip the whole feed`,
    // which broke the helper's entire workflow after the first send: it re-sends
    // one "HuskyCT to-do" feed holding every outstanding deadline, so the second
    // send always contained something already here, and every deadline that was
    // new or rescheduled was dropped without a word.
    const target = findReceivingSubscription(subscriptions, feed);

    if (target) {
      const merged = mergeFeedEvents(target.events, feed.events);
      subscriptions[subscriptions.indexOf(target)] = { ...target, events: merged.events };
      addedEvents += merged.added;
      updatedEvents += merged.updated;
      continue;
    }

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
    addedFeeds += 1;
    addedEvents += new Set(feed.events.map(eventUid)).size;
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
    addedEvents,
    updatedEvents,
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

  // `normaliseCourseCode` rather than a bare `trim`: it is what every other
  // reader and writer here puts codes through, so a code that reached this
  // point with an odd run of whitespace still matches a course the user typed.
  // Case is folded because the catalogue and the page disagree about it.
  const wanted = normaliseCourseCode(announcement.courseCode).toLowerCase();
  const matches = courses.courses.filter(
    (course) => normaliseCourseCode(course.code).toLowerCase() === wanted,
  );

  return matches.length === 1 ? matches[0].id : null;
}

/**
 * The source UID an event came from.
 *
 * Every producer builds a task id as `uid + ":" + start` — `parse-calendar` does
 * for a feed or a file, and the helper does for its to-do list — so the UID is
 * the id with that suffix taken off. Comparing by UID rather than by id is what
 * lets a rescheduled deadline be recognised: its start moved, so its id changed,
 * but it is still the same item. An id that does not end in its own start (an
 * old payload, a hand-built one) is its own UID.
 */
export function eventUid(event: CalendarTask): string {
  const suffix = `:${event.start}`;
  return event.id.endsWith(suffix) && event.id.length > suffix.length
    ? event.id.slice(0, -suffix.length)
    : event.id;
}

/**
 * Which existing calendar should receive this feed's events.
 *
 * A feed that shares a UID with a calendar here is that calendar arriving again;
 * the one with the most shared UIDs wins. A feed that shares none is new.
 *
 * Deliberately not by name. The first version of this fell back to a name match
 * when nothing overlapped, and Blackboard gives every course feed the same
 * `X-WR-CALNAME` — "University of Connecticut" — so an unrelated course was
 * folded into whichever one happened to be here, and took its course label.
 * The case the name match was for, a to-do list whose deadlines all moved, is
 * covered by comparing UIDs, which survive a move.
 */
function findReceivingSubscription(
  subscriptions: Subscription[],
  feed: SyncFeed,
): Subscription | null {
  if (feed.events.length === 0) return null;

  const incoming = new Set(feed.events.map(eventUid));

  let best: Subscription | null = null;
  let bestOverlap = 0;

  for (const subscription of subscriptions) {
    const shared = new Set(
      subscription.events.map(eventUid).filter((uid) => incoming.has(uid)),
    );
    if (shared.size > bestOverlap) {
      best = subscription;
      bestOverlap = shared.size;
    }
  }

  return best;
}

/**
 * Folds a feed's events into the ones already on the calendar.
 *
 * The incoming feed is authoritative *per UID*: for every UID it mentions, its
 * instances replace the ones here. That is what moves a rescheduled deadline
 * instead of showing it twice — once at the old time, where it would later sit
 * in the plan as overdue, and once at the new one.
 *
 * Everything else stays additive. A UID the payload does not mention is kept,
 * so a deadline the helper stopped listing is still shown rather than vanishing:
 * losing one the user can still see in HuskyCT is the worse failure.
 */
function mergeFeedEvents(
  existing: CalendarTask[],
  incoming: CalendarTask[],
): { events: CalendarTask[]; added: number; updated: number } {
  const incomingUids = new Set(incoming.map(eventUid));
  const existingById = new Map(existing.map((event) => [event.id, event]));
  const existingUids = new Set(existing.map(eventUid));

  let added = 0;
  let updated = 0;
  // Counted once per UID, so a recurring event with many instances is one change.
  const counted = new Set<string>();

  for (const event of incoming) {
    const uid = eventUid(event);
    if (counted.has(uid)) continue;

    const previous = existingById.get(event.id);
    if (!existingUids.has(uid)) {
      added += 1;
      counted.add(uid);
    } else if (!previous || !sameEvent(previous, event)) {
      updated += 1;
      counted.add(uid);
    }
  }

  const kept = existing.filter((event) => !incomingUids.has(eventUid(event)));
  const byId = new Map(kept.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);

  return { events: [...byId.values()], added, updated };
}

/** Whether two copies of one event say the same thing, for counting updates. */
function sameEvent(left: CalendarTask, right: CalendarTask): boolean {
  return (
    left.title === right.title &&
    left.start === right.start &&
    left.end === right.end &&
    left.course === right.course &&
    left.location === right.location &&
    left.allDay === right.allDay &&
    (left.kind ?? null) === (right.kind ?? null)
  );
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
