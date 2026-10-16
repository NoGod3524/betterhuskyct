import { createChangeId, recordChanges, type ChangeEntry, type ChangesStore } from "./changes.ts";
import type { Announcement } from "./announcements.ts";
import { isDeadline, type CalendarTask } from "./calendar-types.ts";
import type { CourseBook } from "./courses.ts";
import { doneReasonOf, normalizeCode, type DoneReason } from "./task-status.ts";
import { formatPoints, isCounted, type GradesSnapshot } from "./grades.ts";
import { eventUid, type MergedState } from "./sync-merge.ts";
import type { Subscription } from "./subscriptions.ts";
import type { SyncPayload } from "./sync.ts";
import type { ReadReport } from "./sync-status.ts";

type SyncBefore = {
  subscriptions: Subscription[];
  announcements: Announcement[];
  courses: CourseBook;
  doneByHuskyct: Map<string, DoneReason>;
};

const codeKey = (code: string | null) => code ? normalizeCode(code) : "unknown";
const announcementScope = (announcement: Announcement) => announcement.sourceCourseId
  ? `announcements:id:${announcement.sourceCourseId}`
  : `announcements:code:${codeKey(announcement.courseCode ?? announcement.courseId)}`;

function taskCode(task: CalendarTask, book: CourseBook): string | null {
  const chosen = book.assignments[task.id];
  return book.courses.find((course) => course.id === chosen)?.code ?? task.course;
}

const deadlineScope = (task: CalendarTask, book: CourseBook) => task.sourceCourseId
  ? `deadlines:id:${task.sourceCourseId}` : `deadlines:${codeKey(taskCode(task, book))}`;

/** Compare the actual saved readings, rather than an accumulated "not seen yet" list. */
export function recordSyncChanges(
  current: ChangesStore,
  before: SyncBefore,
  after: MergedState,
  payload: SyncPayload,
  now: Date,
  report?: ReadReport,
): ChangesStore {
  const entries: ChangeEntry[] = [];
  const at = now.toISOString();
  const baselines = new Set(current.baselines);
  const previousTasks = before.subscriptions.flatMap((subscription) => subscription.events).filter(isDeadline);
  const previousById = new Map(previousTasks.map((task) => [task.id, task]));
  const previousUids = new Set(previousTasks.map(eventUid));
  const priorScopes = new Set(previousTasks.map((task) => deadlineScope(task, before.courses)));
  const incomingUids = new Set(payload.feeds.flatMap((feed) => feed.events).map(eventUid));
  const tasks = after.subscriptions.flatMap((subscription) => subscription.events).filter(isDeadline);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const counted = new Set<string>();
  for (const task of tasks) {
    const uid = eventUid(task);
    if (!incomingUids.has(uid) || counted.has(uid)) continue;
    counted.add(uid);
    const courseCode = taskCode(task, after.courses);
    const scope = deadlineScope(task, after.courses);
    if (!previousUids.has(uid) && (current.baselines.includes(scope) || priorScopes.has(scope))) {
      entries.push({ id: createChangeId("deadline-added", uid, task.start, payload.exportedAt), at,
        kind: "deadline-added", courseCode, title: task.title,
        detail: { to: task.allDay && task.dateKey ? task.dateKey : task.start }, ref: { page: "/tasks", id: task.id }, read: false });
    }
    baselines.add(scope);
  }
  for (const move of after.moves) {
    const task = tasksById.get(move.to);
    if (!task) continue;
    const previous = previousById.get(move.from);
    entries.push({ id: createChangeId("deadline-moved", move.uid, move.fromStart, move.toStart, payload.exportedAt), at,
      kind: "deadline-moved", courseCode: taskCode(task, after.courses), title: task.title,
      detail: { from: previous?.allDay && previous.dateKey ? previous.dateKey : move.fromStart,
        to: task.allDay && task.dateKey ? task.dateKey : move.toStart }, ref: { page: "/tasks", id: task.id }, read: false });
  }
  const wasDone = new Set(previousTasks.filter((task) => before.doneByHuskyct.has(task.id)).map(eventUid));
  for (const [id] of Object.entries(payload.doneByHuskyct)) {
    const task = tasksById.get(id);
    if (!task || wasDone.has(eventUid(task))) continue;
    const scope = deadlineScope(task, after.courses);
    if (!current.baselines.includes(scope) && !priorScopes.has(scope)) continue;
    // A helper's To Do UID uses the gradebook column id too. Both deliveries describe one completion.
    // ponytail: report completion once per UID; submission history needs source attempt revisions.
    entries.push({ id: createChangeId("done-by-huskyct", eventUid(task)), at,
      kind: "done-by-huskyct", courseCode: taskCode(task, after.courses), title: task.title,
      ref: { page: "/tasks", id }, read: false });
  }

  const previousAnnouncements = new Map(before.announcements.map((announcement) => [announcement.id, announcement]));
  const oldAnnouncementScopes = new Set(before.announcements.map(announcementScope));
  const arriving = new Set(payload.announcements.map((announcement) => announcement.id));
  for (const announcement of after.announcements) {
    if (!arriving.has(announcement.id)) continue;
    const previous = previousAnnouncements.get(announcement.id);
    const scope = announcementScope(announcement);
    const kind = previous ? "announcement-edited" : "announcement-new";
    if (previous ? previous.title !== announcement.title || previous.body !== announcement.body
      : current.baselines.includes(scope) || oldAnnouncementScopes.has(scope)) {
      entries.push({ id: createChangeId(kind, announcement.id, payload.exportedAt), at, kind,
        courseCode: announcement.courseCode, title: announcement.title,
        ref: { page: "/announcements", id: announcement.id }, read: false });
    }
    baselines.add(scope);
  }
  // An empty successful reading is a baseline too; a failed read says nothing about that course.
  for (const course of report?.courses ?? []) {
    if (course.announcements) baselines.add(`announcements:id:${course.id}`);
    if (report?.dueDates || report?.todo) {
      baselines.add(`deadlines:id:${course.id}`);
      baselines.add(`deadlines:${codeKey(course.code ?? course.id)}`);
    }
  }
  return recordChanges(current, entries, now, [...baselines]);
}

