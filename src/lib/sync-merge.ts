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
  let addedFeeds = 0;

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
      addedFeeds += merged.added > 0 ? 1 : 0;
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
 * Which existing calendar should receive this feed's events.
 *
 * The rule the merge used to have — "if any event is already known, skip the
 * feed" — is gone, but *something* still has to decide whether an incoming feed
 * continues a calendar here or is a new one. That decision is now about the
 * events rather than about a single one of them: a feed that shares no event
 * with anything here is new; a feed that shares some is the same calendar
 * arriving again.
 *
 * Name agreement is used only to break ties, and only when nothing overlaps,
 * because the helper's two payloads are not guaranteed to share events at all —
 * a to-do list where every deadline moved has entirely new ids.
 */
function findReceivingSubscription(
  subscriptions: Subscription[],
  feed: SyncFeed,
): Subscription | null {
  if (feed.events.length === 0) return null;

  const incoming = new Set(feed.events.map((event) => event.id));

  let best: Subscription | null = null;
  let bestOverlap = 0;

  for (const subscription of subscriptions) {
    let overlap = 0;
    for (const event of subscription.events) {
      if (incoming.has(event.id)) overlap += 1;
    }
    if (overlap > bestOverlap) {
      best = subscription;
      bestOverlap = overlap;
    }
  }

  if (best) return best;

  // Nothing in common. The same named calendar arriving with a wholly different
  // set of deadlines is still the same calendar, and starting a second "HuskyCT
  // to-do" every time a deadline moves is worse than merging into the first.
  if (!feed.name) return null;
  return subscriptions.find((subscription) => subscription.name === feed.name) ?? null;
}

/**
 * Folds a feed's events into the ones already on the calendar.
 *
 * Additive, like every other rule here: an incoming event replaces the one with
 * the same id, and anything the payload does not mention is kept. A deadline the
 * helper stopped mentioning is therefore still shown rather than vanishing —
 * losing a deadline the user can still see in HuskyCT is the worse failure, and
 * it is the one this function exists to stop.
 */
function mergeFeedEvents(
  existing: CalendarTask[],
  incoming: CalendarTask[],
): { events: CalendarTask[]; added: number; updated: number } {
  const byId = new Map(existing.map((event) => [event.id, event]));
  let added = 0;
  let updated = 0;

  for (const event of incoming) {
    const previous = byId.get(event.id);
    if (!previous) {
      added += 1;
    } else if (!sameEvent(previous, event)) {
      updated += 1;
    }
    byId.set(event.id, event);
  }

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
