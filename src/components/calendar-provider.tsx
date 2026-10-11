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

import { isDeadline } from "@/lib/calendar-types";
import { formatDate } from "@/lib/format-date";
import type { CalendarTask, TaskGroup } from "@/lib/calendar-types";
import {
  clearAnnouncements,
  restoreAnnouncements,
  saveAnnouncements,
  sortAnnouncements,
  type Announcement,
} from "@/lib/announcements";
import {
  clearSubscriptions,
  latestImportAt,
  mergeTasks,
  removeSubscription as removeSubscriptionFrom,
  restoreSubscriptions,
  saveSubscriptions,
  taskOwnerIndex,
  ticksForTasks,
  updateSubscription,
  type Subscription,
} from "@/lib/subscriptions";
import { watchClock } from "@/lib/clock";
import {
  decodeSyncPayload,
  readSyncFragment,
  type SyncPayload,
} from "@/lib/sync";
import { planSyncApply } from "@/lib/sync-apply";
import { createTasksReceiver } from "@/lib/tasks-sync";
import {
  applyOverlay,
  deleteEvent as deleteOverlayEvent,
  EMPTY_OVERLAY,
  noteFor as overlayNoteFor,
  restoreEvent as restoreOverlayEvent,
  restoreEventOverlay,
  saveEventOverlay,
  setEventEdit,
  type EventEdit,
  type EventOverlay,
} from "@/lib/event-overlay";
import {
  buildCustomEvent,
  editCustomEvent as applyCustomEventEdit,
  isCustomEventId,
  removeCustomEvent as dropCustomEvent,
  restoreCustomEvents,
  saveCustomEvents,
  type CustomEvent as CustomCalendarEvent,
  type CustomEventInput,
} from "@/lib/custom-events";
import {
  clearCompletedTaskIds,
  restoreCompletedTaskIds,
  saveCompletedTaskIds,
  type CompletionSource,
} from "@/lib/completion-storage";
import { createDemoTasks, groupTasks } from "@/lib/calendar-view";
import { isCourseCatalogueLoaded, loadCourseCatalogue } from "@/lib/course-catalogue";
import type { GradesSnapshot } from "@/lib/grades";
import { GRADES_CHANGED, openGradesStore } from "@/lib/grades-store";
import {
  autoDoneTasks,
  doneLabels,
  mergeDone,
  restoreReopened,
  restoreSyncedDone,
  saveReopened,
  saveSyncedDone,
  type DoneLabel,
  type DoneReason,
} from "@/lib/task-status";
import {
  EMPTY_COURSE_BOOK,
  addCourse as addCourseToBook,
  assignTaskCourse,
  clearCourseBook,
  clearTaskCourse,
  courseIdForTask,
  labelForTask,
  removeCourse as removeCourseFromBook,
  restoreCourseBook,
  saveCourseBook,
  setDefaultCourse as setDefaultInBook,
  updateCourse as updateCourseInBook,
  type Course,
  type CourseBook,
  type CourseComponent,
  type CourseLabel,
} from "@/lib/courses";
import {
  dueSoonTasks,
  reminderSignature,
  restoreReminderState,
  saveReminderState,
  shouldNotify,
  type ReminderState,
} from "@/lib/reminders";
import { CSV_BOM, exportFileName, tasksToCsv } from "@/lib/export";
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
  restoreDemo: () => void;
  restoreSavedImport: () => void;
  clearSavedData: () => void;
  exportTasks: () => void;

  remindersEnabled: boolean;
  toggleReminders: () => Promise<void>;


  /** A link from another device, waiting for the user to accept it. */
  pendingSync: SyncPayload | null;
  applyPendingSync: () => void;
  dismissPendingSync: () => void;
  /** The generated link, once the user has asked for one. */

  /** Course announcements, newest first. Empty until a helper sends some. */
  announcements: Announcement[];
  clearAnnouncements: () => void;

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
  addCustomEvents: (inputs: CustomEventInput[]) => void;
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
 * renders the union. The cache in each subscription is what the pages read; the
 * URL is only kept when the user opted in, which is what makes a refresh
 * possible on the next visit.
 */