/** Grade history records each real transition, including a later return to an earlier score. */
export function recordGradeChanges(current: ChangesStore, before: GradesSnapshot | null, after: GradesSnapshot, now: Date): ChangesStore {
  const previous = new Map((before?.courses ?? []).map((course) => [course.id, course]));
  const entries: ChangeEntry[] = [];
  const at = now.toISOString();
  const score = (item: { earned: number | null; possible: number | null }) =>
    item.earned === null || item.possible === null ? "" : `${formatPoints(item.earned)}/${formatPoints(item.possible)}`;
  for (const course of after.courses) {
    const oldCourse = previous.get(course.id);
    if (!oldCourse) continue;
    const oldItems = new Map(oldCourse.items.map((item) => [item.id, item]));
    for (const item of course.items) {
      const old = oldItems.get(item.id);
      const from = old ? score(old) : "";
      const to = score(item);
      if (isCounted(item) && from !== to) {
        entries.push({ id: createChangeId("grade", course.id, item.id, from, to, after.takenAt), at,
          kind: "grade", courseCode: course.code, title: item.title,
          detail: { ...(from ? { from } : {}), to }, ref: { page: "/grades", id: item.id }, read: false });
      }
      if (doneReasonOf(item) && (!old || !doneReasonOf(old))) {
        entries.push({ id: createChangeId("done-by-huskyct", `huskyct-todo-${encodeURIComponent(item.id)}`), at,
          kind: "done-by-huskyct", courseCode: course.code, title: item.title,
          ref: { page: "/tasks" }, read: false });
      }
    }
  }
  return recordChanges(current, entries, now, after.courses.map((course) => `grades:${course.id}`));
}
