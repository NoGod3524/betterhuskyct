"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { isDeadline } from "@/lib/calendar-types";
import type { CalendarImportResult, CalendarTask, TaskGroup } from "@/lib/calendar-types";
import {
  addSubscription,
  addSubscriptions,
  clearSubscriptions,
  latestImportAt,
  mergeTasks,
  removeSubscription as removeSubscriptionFrom,
  restoreRememberSource,
  restoreSubscriptions,
  saveRememberSource,
  saveSubscriptions,
  taskOwnerIndex,
  updateSubscription,
  MAX_SUBSCRIPTIONS,
  type Subscription,
} from "@/lib/subscriptions";
import { CalendarFileError, readCalendarFile } from "@/lib/calendar-file";
import {
  buildSyncPayload,
  decodeSyncPayload,
  encodeSyncPayload,
  readSyncFragment,
  syncLink,
  type SyncPayload,
} from "@/lib/sync";
import { mergeSyncPayload } from "@/lib/sync-merge";
import {
  clearCompletedTaskIds,
  restoreCompletedTaskIds,
  saveCompletedTaskIds,
  type CompletionSource,
} from "@/lib/completion-storage";
import { createDemoTasks, groupTasks } from "@/lib/calendar-view";
import {
  restoreEffortMap,
  saveEffortMap,
  withEffort,
  type EffortLevel,
  type EffortMap,
} from "@/lib/effort";
import { buildPlan, type Plan } from "@/lib/plan";
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
import { computeInsights, type Insights } from "@/lib/insights";
import {
  dueSoonTasks,
  reminderSignature,
  restoreReminderState,
  saveReminderState,
  shouldNotify,
  type ReminderState,
} from "@/lib/reminders";
import { CSV_BOM, exportFileName, tasksToCsv } from "@/lib/export";
import {
  DEFAULT_LOCALE,
  intlLocale,
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
  completedIds: Set<string>;
  toggleTaskCompletion: (taskId: string) => void;
  groups: TaskGroup[];
  visibleCount: number;
  dueSoon: CalendarTask[];

  efforts: EffortMap;
  setTaskEffort: (taskId: string, level: EffortLevel) => void;
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
  plan: Plan;

  insights: Insights;
  completionPercent: number;
  busiestDay: number;
  busiestWeek: number;
  busiestCourse: number;
  formattedToday: string;

  calendarName: string | null;
  formattedImportedAt: string | null;
  isImported: boolean;
  hasSavedImport: boolean;
  restoredFromStorage: boolean;

  subscriptions: Subscription[];
  canAddSubscription: boolean;
  importCourseId: string;
  setImportCourseId: (value: string) => void;
  addFeedCourse: (subscriptionId: string, courseId: string | null) => void;
  dropSubscription: (subscriptionId: string) => void;
  refreshSubscription: (subscriptionId: string) => Promise<void>;

  calendarUrl: string;
  setCalendarUrl: (value: string) => void;
  isLoading: boolean;
  notice: string | null;
  error: string | null;
  handleImport: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  importCalendarFiles: (files: File[]) => Promise<void>;
  restoreDemo: () => void;
  restoreSavedImport: () => void;
  clearSavedData: () => void;
  exportTasks: () => void;

  remindersEnabled: boolean;
  toggleReminders: () => Promise<void>;

  rememberSource: boolean;
  toggleRememberSource: () => void;

  /** A link from another device, waiting for the user to accept it. */
  pendingSync: SyncPayload | null;
  applyPendingSync: () => void;
  dismissPendingSync: () => void;
  /** The generated link, once the user has asked for one. */
  outgoingSyncLink: string | null;
  createSyncLink: () => Promise<void>;
  isPackingSync: boolean;
  syncError: string | null;
};

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function useCalendar(): CalendarContextValue {
  const value = useContext(CalendarContext);
  if (!value) {
    throw new Error("useCalendar must be used inside <CalendarProvider>");
  }
  return value;
}

