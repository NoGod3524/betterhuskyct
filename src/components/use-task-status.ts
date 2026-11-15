"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";

import type { CalendarTask } from "@/lib/calendar-types";
import {
  COMPLETION_STORAGE_KEY_CUSTOM,
  COMPLETION_STORAGE_KEY_DEMO,
  COMPLETION_STORAGE_KEY_IMPORTED,
  restoreCompletedTaskIds,
  saveCompletedTaskIds,
} from "@/lib/completion-storage";
import { isCustomEventId, restoreCustomEvents } from "@/lib/custom-events";
import type { GradesSnapshot } from "@/lib/grades";
import { GRADES_CHANGED, openGradesStore } from "@/lib/grades-store";
import { t, type Locale } from "@/lib/i18n";
import { ticksForTasks, type Subscription } from "@/lib/subscriptions";
import { writeStorageBatch } from "@/lib/storage-batch";
import {
  REOPENED_STORAGE_KEY,
  SYNCED_DONE_STORAGE_KEY,
  autoDoneTasks,
  doneLabels,
  mergeDone,
  restoreReopened,
  restoreSyncedDone,
  saveReopened,
  type DoneReason,
} from "@/lib/task-status";

export type CompletionSource = "demo" | "imported";

/**
 * The ticks to show for a source: its own that still match a task, and those on the student's own
 * events, which show in the demo and in an import alike and so are kept apart from both.
 */
export function restoreTicks(source: CompletionSource, subscriptions: Subscription[] | null): Set<string> {
  const own = restoreCompletedTaskIds(window.localStorage, source);
  const real = subscriptions ? ticksForTasks(own, subscriptions) : own;
  return new Set([...real, ...restoreCustomTicks()]);
}

/** The ticks on events the student added, for the events that are still there. */
export function restoreCustomTicks(): string[] {
  const mine = new Set(restoreCustomEvents(window.localStorage).map((event) => event.id));
  return [...restoreCompletedTaskIds(window.localStorage, "custom")].filter((id) => mine.has(id));
}

/**
 * What is done, and why: the student's own ticks, what HuskyCT's gradebook says is handed in or
 * graded (read here, or synced from another device), and the tasks the student reopened against it.
 */
export function useTaskStatus({
  tasks,
  courseCodeFor,
  catalogueReady,
  source,
  subscriptionsRef,
  locale,
  setError,
}: {
  tasks: CalendarTask[];
  courseCodeFor: (task: CalendarTask) => string | null;
  catalogueReady: boolean;
  source: CompletionSource;
  subscriptionsRef: RefObject<Subscription[]>;
  locale: Locale;
  setError: (message: string | null) => void;
}) {
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  // What HuskyCT's gradebook says, from the grades the helper sent, read again whenever they change.
  const [grades, setGrades] = useState<GradesSnapshot | null>(null);
  // Read once, where there is a browser. Which tasks are done only shows once the grades have
  // loaded, after the first render, so the server's markup never depends on it.
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

  // What HuskyCT said on another device (a phone has no gradebook of its own), added to what this
  // device reads from its own. Only ever adds: see `mergeDone`.
  const doneFromGrades = useMemo(
    () => autoDoneTasks(tasks, grades, courseCodeFor),
    // The catalogue arriving can change which course a task shows, though `courseCodeFor` does
    // not change with it, so it is a dependency here on its own account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, grades, courseCodeFor, catalogueReady],
  );
  const autoDone = useMemo(() => mergeDone(doneFromGrades, syncedDone), [doneFromGrades, syncedDone]);
  const doneLabelMap = useMemo(() => doneLabels(completedIds, autoDone, reopened), [completedIds, autoDone, reopened]);
  const doneIds = useMemo(() => new Set(doneLabelMap.keys()), [doneLabelMap]);

  useEffect(() => {
    function readCompletion(event: StorageEvent) {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      const key = event.key;
      if (key === null || [COMPLETION_STORAGE_KEY_DEMO, COMPLETION_STORAGE_KEY_IMPORTED, COMPLETION_STORAGE_KEY_CUSTOM].includes(key)) {
        setCompletedIds(restoreTicks(source, source === "imported" ? subscriptionsRef.current : null));
      }
      if (key === null || key === REOPENED_STORAGE_KEY) setReopened(restoreReopened(window.localStorage));
      if (key === null || key === SYNCED_DONE_STORAGE_KEY) setSyncedDone(restoreSyncedDone(window.localStorage));
    }
    window.addEventListener("storage", readCompletion);
    return () => window.removeEventListener("storage", readCompletion);
  }, [source, subscriptionsRef]);

  /** The ticks on screen are saved in two places: the source's own, and the student's own events'. */
  function toggleTaskCompletion(taskId: string) {
    try {
      // Another tab may have saved a choice before its storage event reaches this one. Save every
      // persisted decision: this tab's calendar can predate a move in another tab, and filtering
      // by its visible tasks would erase the tick already moved to the new id.
      const ticks = restoreTicks(source, null);
      const latestReopened = restoreReopened(window.localStorage);
      const latestSynced = restoreSyncedDone(window.localStorage);
      const fromHuskyct = doneFromGrades.has(taskId) || latestSynced.has(taskId);
      if (fromHuskyct) {
        if (latestReopened.has(taskId)) latestReopened.delete(taskId);
        else {
          latestReopened.add(taskId);
          ticks.delete(taskId);
        }
      } else if (ticks.has(taskId)) ticks.delete(taskId);
      else ticks.add(taskId);
      writeStorageBatch(window.localStorage, (staged) => {
        saveCompletedTaskIds(staged, source, new Set([...ticks].filter((id) => !isCustomEventId(id))));
        saveCompletedTaskIds(staged, "custom", new Set([...ticks].filter(isCustomEventId)));
        if (fromHuskyct && !saveReopened(staged, latestReopened)) throw new Error("Could not save task status.");
      });
      setSyncedDone(latestSynced);
      setReopened(latestReopened);
      setCompletedIds(restoreTicks(source, source === "imported" ? subscriptionsRef.current : null));
      setError(null);
    } catch {
      setError(t(locale, "errors.saveFailed"));
    }
  }

  return {
    completedIds,
    setCompletedIds,
    setReopened,
    setSyncedDone,
    hasGrades: grades !== null,
    doneIds,
    doneLabelFor: (taskId: string) => doneLabelMap.get(taskId) ?? null,
    toggleTaskCompletion,
  };
}