/**
 * The ticks to show for a source: its own that still match a task, and those on the student's own
 * events, which show in the demo and in an import alike and so are kept apart from both.
 */
function restoreTicks(source: "demo" | "imported", subscriptions: Subscription[] | null): Set<string> {
  const own = restoreCompletedTaskIds(window.localStorage, source);
  const real = subscriptions ? ticksForTasks(own, subscriptions) : own;
  return new Set([...real, ...restoreCustomTicks()]);
}

/** The ticks on events the student added, for the events that are still there. */
function restoreCustomTicks(): string[] {
  const mine = new Set(restoreCustomEvents(window.localStorage).map((event) => event.id));
  return [...restoreCompletedTaskIds(window.localStorage, "custom")].filter((id) => mine.has(id));
}

export function CalendarProvider({
  initialNow,
  children,
}: {
  initialNow: string;
  children: ReactNode;
}) {
  const [now, setNow] = useState(() => new Date(initialNow));
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  // Course announcements. They arrive by sync only — the app never fetches
  // HuskyCT itself — so this is empty on a device that has never been sent any.
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  // True while the demo data is what the pages show, either because nothing has
  // been imported yet or because the user asked for the demo back.
  const [demoMode, setDemoMode] = useState(true);
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  // Task id -> how much work the user says it is. Defaults to "medium".
  // Every course the user has named, plus the per-task overrides. A Blackboard
  // feed never labels a graded item with its course, and one feed can hold
  // several courses, so this cannot be a single label.
  const [courseBook, setCourseBook] = useState<CourseBook>(EMPTY_COURSE_BOOK);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  // The "what did we already notify about" log is bookkeeping for an external
  // system (localStorage), not rendered state, so it lives in a ref.
  const reminderLog = useRef<{
    lastSignature: string | null;
    lastNotifiedAt: string | null;
  }>({ lastSignature: null, lastNotifiedAt: null });
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  // Opt-in only: when false, a feed URL is never written to storage.
  // Mirrors `subscriptions` for async work, which would otherwise close over a
  // stale value between awaits.
  const subscriptionsRef = useRef<Subscription[]>([]);
  // The same, for the announcement list when a sync link is packed.
  const announcementsRef = useRef<Announcement[]>([]);
  // Corrections to imported events, and events the student added themselves;
  // see `event-overlay.ts` and `custom-events.ts` for why they are kept apart.
  const [eventOverlay, setEventOverlay] = useState<EventOverlay>(EMPTY_OVERLAY);
  const [customEvents, setCustomEvents] = useState<CustomCalendarEvent[]>([]);
  const [courseColors, setCourseColors] = useState<CourseColors>({});
  // A link from another device is offered, never applied on its own.
  const [pendingSync, setPendingSync] = useState<SyncPayload | null>(null);

  const hasSubscriptions = subscriptions.length > 0;
  const isImported = hasSubscriptions && !demoMode;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    saveLocale(window.localStorage, nextLocale);
  }

  function commitSubscriptions(next: Subscription[]) {
    subscriptionsRef.current = next;
    setSubscriptions(next);
    saveSubscriptions(window.localStorage, next);
  }

  function commitAnnouncements(next: Announcement[]) {
    // Sorted once, here, so every consumer sees the same order without each of
    // them having to remember to sort.
    const ordered = sortAnnouncements(next);
    announcementsRef.current = ordered;
    setAnnouncements(ordered);
    saveAnnouncements(window.localStorage, ordered);
  }

  /**
   * Throws the collected announcements away.
   *
   * There has to be a way out. Sync only ever adds, so without this a term of
   * announcements collected by mistake — or a course the user has finished —
   * would sit on the page until storage was cleared wholesale.
   */
  function dropAnnouncements() {
    commitAnnouncements([]);
    setNotice(t(locale, "announcements.cleared"));
    setError(null);
  }

  function commitEventOverlay(next: EventOverlay) {
    setEventOverlay(next);
    saveEventOverlay(window.localStorage, next);
  }

  function commitCustomEvents(next: CustomCalendarEvent[]) {
    setCustomEvents(next);
    saveCustomEvents(window.localStorage, next);
  }

  /**
   * One form for both kinds of event on the calendar page: a custom one is
   * edited in place, since the student owns the whole record; a correction to
   * an imported one goes into the overlay instead, so the next collection
   * still finds it. `taskId` decides which by its own namespace.
   */
  function editEvent(taskId: string, edit: EventEdit) {
    if (isCustomEventId(taskId)) {
      commitCustomEvents(applyCustomEventEdit(customEvents, taskId, edit));
    } else {
      commitEventOverlay(setEventEdit(eventOverlay, taskId, edit));
    }
  }

  function deleteEvent(taskId: string) {
    if (isCustomEventId(taskId)) commitCustomEvents(dropCustomEvent(customEvents, taskId));
    else commitEventOverlay(deleteOverlayEvent(eventOverlay, taskId));
  }

  /** Back to exactly what HuskyCT sent. Meaningless for a custom event — there is no "original" to go back to. */
  function restoreEvent(taskId: string) {
    if (!isCustomEventId(taskId)) commitEventOverlay(restoreOverlayEvent(eventOverlay, taskId));
  }

  function restoreAllEvents() {
    commitEventOverlay(EMPTY_OVERLAY);
  }

  function eventNoteFor(taskId: string): string | null {
    if (isCustomEventId(taskId)) return customEvents.find((event) => event.id === taskId)?.note ?? null;
    return overlayNoteFor(eventOverlay, taskId);
  }

  function isEventEdited(taskId: string): boolean {
    return Boolean(eventOverlay.edits[taskId]) || eventOverlay.deletedIds.includes(taskId);
  }

  function addCustomEvent(input: CustomEventInput): string {
    const event = buildCustomEvent(input);
    commitCustomEvents([...customEvents, event]);
    return event.id;
  }

  function addCustomEvents(inputs: CustomEventInput[]) {
    if (inputs.length > 0) commitCustomEvents([...customEvents, ...inputs.map(buildCustomEvent)]);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const currentTime = new Date();
      setNow(currentTime);
      const restoredLocale = restoreLocale(window.localStorage);
      setLocale(restoredLocale);
      const restored = restoreSubscriptions(window.localStorage);
      subscriptionsRef.current = restored.subscriptions;
      setSubscriptions(restored.subscriptions);
      setDemoMode(restored.subscriptions.length === 0);

      if (restored.subscriptions.length > 0) {
        setRestoredFromStorage(true);
        setNotice(t(restoredLocale, "notices.restoredImported"));
        setCompletedIds(restoreTicks("imported", restored.subscriptions));
      } else {
        if (restored.recoveredFromCorruptData) {
          setNotice(t(restoredLocale, "notices.corruptDataCleared"));
        }
        setCompletedIds(restoreTicks("demo", null));
      }

      const restoredReminders = restoreReminderState(window.localStorage);
      setRemindersEnabled(restoredReminders.enabled);
      reminderLog.current = {
        lastSignature: restoredReminders.lastSignature,
        lastNotifiedAt: restoredReminders.lastNotifiedAt,
      };
      setNotificationPermission(
        "Notification" in window ? Notification.permission : "unsupported",
      );
      setCourseBook(restoreCourseBook(window.localStorage));

      const restoredAnnouncements = restoreAnnouncements(window.localStorage);
      announcementsRef.current = restoredAnnouncements.announcements;
      setAnnouncements(restoredAnnouncements.announcements);

      setEventOverlay(restoreEventOverlay(window.localStorage));
      setCustomEvents(restoreCustomEvents(window.localStorage));
      setCourseColors(restoreCourseColors(window.localStorage));

    }, 0);

    return () => window.clearTimeout(timer);
    // Restore-on-mount must run exactly once; listing the functions it calls would re-run the
    // whole restore on each render instead.
  }, []);

  /**
   * Offers whatever a sync link in the address bar is carrying.
   *
   * Watches `hashchange` as well as running once on mount, because pasting a
   * link into a browser that already has the app open is a fragment navigation:
   * the page does not reload, so a mount-only read would silently do nothing —
   * which is exactly the flow someone follows on their phone.
   *
   * The payload rides in the fragment, so it is never sent to a server. It is
   * only ever offered; nothing is written until the user accepts it.
   */
  useEffect(() => {
    function offerSyncLink() {
      const packed = readSyncFragment(window.location.hash);
      if (!packed) return;

      const activeLocale = restoreLocale(window.localStorage);
      void decodeSyncPayload(packed).then((payload) => {
        if (payload) setPendingSync(payload);
        else setError(t(activeLocale, "sync.unreadable"));
      });
    }

    offerSyncLink();
    window.addEventListener("hashchange", offerSyncLink);
    return () => window.removeEventListener("hashchange", offerSyncLink);
  }, []);

  // Keeps `now` moving while the app is open; see `watchClock` for why. The
  // returned cleanup is the effect's, so an unmounted provider stops ticking.
  useEffect(() => watchClock(() => setNow(new Date()), window), []);

  const demoTasks = useMemo(() => createDemoTasks(now), [now]);
  // Corrections and deletions apply only to what was actually imported — the
  // demo is not something anyone is correcting. Events the student added
  // themselves are not a correction of anything, so they are always shown,
  // demo or not: adding one is how an import-less visitor tries the calendar.
  const tasks = useMemo(
    () => [...(isImported ? applyOverlay(mergeTasks(subscriptions), eventOverlay) : demoTasks), ...customEvents],
    [isImported, subscriptions, demoTasks, eventOverlay, customEvents],
  );

  const taskOwners = useMemo(() => taskOwnerIndex(subscriptions), [subscriptions]);

  // The course catalogue is a 62 KB download that only a task with no course of
  // its own (a Blackboard class meeting) can use, so it is fetched when the
  // tasks on screen include one — never for the demo, which names its courses.
  // Labels are read during render, so its arrival is a state change.
  const [catalogueReady, setCatalogueReady] = useState(isCourseCatalogueLoaded);
  const needsCatalogue = useMemo(() => tasks.some((task) => !(task.course ?? "").trim()), [tasks]);
  useEffect(() => {
    if (!needsCatalogue || catalogueReady) return;
    let cancelled = false;
    loadCourseCatalogue().then(
      () => {
        if (!cancelled) setCatalogueReady(true);
      },
      () => undefined, // Offline: labels fall back to the feed's course, as they did before it arrived.
    );
    return () => {
      cancelled = true;
    };
  }, [needsCatalogue, catalogueReady]);

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

  // What HuskyCT's gradebook says is handed in or graded. Read from the grades the
  // helper sent, and again whenever they change (here or in another tab).
  const [grades, setGrades] = useState<GradesSnapshot | null>(null);
  // Read once, where there is a browser. Which tasks are done only shows once the grades
  // have loaded, after the first render, so the server's markup never depends on it.
  const [reopened, setReopened] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : restoreReopened(window.localStorage),
  );
  const [syncedDone, setSyncedDone] = useState<Map<string, DoneReason>>(() =>
    typeof window === "undefined" ? new Map() : restoreSyncedDone(window.localStorage),
  );
  useEffect(() => {
    let alive = true;
    const read = () => {
      openGradesStore()
        .then((store) => store.get())
        .then(
          (next) => {
            if (alive) setGrades(next);
          },
          () => undefined, // blocked storage: nothing is known to be done
        );
    };
    read();
    window.addEventListener(GRADES_CHANGED, read);
    window.addEventListener("storage", read);
    return () => {
      alive = false;
      window.removeEventListener(GRADES_CHANGED, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  // What HuskyCT said on another device (a phone has no gradebook of its own), added
  // to what this device reads from its own. Only ever adds: see `mergeDone`.
  const autoDone = useMemo(
    () => mergeDone(autoDoneTasks(tasks, grades, (task) => labelFor(task)?.code ?? null), syncedDone),
    // The catalogue arriving can change which course a task shows, though `labelFor` does not
    // change with it, so it is a dependency here on its own account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, grades, labelFor, catalogueReady, syncedDone],
  );
  const doneLabelMap = useMemo(() => doneLabels(completedIds, autoDone, reopened), [completedIds, autoDone, reopened]);
  const doneIds = useMemo(() => new Set(doneLabelMap.keys()), [doneLabelMap]);

  const completionSource: CompletionSource = isImported ? "imported" : "demo";

  /** The ticks on screen are saved in two places: the source's own, and the student's own events'. */
  function saveTicks(source: CompletionSource, ticks: Set<string>) {
    saveCompletedTaskIds(window.localStorage, source, new Set([...ticks].filter((id) => !isCustomEventId(id))));
    saveCompletedTaskIds(window.localStorage, "custom", new Set([...ticks].filter(isCustomEventId)));
  }

  function toggleTaskCompletion(taskId: string) {
    // Done because HuskyCT says so: pressing it reopens the task (the gradebook can be
    // wrong about which task it is), and pressing a reopened one lets HuskyCT's word stand.
    const doneByHuskyct = autoDone.has(taskId) && !reopened.has(taskId);
    if (doneByHuskyct || (autoDone.has(taskId) && reopened.has(taskId))) {
      setReopened((previous) => {
        const next = new Set(previous);
        if (doneByHuskyct) next.add(taskId);
        else next.delete(taskId);
        saveReopened(window.localStorage, next);
        return next;
      });
      if (doneByHuskyct && completedIds.has(taskId)) {
        setCompletedIds((previous) => {
          const next = new Set(previous);
          next.delete(taskId);
          saveTicks(completionSource, next);
          return next;
        });
      }
      return;
    }
    setCompletedIds((previous) => {
      const next = new Set(previous);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      saveTicks(completionSource, next);
      return next;
    });
  }

  function setReminderEnabled(enabled: boolean) {
    setRemindersEnabled(enabled);
    saveReminderState(window.localStorage, { enabled, ...reminderLog.current });
  }

  async function toggleReminders() {
    if (remindersEnabled) {
      setReminderEnabled(false);
      return;
    }

    if (!("Notification" in window)) {
      setError(t(locale, "reminders.unsupported"));
      return;
    }

    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    setNotificationPermission(permission);

    if (permission !== "granted") {
      setError(t(locale, "reminders.denied"));
      return;
    }

    setReminderEnabled(true);
    setError(null);
    setNotice(t(locale, "reminders.enabledNotice"));
  }

  // Work already handed in is not due soon.
  const dueSoon = useMemo(() => dueSoonTasks(tasks.filter((task) => !doneIds.has(task.id)), now), [tasks, doneIds, now]);

  /**
   * Course edits are saved on every keystroke, so the code is stored exactly as
   * typed — trimming here would swallow the space in "NRE 1000E".
   */
  function commitCourseBook(next: CourseBook) {
    setCourseBook(next);
    saveCourseBook(window.localStorage, next);
  }

  function addCourse(code: string, component: CourseComponent | null) {
    commitCourseBook(addCourseToBook(courseBook, code, component));
  }

  function editCourse(
    courseId: string,
    patch: { code?: string; component?: CourseComponent | null },
  ) {
    commitCourseBook(updateCourseInBook(courseBook, courseId, patch));
  }

  function dropCourse(courseId: string) {
    commitCourseBook(removeCourseFromBook(courseBook, courseId));
  }

  function setDefaultCourse(courseId: string | null) {
    commitCourseBook(setDefaultInBook(courseBook, courseId));
  }

  function setTaskCourse(taskId: string, courseId: string | null) {
    commitCourseBook(assignTaskCourse(courseBook, taskId, courseId));
  }

  function followDefaultCourse(taskId: string) {
    commitCourseBook(clearTaskCourse(courseBook, taskId));
  }

  /** Files a feed under a course, so its rows carry the right label. */
  function addFeedCourse(subscriptionId: string, courseId: string | null) {
    commitSubscriptions(
      updateSubscription(subscriptionsRef.current, subscriptionId, { courseId }),
    );
  }

  function dropSubscription(subscriptionId: string) {
    const next = removeSubscriptionFrom(
      subscriptionsRef.current,
      subscriptionId,
    );
    commitSubscriptions(next);

    if (next.length === 0) {
      setDemoMode(true);
      setRestoredFromStorage(false);
      setCompletedIds(restoreTicks("demo", null));
    }
  }

  /** Drops the `#sync=…` fragment without reloading or navigating. */
  function clearSyncFragment() {
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${search}`);
  }

  // Which ticks go into the merge and what the screen shows afterwards are
  // decided by `planSyncApply`; this only writes the result. Shared by the
  // `#sync=` link, which asks first, and the helper's direct `postMessage`,
  // which does not.
  function applyPayload(payload: SyncPayload) {
    const plan = planSyncApply(
      {
        courses: courseBook,
        subscriptions: subscriptionsRef.current,
        announcements: announcementsRef.current,
        showingImported: isImported,
        ticksOnScreen: completedIds,
        savedTicks: restoreCompletedTaskIds(window.localStorage, "imported"),
      },
      payload,
    );
    const { merged } = plan;

    commitSubscriptions(merged.subscriptions);
    commitCourseBook(merged.courses);
    // After `commitCourseBook`, so the resolution the merge just did against the
    // merged book is what gets stored rather than a resolution against the old one.
    commitAnnouncements(merged.announcements);
    saveCompletedTaskIds(window.localStorage, "imported", plan.ticksToSave);
    // HuskyCT's word and the student's reopenings from the other device join what
    // this one has. Neither is ever taken away by a sync.
    const nextSynced = mergeDone(syncedDone, Object.entries(payload.doneByHuskyct));
    saveSyncedDone(window.localStorage, nextSynced);
    setSyncedDone(nextSynced);
    if (Object.keys(payload.courseColors).length > 0) {
      const nextColors = mergeCourseColors(courseColors, payload.courseColors);
      saveCourseColors(window.localStorage, nextColors);
      setCourseColors(nextColors);
    }
    const nextReopened = new Set([...reopened, ...payload.reopened]);
    saveReopened(window.localStorage, nextReopened);
    setReopened(nextReopened);

    if (plan.showImported) setDemoMode(false);
    if (plan.ticksOnScreen) setCompletedIds(new Set([...plan.ticksOnScreen, ...restoreCustomTicks()]));
    setRestoredFromStorage(false);
    return merged;
  }

  function applyPendingSync() {
    if (!pendingSync) return;
    const merged = applyPayload(pendingSync);
    setPendingSync(null);
    clearSyncFragment();
    setError(null);
    setNotice(
      t(locale, "sync.applied", {
        calendars: merged.addedFeeds,
        added: merged.addedEvents,
        updated: merged.updatedEvents,
        tasks: merged.completedIds.size,
        announcements: merged.announcements.length,
      }),
    );
  }

  // The helper's direct delivery. Kept current after every render, rather
  // than re-registered, so the one `message` listener mounted below never
  // closes over the render it happened to be attached on. The assignment
  // runs in an effect — not during render itself — only to satisfy the rule
  // against touching a ref while rendering; it still runs on every render.
  const applyFromHelperRef = useRef<(payload: SyncPayload) => void>(() => {});
  useEffect(() => {
    applyFromHelperRef.current = (payload: SyncPayload) => {
      const merged = applyPayload(payload);
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
    };
  });

  useEffect(() => {
    const receiver = createTasksReceiver({
      onSync: (payload) => {
        try {
          applyFromHelperRef.current(payload);
          return true;
        } catch {
          return false;
        }
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

  function dismissPendingSync() {
    setPendingSync(null);
    clearSyncFragment();
  }

  // Nudge at most once per set of due tasks, and only while the app is open:
  // without a push server a web page cannot wake itself up in the background.
  useEffect(() => {
    if (!remindersEnabled || notificationPermission !== "granted") return;
    if (dueSoon.length === 0) return;

    const signature = reminderSignature(dueSoon);
    const current: ReminderState = { enabled: true, ...reminderLog.current };
    if (!shouldNotify(current, signature, new Date())) return;

    const title = t(locale, "reminders.notificationTitle");
    const options = {
      body: t(locale, "reminders.notificationBody", { count: dueSoon.length }),
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "huskypilot-due",
    };

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.ready
        .then((registration) => registration.showNotification(title, options))
        .catch(() => undefined);
    } else {
      new Notification(title, options);
    }

    reminderLog.current = {
      lastSignature: signature,
      lastNotifiedAt: new Date().toISOString(),
    };
    saveReminderState(window.localStorage, {
      enabled: true,
      ...reminderLog.current,
    });
  }, [remindersEnabled, notificationPermission, dueSoon, locale]);

  const groups = useMemo(() => groupTasks(tasks, now, locale), [tasks, now, locale]);
  // The groups keep class meetings — seeing your day is useful — but the
  // headline says "due", so it counts only the things actually due.
  const visibleCount = groups.reduce(
    (total, group) => total + group.tasks.filter(isDeadline).length,
    0,
  );

  const formattedToday = formatDate(now, locale, { weekday: "long" });
  const formattedImportedAt = useMemo(() => {
    const latest = latestImportAt(subscriptions);
    if (!latest) return null;
    return formatDate(new Date(latest), locale, { time: true });
  }, [subscriptions, locale]);

  function restoreDemo() {
    setDemoMode(true);
    setRestoredFromStorage(false);
    setCompletedIds(restoreTicks("demo", null));
    setNotice(
      hasSubscriptions
        ? t(locale, "notices.demoRestoredWithSaved")
        : t(locale, "notices.demoRestored"),
    );
    setError(null);
  }

  function clearSavedData() {
    clearSubscriptions(window.localStorage);
    clearCompletedTaskIds(window.localStorage, "imported");
    clearCourseBook(window.localStorage);
    clearAnnouncements(window.localStorage);
    subscriptionsRef.current = [];
    announcementsRef.current = [];
    setSubscriptions([]);
    setAnnouncements([]);
    setCourseBook(EMPTY_COURSE_BOOK);
    setDemoMode(true);
    setRestoredFromStorage(false);
    setCompletedIds(restoreTicks("demo", null));
    setNotice(t(locale, "notices.savedDataCleared"));
    setError(null);
  }

  /** Download exactly what is on screen, as a spreadsheet-friendly CSV. */
  function exportTasks() {
    const csv = CSV_BOM + tasksToCsv(tasks, doneIds);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName(now);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function restoreSavedImport() {
    if (!hasSubscriptions) {
      setNotice(null);
      setError(t(locale, "errors.noSavedImport"));
      return;
    }

    setDemoMode(false);
    setRestoredFromStorage(true);
    setCompletedIds(restoreTicks("imported", subscriptionsRef.current));
    setNotice(t(locale, "notices.savedImportRestored"));
    setError(null);
  }

  const calendarName =
    subscriptions.length === 1 ? subscriptions[0].name : null;

  const value: CalendarContextValue = {
    now,
    locale,
    changeLocale,
    tasks,
    completedIds,
    doneIds,
    doneLabelFor: (taskId: string) => doneLabelMap.get(taskId) ?? null,
    hasGrades: grades !== null,
    toggleTaskCompletion,
    groups,
    visibleCount,
    dueSoon,
    courses: courseBook.courses,
    addCourse,
    editCourse,
    dropCourse,
    setDefaultCourse,
    setTaskCourse,
    followDefaultCourse,
    courseIdForTask: (taskId: string) => courseIdForTask(courseBook, taskId),
    courseLabelFor: labelFor,
    courseColorFor: (code) => courseColor(courseColors, code),
    formattedToday,
    calendarName,
    formattedImportedAt,
    isImported,
    hasSavedImport: hasSubscriptions,
    restoredFromStorage,
    subscriptions,
    addFeedCourse,
    dropSubscription,
    notice,
    error,
    restoreDemo,
    restoreSavedImport,
    clearSavedData,
    exportTasks,
    remindersEnabled,
    toggleReminders,
    pendingSync,
    applyPendingSync,
    dismissPendingSync,
    announcements,
    clearAnnouncements: dropAnnouncements,
    editEvent,
    deleteEvent,
    restoreEvent,
    restoreAllEvents,
    eventNoteFor,
    isEventEdited,
    addCustomEvent,
    addCustomEvents,
  };

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}
