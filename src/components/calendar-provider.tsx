"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useCourseBook } from "@/components/use-course-book";
import { useCourseCatalogue } from "@/components/use-course-catalogue";
import { useEventEdits } from "@/components/use-event-edits";
import { useReminders } from "@/components/use-reminders";
import { restoreCustomTicks, restoreTicks, useTaskStatus, type CompletionSource } from "@/components/use-task-status";
import { isDeadline } from "@/lib/calendar-types";
import { formatDate } from "@/lib/format-date";
import type { CalendarTask, TaskGroup } from "@/lib/calendar-types";
import {
  ANNOUNCEMENTS_STORAGE_KEY,
  restoreAnnouncements,
  saveAnnouncements,
  sortAnnouncements,
  type Announcement,
} from "@/lib/announcements";
import {
  SUBSCRIPTIONS_STORAGE_KEY,
  latestImportAt,
  mergeTasks,
  removeSubscription as removeSubscriptionFrom,
  restoreSubscriptions,
  saveSubscriptions,
  taskOwnerIndex,
  updateSubscription,
  type Subscription,
} from "@/lib/subscriptions";
import { watchClock } from "@/lib/clock";
import { downloadFile } from "@/lib/download";
import { writeStorageBatch, type StorageWriter } from "@/lib/storage-batch";
import { CHANGES_CHANGED, CHANGES_KEY, mergeChangeStores, parseChanges, saveChanges, withChangesLock, type ChangesStore } from "@/lib/changes";
import { historyForSource } from "@/lib/background-sync";
import { recordSyncChanges } from "@/lib/change-producers";
import { parseVersions, recordVersions, VERSIONS_CHANGED, VERSIONS_KEY } from "@/lib/announcement-versions";
import type { SyncPayload } from "@/lib/sync";
import { planSyncApply, withoutStaleRows } from "@/lib/sync-apply";
import { createTasksReceiver } from "@/lib/tasks-sync";
import { applyReadReport, readSyncStatus, recordReadReport, SYNC_STATUS_CHANGED, SYNC_STATUS_KEY, type ReadReport } from "@/lib/sync-status";
import {
  activeNotices,
  moveMap,
  moveOverlay,
  moveSet,
  recordMoves,
  restoreMoveLog,
  saveMoveLog,
  type MoveLog,
} from "@/lib/moved-deadlines";
import {
  applyOverlay,
  restoreEventOverlay,
  saveEventOverlay,
  type EventEdit,
} from "@/lib/event-overlay";
import { isCustomEventId, type CustomEventInput } from "@/lib/custom-events";
import {
  COMPLETION_STORAGE_KEY_IMPORTED,
  restoreCompletedTaskIds,
  saveCompletedTaskIds,
} from "@/lib/completion-storage";
import { createDemoTasks, groupTasks } from "@/lib/calendar-view";
import {
  mergeDone,
  restoreReopened,
  restoreSyncedDone,
  saveReopened,
  saveSyncedDone,
  type DoneLabel,
} from "@/lib/task-status";
import {
  EMPTY_COURSE_BOOK,
  COURSES_STORAGE_KEY,
  courseIdForTask,
  labelForTask,
  restoreCourseBook,
  saveCourseBook,
  type Course,
  type CourseComponent,
  type CourseLabel,
} from "@/lib/courses";
import { dueSoonTasks } from "@/lib/reminders";
import { CSV_BOM, exportFileName, tasksToCsv } from "@/lib/export";
import { deadlinesToRemind, icsFileName, tasksToIcs } from "@/lib/ics";
import { courseColor, mergeCourseColors, restoreCourseColors, saveCourseColors, type CourseColors } from "@/lib/course-colors";
import { helperMessage } from "@/lib/helper-bridge";
import {
  DEFAULT_LOCALE,
  restoreLocale,
  saveLocale,
  t,
  type Locale,
} from "@/lib/i18n";