function taskIdsOf(subscriptions: Subscription[]): Set<string> {
  return new Set(mergeTasks(subscriptions).map((task) => task.id));
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
export function CalendarProvider({
  initialNow,
  children,
}: {
  initialNow: string;
  children: ReactNode;
}) {
  const [now, setNow] = useState(() => new Date(initialNow));
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [calendarUrl, setCalendarUrl] = useState("");
  const [importCourseId, setImportCourseId] = useState("");
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  // True while the demo data is what the pages show, either because nothing has
  // been imported yet or because the user asked for the demo back.
  const [demoMode, setDemoMode] = useState(true);
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  // Task id -> how much work the user says it is. Defaults to "medium".
  const [efforts, setEfforts] = useState<EffortMap>({});
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
  const [rememberSource, setRememberSource] = useState(false);
  // Mirrors `subscriptions` for async work, which would otherwise close over a
  // stale value between awaits.
  const subscriptionsRef = useRef<Subscription[]>([]);
  // A link from another device is offered, never applied on its own.
  const [pendingSync, setPendingSync] = useState<SyncPayload | null>(null);
  const [outgoingSyncLink, setOutgoingSyncLink] = useState<string | null>(null);
  const [isPackingSync, setIsPackingSync] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

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

  /**
   * Everything that must happen after a calendar lands: show the imported data
   * instead of the demo, keep the tick marks that still match a real task, and
   * say how much arrived.
   */
  function applyAddedSubscriptions(next: Subscription[], events: number) {
    commitSubscriptions(next);
    setDemoMode(false);
    setRestoredFromStorage(false);
    const eventIds = taskIdsOf(next);
    const restoredCompleted = restoreCompletedTaskIds(
      window.localStorage,
      "imported",
    );
    setCompletedIds(
      new Set([...restoredCompleted].filter((id) => eventIds.has(id))),
    );
    setNotice(
      t(
        locale,
        events === 1 ? "notices.importedEvent" : "notices.importedEvents",
        { count: events },
      ),
    );
  }

  async function requestImport(payload: { url: string } | { ics: string }) {
    const response = await fetch("/api/calendar/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as CalendarImportResult & {
      error?: string;
    };

    if (!response.ok) {
      throw new Error(result.error ?? t(locale, "errors.importFailed"));
    }

    return result;
  }

  function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsLoading(true);

    return (async () => {
      try {
        const result = await requestImport({ url: calendarUrl });
        const next = addSubscription(subscriptionsRef.current, result, {
          courseId: importCourseId || null,
          url: rememberSource ? calendarUrl : null,
        });

        if (next.length === subscriptionsRef.current.length) {
          setError(t(locale, "errors.tooManyCalendars", { max: MAX_SUBSCRIPTIONS }));
          return;
        }

        applyAddedSubscriptions(next, result.events.length);
        setCalendarUrl("");
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : t(locale, "errors.importFailed"),
        );
      } finally {
        setIsLoading(false);
      }
    })();
  }

  /**
   * Imports downloaded `.ics` files.
   *
   * The file is read and parsed here in the page, so it is never uploaded and no
   * link has to be found — which is the only import path that behaves the same
   * way on Blackboard, Canvas, Moodle, Google Classroom and anything else that
   * can hand out an iCalendar file.
   */
  async function importCalendarFiles(files: File[]) {
    if (files.length === 0) return;

    setError(null);
    setNotice(null);
    setIsLoading(true);

    try {
      const accepted: Array<{ name: string; result: CalendarImportResult }> = [];
      const skipped: string[] = [];
      for (const file of files) {
        try {
          const { name, icsText } = await readCalendarFile(file);
          accepted.push({ name, result: await requestImport({ ics: icsText }) });
        } catch (caughtError) {
          skipped.push(
            caughtError instanceof CalendarFileError &&
              caughtError.problem === "too-large"
              ? t(locale, "errors.fileTooLarge", { name: file.name })
              : file.name,
          );
        }
      }

      if (accepted.length === 0) {
        setError(
          skipped.length > 0
            ? t(locale, "errors.filesSkipped", { names: skipped.join(", ") })
            : t(locale, "errors.noCalendarFiles"),
        );
        return;
      }

      const next = addSubscriptions(
        subscriptionsRef.current,
        accepted.map((entry) => entry.result),
        {
          courseId: importCourseId || null,
          name: (index) => accepted[index].name,
        },
      );
      const added = next.length - subscriptionsRef.current.length;
      const events = accepted.reduce(
        (total, entry) => total + entry.result.events.length,
        0,
      );

      applyAddedSubscriptions(next, events);

      if (added < accepted.length) {
        setError(t(locale, "errors.tooManyCalendars", { max: MAX_SUBSCRIPTIONS }));
      } else if (skipped.length > 0) {
        setError(t(locale, "errors.filesSkipped", { names: skipped.join(", ") }));
      }
    } finally {
      setIsLoading(false);
    }
  }

  /** Re-fetch every feed the user asked us to remember, one at a time. */
  async function refreshRemembered(
    initial: Subscription[],
    activeLocale: Locale,
  ) {
    const remembered = initial.filter((subscription) => subscription.url);
    if (remembered.length === 0) return;

    let failures = 0;
    let imported = 0;
    for (const subscription of remembered) {
      try {
        const result = await requestImport({ url: subscription.url as string });
        imported += result.events.length;
        commitSubscriptions(
          updateSubscription(subscriptionsRef.current, subscription.id, {
            events: result.events,
            name: result.calendarName,
            importedAt: result.importedAt,
            lastError: null,
          }),
        );
      } catch {
        // Offline, or the feed stopped working: keep the cached copy and say so.
        failures += 1;
        commitSubscriptions(
          updateSubscription(subscriptionsRef.current, subscription.id, {
            lastError: t(activeLocale, "subscriptions.failed"),
          }),
        );
      }
    }

    const merged = taskIdsOf(subscriptionsRef.current);
    setCompletedIds((previous) =>
      new Set([...previous].filter((id) => merged.has(id))),
    );
    setNotice(
      failures === 0
        ? t(activeLocale, "notices.autoRefreshed", { count: imported })
        : t(activeLocale, "notices.autoRefreshFailed"),
    );
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const currentTime = new Date();
      setNow(currentTime);
      const restoredLocale = restoreLocale(window.localStorage);
      setLocale(restoredLocale);
      setRememberSource(restoreRememberSource(window.localStorage));

      const restored = restoreSubscriptions(window.localStorage);
      subscriptionsRef.current = restored.subscriptions;
      setSubscriptions(restored.subscriptions);
      setDemoMode(restored.subscriptions.length === 0);

      if (restored.subscriptions.length > 0) {
        setRestoredFromStorage(true);
        setNotice(t(restoredLocale, "notices.restoredImported"));
        const eventIds = taskIdsOf(restored.subscriptions);
        const restoredCompleted = restoreCompletedTaskIds(
          window.localStorage,
          "imported",
        );
        setCompletedIds(
          new Set([...restoredCompleted].filter((id) => eventIds.has(id))),
        );
      } else {
        if (restored.recoveredFromCorruptData) {
          setNotice(t(restoredLocale, "notices.corruptDataCleared"));
        }
        setCompletedIds(restoreCompletedTaskIds(window.localStorage, "demo"));
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
      setEfforts(restoreEffortMap(window.localStorage));
      setCourseBook(restoreCourseBook(window.localStorage));

      void refreshRemembered(restored.subscriptions, restoredLocale);
    }, 0);

    return () => window.clearTimeout(timer);
    // Restore-on-mount must run exactly once. `refreshRemembered` is recreated
    // on every render, so listing it here would re-run the whole restore on each
    // render instead of once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const demoTasks = useMemo(() => createDemoTasks(now), [now]);  const tasks = useMemo(
    () => (isImported ? mergeTasks(subscriptions) : demoTasks),
    [isImported, subscriptions, demoTasks],
  );

  const taskOwners = useMemo(() => taskOwnerIndex(subscriptions), [subscriptions]);

  const completionSource: CompletionSource = isImported ? "imported" : "demo";

  function toggleTaskCompletion(taskId: string) {
    setCompletedIds((previous) => {
      const next = new Set(previous);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      saveCompletedTaskIds(window.localStorage, completionSource, next);
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

  const dueSoon = useMemo(() => dueSoonTasks(tasks, now), [tasks, now]);

  function setTaskEffort(taskId: string, level: EffortLevel) {
    setEfforts((previous) => {
      const next = withEffort(previous, taskId, level);
      saveEffortMap(window.localStorage, next);
      return next;
    });
  }

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
      setCompletedIds(restoreCompletedTaskIds(window.localStorage, "demo"));
    }
  }

  async function refreshSubscription(subscriptionId: string) {
    const subscription = subscriptionsRef.current.find(
      (entry) => entry.id === subscriptionId,
    );
    if (!subscription?.url) return;

    try {
      const result = await requestImport({ url: subscription.url });
      commitSubscriptions(
        updateSubscription(subscriptionsRef.current, subscriptionId, {
          events: result.events,
          name: result.calendarName,
          importedAt: result.importedAt,
          lastError: null,
        }),
      );
      setNotice(
        t(locale, "notices.importedEvents", { count: result.events.length }),
      );
      setError(null);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : t(locale, "errors.importFailed");
      commitSubscriptions(
        updateSubscription(subscriptionsRef.current, subscriptionId, {
          lastError: message,
        }),
      );
      setError(message);
    }
  }

  /** Drops the `#sync=…` fragment without reloading or navigating. */
  function clearSyncFragment() {
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${search}`);
  }

  /**
   * Packs everything this device knows into a link the user sends themselves.
   *
   * The feed URL stays behind on purpose: a link that gets pasted into a chat
   * client must not be a password. The events travel instead, which is what lets
   * the second device skip the import entirely.
   */
  async function createSyncLink() {
    setIsPackingSync(true);
    setSyncError(null);
    try {
      const payload = buildSyncPayload({
        feeds: subscriptionsRef.current.map((subscription) => ({
          name: subscription.name,
          courseId: subscription.courseId,
          importedAt: subscription.importedAt,
          events: subscription.events,
        })),
        completedIds,
        efforts,
        courses: courseBook,
      });
      const packed = await encodeSyncPayload(payload);

      setOutgoingSyncLink(
        syncLink(window.location.origin, window.location.pathname, packed),
      );
    } catch {
      setSyncError(t(locale, "sync.packFailed"));
    } finally {
      setIsPackingSync(false);
    }
  }

  function applyPendingSync() {
    if (!pendingSync) return;

    const merged = mergeSyncPayload(
      {
        courses: courseBook,
        efforts,
        completedIds,
        subscriptions: subscriptionsRef.current,
      },
      pendingSync,
    );

    commitSubscriptions(merged.subscriptions);
    commitCourseBook(merged.courses);
    setEfforts(merged.efforts);
    saveEffortMap(window.localStorage, merged.efforts);
    setCompletedIds(merged.completedIds);
    saveCompletedTaskIds(window.localStorage, "imported", merged.completedIds);

    if (merged.subscriptions.length > 0) setDemoMode(false);
    setRestoredFromStorage(false);
    setPendingSync(null);
    setOutgoingSyncLink(null);
    clearSyncFragment();
    setError(null);
    setNotice(
      t(locale, "sync.applied", {
        calendars: merged.addedFeeds,
        tasks: merged.completedIds.size,
      }),
    );
  }

  function dismissPendingSync() {
    setPendingSync(null);
    clearSyncFragment();
  }

  // Recomputed from the current tasks, so the plan always matches the screen.
  const plan = useMemo(
    () => buildPlan(tasks, completedIds, efforts, now),
    [tasks, completedIds, efforts, now],
  );

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

  const insights = useMemo(
    () => computeInsights(tasks, completedIds, now),
    [tasks, completedIds, now],
  );
  const busiestDay = Math.max(1, ...insights.nextSevenDays);
  const busiestWeek = Math.max(1, ...insights.byWeek);
  const busiestCourse = Math.max(
    1,
    ...insights.byCourse.map((row) => row.total),
  );
  const completionPercent = Math.round(insights.completionRate * 100);

  const formattedToday = new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
  const formattedImportedAt = useMemo(() => {
    const latest = latestImportAt(subscriptions);
    if (!latest) return null;
    return new Intl.DateTimeFormat(intlLocale(locale), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(latest));
  }, [subscriptions, locale]);

  function toggleRememberSource() {
    const next = !rememberSource;
    setRememberSource(next);
    saveRememberSource(window.localStorage, next);
  }

  function restoreDemo() {
    setDemoMode(true);
    setRestoredFromStorage(false);
    setCompletedIds(restoreCompletedTaskIds(window.localStorage, "demo"));
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
    saveEffortMap(window.localStorage, {});
    clearCourseBook(window.localStorage);
    subscriptionsRef.current = [];
    setSubscriptions([]);
    setCourseBook(EMPTY_COURSE_BOOK);
    setEfforts({});
    setDemoMode(true);
    setRestoredFromStorage(false);
    setCompletedIds(restoreCompletedTaskIds(window.localStorage, "demo"));
    setNotice(t(locale, "notices.savedDataCleared"));
    setError(null);
  }

  /** Download exactly what is on screen, as a spreadsheet-friendly CSV. */
  function exportTasks() {
    const csv = CSV_BOM + tasksToCsv(tasks, completedIds);
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
    const eventIds = taskIdsOf(subscriptionsRef.current);
    const restoredCompleted = restoreCompletedTaskIds(
      window.localStorage,
      "imported",
    );
    setCompletedIds(
      new Set([...restoredCompleted].filter((id) => eventIds.has(id))),
    );
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
    toggleTaskCompletion,
    groups,
    visibleCount,
    dueSoon,
    efforts,
    setTaskEffort,
    courses: courseBook.courses,
    addCourse,
    editCourse,
    dropCourse,
    setDefaultCourse,
    setTaskCourse,
    followDefaultCourse,
    courseIdForTask: (taskId: string) => courseIdForTask(courseBook, taskId),
    courseLabelFor: (task: CalendarTask) => {
      const ownerId = taskOwners.get(task.id);
      const feedCourseId = ownerId
        ? (subscriptions.find((entry) => entry.id === ownerId)?.courseId ?? null)
        : null;
      return labelForTask(courseBook, task, feedCourseId);
    },
    plan,
    insights,
    completionPercent,
    busiestDay,
    busiestWeek,
    busiestCourse,
    formattedToday,
    calendarName,
    formattedImportedAt,
    isImported,
    hasSavedImport: hasSubscriptions,
    restoredFromStorage,
    subscriptions,
    canAddSubscription: subscriptions.length < MAX_SUBSCRIPTIONS,
    importCourseId,
    setImportCourseId,
    addFeedCourse,
    dropSubscription,
    refreshSubscription,
    calendarUrl,
    setCalendarUrl,
    isLoading,
    notice,
    error,
    handleImport,
    importCalendarFiles,
    restoreDemo,
    restoreSavedImport,
    clearSavedData,
    exportTasks,
    remindersEnabled,
    toggleReminders,
    rememberSource,
    toggleRememberSource,
    pendingSync,
    applyPendingSync,
    dismissPendingSync,
    outgoingSyncLink,
    createSyncLink,
    isPackingSync,
    syncError,
  };

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}
