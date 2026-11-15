"use client";

import { useEffect, useMemo, useState } from "react";

import type { CalendarTask } from "@/lib/calendar-types";
import { isCourseCatalogueLoaded, loadCourseCatalogue } from "@/lib/course-catalogue";

/**
 * Whether the course catalogue has arrived, fetching it when the tasks on screen need it.
 *
 * It is a 62 KB download that only a task with no course of its own (a Blackboard class meeting)
 * can use, so it is never fetched for the demo, which names its courses. Labels are read during
 * render, so its arrival is a state change.
 */
export function useCourseCatalogue(tasks: CalendarTask[]): boolean {
  const [ready, setReady] = useState(isCourseCatalogueLoaded);
  const needed = useMemo(() => tasks.some((task) => !(task.course ?? "").trim()), [tasks]);
  useEffect(() => {
    if (!needed || ready) return;
    let cancelled = false;
    loadCourseCatalogue().then(
      () => {
        if (!cancelled) setReady(true);
      },
      () => undefined, // Offline: labels fall back to the feed's course, as they did before it arrived.
    );
    return () => {
      cancelled = true;
    };
  }, [needed, ready]);
  return ready;
}