type CalendarContextValue = {
  now: Date;
  calendarReady: boolean;
  locale: Locale;
  changeLocale: (nextLocale: Locale) => void;

  tasks: CalendarTask[];
  /** The student's own ticks. Synced between devices; not the whole story of what is done. */
  completedIds: Set<string>;
  /** Every task that is done: ticked, or handed in or graded according to HuskyCT's gradebook. */
  doneIds: Set<string>;
  /** Why a task is done, for the page to say; null if it is not. */
  doneLabelFor: (taskId: string) => DoneLabel | null;
  /** Whether the helper has brought the grades that tell what is handed in. */
  hasGrades: boolean;
  toggleTaskCompletion: (taskId: string) => void;
  groups: TaskGroup[];
  visibleCount: number;
  dueSoon: CalendarTask[];

  courses: Course[];
  addCourse: (code: string, component: CourseComponent | null) => void;
  editCourse: (
    courseId: string,
    patch: { code?: string; component?: CourseComponent | null },
  ) => void;
  dropCourse: (courseId: string) => void;
  setDefaultCourse: (courseId: string | null) => void;
  setTaskCourse: (taskId: string, courseId: string | null) => void;
  followDefaultCourse: (taskId: string) => void;
  courseIdForTask: (taskId: string) => string | null | undefined;
  courseLabelFor: (task: CalendarTask) => CourseLabel | null;
  /** The course's colour on HuskyCT, when the helper has brought it. */
  courseColorFor: (code: string | null | undefined) => string | null;

  formattedToday: string;

  calendarName: string | null;
  formattedImportedAt: string | null;
  isImported: boolean;
  hasSavedImport: boolean;
  restoredFromStorage: boolean;

  subscriptions: Subscription[];
  addFeedCourse: (subscriptionId: string, courseId: string | null) => void;
  dropSubscription: (subscriptionId: string) => void;

  notice: string | null;
  error: string | null;
  clearNotice: () => void;
  clearSavedData: () => void;
  exportTasks: () => void;
  exportCalendar: () => void;
  /** Deadlines the teacher moved recently, by task id, until dismissed or a week old. */
  moveNotices: MoveLog;
  dismissMoveNotice: (taskId: string) => void;

  remindersEnabled: boolean;
  toggleReminders: () => Promise<void>;

  /** Course announcements, newest first. Empty until a helper sends some. */
  announcements: Announcement[];
  clearAnnouncements: () => void;
  applyBackgroundPayload: (payload: SyncPayload, history: ChangesStore, report: ReadReport) => Promise<void>;

  /** A correction to an imported event, or an edit to one the student added. */
  editEvent: (taskId: string, edit: EventEdit) => void;
  deleteEvent: (taskId: string) => void;
  /** Undoes a correction or a deletion; does nothing for a custom event. */
  restoreEvent: (taskId: string) => void;
  restoreAllEvents: () => void;
  eventNoteFor: (taskId: string) => string | null;
  /** Whether this imported event has been corrected or deleted on this device. */
  isEventEdited: (taskId: string) => boolean;
  /** Returns the new event's id, so what made it can be remembered. */
  addCustomEvent: (input: CustomEventInput) => string;
  /** Several at once, as one save: the AI list adds what was ticked in one press. */
  addCustomEvents: (inputs: CustomEventInput[], saveRelated?: (staged: StorageWriter) => void) => void;
};

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function useCalendar(): CalendarContextValue {
  const value = useContext(CalendarContext);
  if (!value) {
    throw new Error("useCalendar must be used inside <CalendarProvider>");
  }
  return value;
}

/**
 * Holds every piece of calendar state for the whole app.
 *
 * It lives in the root layout rather than in a page so that navigating between
 * routes does not remount it: the imported tasks, completion state, language,
 * and reminder settings all survive navigation without a flash of demo data or
 * a repeated auto-refresh request.
 *
 * HuskyCT issues one feed per course, so the app holds a *list* of them and
 * renders the union. The cache in each subscription is what the pages read.
 *
 * The parts with a life of their own are hooks beside this file: the course book, the hand edits
 * to the calendar, what is done, the reminders, the course catalogue. What stays here is what
 * joins them: the feeds, the announcements, and a sync, which changes all of them at once.
 */
