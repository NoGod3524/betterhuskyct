"use client";

import { useEffect, useMemo, useState } from "react";

import { useCalendar } from "@/components/calendar-provider";
import { DELIVERY_EVENT } from "@/components/helper-deliveries";
import { useChanges } from "@/components/use-changes";
import { isDeadline, type CalendarTask } from "@/lib/calendar-types";
import { courseKey } from "@/lib/course-key";
import { dueTimestamp, startOfLocalDay } from "@/lib/date-utils";
import { parseStoredGrades, summarizeCourse, type GradesSnapshot } from "@/lib/grades";
import { GRADES_CHANGED, GRADES_STORAGE_KEY } from "@/lib/grades-store";
import type { MaterialsIndex } from "@/lib/materials";
import { openMaterialsStore } from "@/lib/materials-store";

/** One course as the course list shows it, gathered from every source that names it. */
export type CourseSummary = {
  key: string;
  color: string | null;
  /** Open deadlines from today on. */
  open: number;
  next: CalendarTask | null;
  unread: number;
  announcements: number;
  files: number;
  /** The points so far as a percentage, when the gradebook has any. */
  percent: number | null;
};

function readGrades(): GradesSnapshot | null {
  try {
    return parseStoredGrades(JSON.parse(window.localStorage.getItem(GRADES_STORAGE_KEY) || "null"));
  } catch {
    return null;
  }
}

/** The course files' index, read again whenever the helper delivers. Null until read, or if storage is blocked. */
function useMaterialsIndex(): { index: MaterialsIndex | null; loaded: boolean } {
  const [index, setIndex] = useState<MaterialsIndex | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void openMaterialsStore()
        .then((store) => store.getIndex())
        .then((next) => {
          if (alive) setIndex(next);
        })
        .catch(() => undefined)
        .finally(() => {
          if (alive) setLoaded(true);
        });
    };
    load();
    window.addEventListener(DELIVERY_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(DELIVERY_EVENT, load);
    };
  }, []);
  return { index, loaded };
}

function useGrades(): { grades: GradesSnapshot | null; loaded: boolean } {
  const [grades, setGrades] = useState<GradesSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const load = () => {
      setGrades(readGrades());
      setLoaded(true);
    };
    load();
    window.addEventListener(GRADES_CHANGED, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(GRADES_CHANGED, load);
      window.removeEventListener("storage", load);
    };
  }, []);
  return { grades, loaded };
}

/**
 * Every course the student has, by code, with what is waiting in each. A course is any code that
 * shows up in the deadlines, announcements, files, grades or changes, so nothing has to be set up.
 */
export function useCourseList(): { ready: boolean; courses: CourseSummary[] } {
  const { calendarReady, tasks, doneIds, now, courseLabelFor, courseColorFor, announcements, courses: courseBook } = useCalendar();
  const changes = useChanges();
  const { index: materials, loaded: materialsLoaded } = useMaterialsIndex();
  const { grades, loaded: gradesLoaded } = useGrades();

  const courses = useMemo(() => {
    const byKey = new Map<string, CourseSummary>();
    const entry = (code: string | null | undefined) => {
      const key = courseKey(code);
      if (!key) return null;
      let found = byKey.get(key);
      if (!found) {
        found = { key, color: courseColorFor(key), open: 0, next: null, unread: 0, announcements: 0, files: 0, percent: null };
        byKey.set(key, found);
      }
      return found;
    };

    const today = startOfLocalDay(now).valueOf();
    for (const task of tasks) {
      if (!isDeadline(task)) continue;
      const course = entry(courseLabelFor(task)?.code);
      if (!course || doneIds.has(task.id)) continue;
      const due = dueTimestamp(task);
      if (due === null || due < today) continue;
      course.open += 1;
      const nextDue = course.next ? dueTimestamp(course.next) : null;
      if (nextDue === null || due < nextDue) course.next = task;
    }
    const codeForId = new Map(courseBook.map((course) => [course.id, course.code]));
    for (const announcement of announcements) {
      const course = entry(announcement.courseCode ?? (announcement.courseId ? codeForId.get(announcement.courseId) : null));
      if (course) course.announcements += 1;
    }
    for (const change of changes.store.entries) {
      const course = entry(change.courseCode);
      if (course && !change.read) course.unread += 1;
    }
    for (const course of materials?.courses ?? []) {
      const found = entry(course.code);
      if (found) found.files += course.files.length;
    }
    for (const course of grades?.courses ?? []) {
      const found = entry(course.code);
      if (found) found.percent = summarizeCourse(course).percent;
    }
    return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
  }, [tasks, doneIds, now, courseLabelFor, courseColorFor, announcements, courseBook, changes.store, materials, grades]);

  return { ready: calendarReady && changes.ready && materialsLoaded && gradesLoaded, courses };
}