export function CalendarProvider({
  initialNow,
  children,
}: {
  initialNow: string;
  children: ReactNode;
}) {
  const [now, setNow] = useState(() => new Date(initialNow));
  const [calendarReady, setCalendarReady] = useState(false);
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  // Course announcements. They arrive by sync only — the app never fetches
  // HuskyCT itself — so this is empty on a device that has never been sent any.
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  // True while the demo data is what the pages show, because nothing has been imported yet.
  const [demoMode, setDemoMode] = useState(true);
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [courseColors, setCourseColors] = useState<CourseColors>({});
  // Mirrors `subscriptions` for async work, which would otherwise close over a
  // stale value between awaits.
  const subscriptionsRef = useRef<Subscription[]>([]);

  const hasSubscriptions = subscriptions.length > 0;
  const isImported = hasSubscriptions && !demoMode;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    saveLocale(window.localStorage, nextLocale);
  }

  function saveChange(write: () => void): boolean {
    try {
      write();
      setError(null);
      return true;
    } catch {
      setError(t(locale, "errors.saveFailed"));
      return false;
    }
  }

  function commitSubscriptions(next: Subscription[]): boolean {
    if (!saveChange(() => saveSubscriptions(window.localStorage, next))) return false;
    subscriptionsRef.current = next;
    setSubscriptions(next);
    return true;
  }

  const book = useCourseBook(saveChange);
  const { courseBook, setCourseBook } = book;
  const edits = useEventEdits(locale, saveChange, setError);
  const { eventOverlay, setEventOverlay, customEvents, setMoveLog } = edits;

  // The server does not know the reader's day or zone. Keep the first frame
  // neutral until this browser has restored its clock and saved calendar.
  const demoTasks = useMemo(() => calendarReady ? createDemoTasks(now) : [], [calendarReady, now]);
  // Corrections and deletions apply only to what was actually imported — the
  // demo is not something anyone is correcting. Events the student added
  // themselves are not a correction of anything, so they are always shown,
  // demo or not: adding one is how an import-less visitor tries the calendar.
  const tasks = useMemo(
    () => [...(isImported ? applyOverlay(mergeTasks(subscriptions), eventOverlay) : demoTasks), ...customEvents],
    [isImported, subscriptions, demoTasks, eventOverlay, customEvents],
  );

  const taskOwners = useMemo(() => taskOwnerIndex(subscriptions), [subscriptions]);
  const catalogueReady = useCourseCatalogue(tasks);

  // The course a task shows, as a function so what is done can be worked out from it.
  const labelFor = useCallback(
    (task: CalendarTask) => {
      const ownerId = taskOwners.get(task.id);
      const feedCourseId = ownerId
        ? (subscriptions.find((entry) => entry.id === ownerId)?.courseId ?? null)
        : null;
      return labelForTask(courseBook, task, feedCourseId);
    },
    [courseBook, taskOwners, subscriptions],
  );
  const courseCodeFor = useCallback((task: CalendarTask) => labelFor(task)?.code ?? null, [labelFor]);

  const completionSource: CompletionSource = isImported ? "imported" : "demo";
  const status = useTaskStatus({ tasks, courseCodeFor, catalogueReady, source: completionSource, subscriptionsRef, locale, setError });
  const { setCompletedIds, setReopened, setSyncedDone, doneIds } = status;

  // Work already handed in is not due soon.
  const dueSoon = useMemo(() => dueSoonTasks(tasks.filter((task) => !doneIds.has(task.id)), now), [tasks, doneIds, now]);
  const reminders = useReminders(locale, dueSoon, { setError, setNotice });

  // Declared after the hooks above, whose own restores therefore run first: by the time this
  // marks the calendar ready, everything this browser remembers is on screen.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setNow(new Date());
      let restoredLocale = DEFAULT_LOCALE;
      try {
        restoredLocale = restoreLocale(window.localStorage);
        setLocale(restoredLocale);
        const restored = restoreSubscriptions(window.localStorage);
        subscriptionsRef.current = restored.subscriptions;
        setSubscriptions(restored.subscriptions);
        setDemoMode(restored.subscriptions.length === 0);

        if (restored.subscriptions.length > 0) {
          setRestoredFromStorage(true);
          setCompletedIds(restoreTicks("imported", restored.subscriptions));
        } else {
          if (restored.recoveredFromCorruptData) {
            setNotice(t(restoredLocale, "notices.corruptDataCleared"));
          }
          setCompletedIds(restoreTicks("demo", null));
        }

        setAnnouncements(restoreAnnouncements(window.localStorage).announcements);
        setCourseColors(restoreCourseColors(window.localStorage));
      } catch {
        setError(t(restoredLocale, "errors.restoreFailed"));
      } finally {
        setCalendarReady(true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
    // Restore-on-mount must run exactly once; the setter it is handed is a state setter, which
    // never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps `now` moving while the app is open; see `watchClock` for why. The
  // returned cleanup is the effect's, so an unmounted provider stops ticking.
  useEffect(() => watchClock(() => setNow(new Date()), window), []);

  /**
   * Throws the collected announcements away.
   *
   * There has to be a way out. Sync only ever adds, so without this a term of
   * announcements collected by mistake — or a course the user has finished —
   * would sit on the page until storage was cleared wholesale.
   */
  async function dropAnnouncements() {
    try {
      await withChangesLock(() => {
        const changes = parseChanges(window.localStorage.getItem(CHANGES_KEY));
        if (!saveChange(() => writeStorageBatch(window.localStorage, (staged) => {
          staged.removeItem(ANNOUNCEMENTS_STORAGE_KEY);
          staged.removeItem(VERSIONS_KEY);
          saveChanges(staged, { ...changes,
            entries: changes.entries.filter((entry) => entry.kind !== "announcement-new" && entry.kind !== "announcement-edited"),
            baselines: changes.baselines.filter((scope) => !scope.startsWith("announcements:")),
          });
        }))) return;
        setAnnouncements([]);
        window.dispatchEvent(new window.Event(CHANGES_CHANGED));
        window.dispatchEvent(new window.Event(VERSIONS_CHANGED));
        setNotice(t(locale, "announcements.cleared"));
        setError(null);
      });
    } catch { setError(t(locale, "errors.saveFailed")); }
  }

  /** Files a feed under a course, so its rows carry the right label. */
  function addFeedCourse(subscriptionId: string, courseId: string | null) {
    commitSubscriptions(updateSubscription(subscriptionsRef.current, subscriptionId, { courseId }));
  }

  function dropSubscription(subscriptionId: string) {
    const next = removeSubscriptionFrom(subscriptionsRef.current, subscriptionId);
    if (!commitSubscriptions(next)) return;
    if (next.length === 0) {
      setDemoMode(true);
      setRestoredFromStorage(false);
      setCompletedIds(restoreTicks("demo", null));
    }
  }

  // Which ticks go into the merge and what the screen shows afterwards are
  // decided by `planSyncApply`; this only writes the result. Shared by the
  // helper's direct `postMessage` and the extension's background runs.
  function applyPayload(payload: SyncPayload, report?: ReadReport, backgroundHistory?: ChangesStore) {
    const now = new Date();
    const before = {
      courses: restoreCourseBook(window.localStorage),
      subscriptions: restoreSubscriptions(window.localStorage).subscriptions,
      announcements: restoreAnnouncements(window.localStorage).announcements,
      doneByHuskyct: restoreSyncedDone(window.localStorage),
    };
    if (backgroundHistory) payload = withoutStaleRows(payload, before, report);
    const savedTicks = new Set([...restoreCompletedTaskIds(window.localStorage, "imported")].filter((id) => !isCustomEventId(id)));
    const plan = planSyncApply(
      {
        courses: before.courses,
        subscriptions: before.subscriptions,
        announcements: before.announcements,
        showingImported: isImported,
        ticksOnScreen: savedTicks,
        savedTicks,
      },
      payload,
    );
    const { merged } = plan;

    // A deadline the teacher moved is the same task: what is kept under its id moves with it.
    const { moves } = merged;
    const nextSynced = moveMap(mergeDone(before.doneByHuskyct, Object.entries(payload.doneByHuskyct)), moves);
    const nextColors = mergeCourseColors(restoreCourseColors(window.localStorage), payload.courseColors);
    const nextReopened = moveSet(new Set([...restoreReopened(window.localStorage), ...payload.reopened]), moves);
    const nextOverlay = moves.length > 0 ? moveOverlay(restoreEventOverlay(window.localStorage), moves) : null;
    const nextMoveLog = moves.length > 0 ? recordMoves(restoreMoveLog(window.localStorage), moves, new Date()) : null;
    const ordered = sortAnnouncements(merged.announcements);
    const currentChanges = parseChanges(window.localStorage.getItem(CHANGES_KEY));
    const changes = backgroundHistory ? mergeChangeStores(currentChanges, historyForSource(backgroundHistory, "tasks"), now)
      : recordSyncChanges(currentChanges, before, merged, payload, now, report);
    const versions = recordVersions(recordVersions(parseVersions(window.localStorage.getItem(VERSIONS_KEY)), before.announcements, now), ordered, now);
    const currentStatus = backgroundHistory ? readSyncStatus(window.localStorage) : null;
    const backgroundStatus = backgroundHistory && report && (!currentStatus || Date.parse(currentStatus.lastSync) <= Date.parse(payload.exportedAt))
      ? applyReadReport(currentStatus, report, new Date(payload.exportedAt)) : null;
    writeStorageBatch(window.localStorage, (staged) => {
      saveSubscriptions(staged, merged.subscriptions);
      saveCourseBook(staged, merged.courses);
      saveAnnouncements(staged, ordered);
      staged.setItem(VERSIONS_KEY, JSON.stringify(versions));
      saveChanges(staged, changes);
      if (backgroundStatus) staged.setItem(SYNC_STATUS_KEY, JSON.stringify(backgroundStatus));
      saveCompletedTaskIds(staged, "imported", plan.ticksToSave);
      if (!saveSyncedDone(staged, nextSynced) || !saveCourseColors(staged, nextColors) || !saveReopened(staged, nextReopened)) {
        throw new Error(t(locale, "errors.saveFailed"));
      }
      if (nextOverlay) saveEventOverlay(staged, nextOverlay);
      if (nextMoveLog) saveMoveLog(staged, nextMoveLog);
    });
    window.dispatchEvent(new window.Event(CHANGES_CHANGED));
    window.dispatchEvent(new window.Event(VERSIONS_CHANGED));
    if (nextOverlay) setEventOverlay(nextOverlay);
    if (nextMoveLog) setMoveLog(nextMoveLog);
    subscriptionsRef.current = merged.subscriptions;
    setSubscriptions(merged.subscriptions);
    setCourseBook(merged.courses);
    setAnnouncements(ordered);
    setSyncedDone(nextSynced);
    setCourseColors(nextColors);
    setReopened(nextReopened);

    if (plan.showImported) setDemoMode(false);
    if (plan.ticksOnScreen) setCompletedIds(new Set([...plan.ticksOnScreen, ...restoreCustomTicks()]));
    setRestoredFromStorage(false);
    return merged;
  }

  async function applyBackgroundPayload(payload: SyncPayload, history: ChangesStore, report: ReadReport): Promise<void> {
    await withChangesLock(() => {
      applyPayload(payload, report, history);
      window.dispatchEvent(new window.Event(SYNC_STATUS_CHANGED));
      setError(null);
    });
  }

  // The helper's direct delivery. Kept current after every render, rather
  // than re-registered, so the one `message` listener mounted below never
  // closes over the render it happened to be attached on. The assignment
  // runs in an effect — not during render itself — only to satisfy the rule
  // against touching a ref while rendering; it still runs on every render.
  const applyFromHelperRef = useRef<(payload: SyncPayload, report?: ReadReport) => void | Promise<void>>(() => {});
  useEffect(() => {
    applyFromHelperRef.current = (payload: SyncPayload, report?: ReadReport) => withChangesLock(() => {
      let merged;
      try { merged = applyPayload(payload, report); }
      catch (error) { setError(t(locale, "errors.saveFailed")); throw error; }
      setError(null);
      setNotice(
        t(locale, "sync.appliedFromHelper", {
          calendars: merged.addedFeeds,
          added: merged.addedEvents,
          updated: merged.updatedEvents,
          tasks: merged.completedIds.size,
          announcements: merged.announcements.length,
        }),
      );
    });
  });

  useEffect(() => {
    const receiver = createTasksReceiver({
      onSync: (payload, report) => {
        try {
          const result = applyFromHelperRef.current(payload, report);
          return result ? result.then(() => true, () => false) : true;
        } catch {
          return false;
        }
      },
      // What the sync read, course by course, for the sync status: this route carries it however
      // the sync was started, the helper's own panel included.
      onStatus: (report) => {
        recordReadReport(window.localStorage, report, new Date());
        window.dispatchEvent(new Event(SYNC_STATUS_CHANGED));
      },
    });
    const listener = (event: MessageEvent) => {
      // From HuskyCT directly, or through the helper's bridge from a tab behind this one.
      const { origin, data, source } = helperMessage(event, window);
      receiver({ origin, data, source: source as Window | null });
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  const groups = useMemo(() => calendarReady ? groupTasks(tasks, now, locale) : [], [calendarReady, tasks, now, locale]);
  // The groups keep class meetings — seeing your day is useful — but the
  // headline says "due", so it counts only the things actually due.
  const visibleCount = groups.reduce(
    (total, group) => total + group.tasks.filter(isDeadline).length,
    0,
  );

  const formattedToday = calendarReady ? formatDate(now, locale, { weekday: "long" }) : "";
  const formattedImportedAt = useMemo(() => {
    const latest = latestImportAt(subscriptions);
    if (!latest) return null;
    return formatDate(new Date(latest), locale, { time: true });
  }, [subscriptions, locale]);

  async function clearSavedData() {
    try {
      await withChangesLock(() => {
        const changes = parseChanges(window.localStorage.getItem(CHANGES_KEY));
        if (!saveChange(() => writeStorageBatch(window.localStorage, (staged) => {
          for (const key of [SUBSCRIPTIONS_STORAGE_KEY, COMPLETION_STORAGE_KEY_IMPORTED, COURSES_STORAGE_KEY, ANNOUNCEMENTS_STORAGE_KEY, VERSIONS_KEY]) staged.removeItem(key);
          saveChanges(staged, { ...changes,
            entries: changes.entries.filter((entry) => entry.kind === "grade" || entry.kind === "file-new" || (entry.kind === "done-by-huskyct" && !entry.ref?.id)),
            baselines: changes.baselines.filter((scope) => !scope.startsWith("announcements:") && !scope.startsWith("deadlines:")),
          });
        }))) return;
        subscriptionsRef.current = [];
        setSubscriptions([]);
        setAnnouncements([]);
        setCourseBook(EMPTY_COURSE_BOOK);
        setDemoMode(true);
        setRestoredFromStorage(false);
        setCompletedIds(restoreTicks("demo", null));
        setNotice(t(locale, "notices.savedDataCleared"));
        setError(null);
        window.dispatchEvent(new window.Event(CHANGES_CHANGED));
        window.dispatchEvent(new window.Event(VERSIONS_CHANGED));
      });
    } catch { setError(t(locale, "errors.saveFailed")); }
  }

  /** Download exactly what is on screen, as a spreadsheet-friendly CSV. */
  function exportTasks() {
    downloadFile(new Blob([CSV_BOM + tasksToCsv(tasks, doneIds)], { type: "text/csv;charset=utf-8" }), exportFileName(now));
  }

  /** The open deadlines as an .ics file, so the phone's own calendar reminds with this app closed. */
  function exportCalendar() {
    const due = deadlinesToRemind(tasks, doneIds, now);
    setError(null);
    if (due.length === 0) {
      setNotice(t(locale, "notices.icsNothing"));
      return;
    }
    downloadFile(new Blob([tasksToIcs(due, now)], { type: "text/calendar;charset=utf-8" }), icsFileName(now));
    setNotice(t(locale, "notices.icsExported", { count: due.length }));
  }

  function clearNotice() {
    setNotice(null);
    setError(null);
  }

  const value: CalendarContextValue = {
    now,
    calendarReady,
    locale,
    changeLocale,
    tasks,
    completedIds: status.completedIds,
    doneIds,
    doneLabelFor: status.doneLabelFor,
    hasGrades: status.hasGrades,
    toggleTaskCompletion: status.toggleTaskCompletion,
    groups,
    visibleCount,
    dueSoon,
    courses: courseBook.courses,
    addCourse: book.addCourse,
    editCourse: book.editCourse,
    dropCourse: book.dropCourse,
    setDefaultCourse: book.setDefaultCourse,
    setTaskCourse: book.setTaskCourse,
    followDefaultCourse: book.followDefaultCourse,
    courseIdForTask: (taskId: string) => courseIdForTask(courseBook, taskId),
    courseLabelFor: labelFor,
    courseColorFor: (code) => courseColor(courseColors, code),
    formattedToday,
    calendarName: subscriptions.length === 1 ? subscriptions[0].name : null,
    formattedImportedAt,
    isImported,
    hasSavedImport: hasSubscriptions,
    restoredFromStorage,
    subscriptions,
    addFeedCourse,
    dropSubscription,
    notice,
    error,
    clearNotice,
    clearSavedData,
    exportTasks,
    exportCalendar,
    moveNotices: activeNotices(edits.moveLog, now),
    dismissMoveNotice: edits.dismissMoveNotice,
    remindersEnabled: reminders.remindersEnabled,
    toggleReminders: reminders.toggleReminders,
    announcements,
    clearAnnouncements: dropAnnouncements,
    applyBackgroundPayload,
    editEvent: edits.editEvent,
    deleteEvent: edits.deleteEvent,
    restoreEvent: edits.restoreEvent,
    restoreAllEvents: edits.restoreAllEvents,
    eventNoteFor: edits.eventNoteFor,
    isEventEdited: edits.isEventEdited,
    addCustomEvent: edits.addCustomEvent,
    addCustomEvents: edits.addCustomEvents,
  };

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}
