"use client";

import { useEffect, useState } from "react";

import {
  EMPTY_COURSE_BOOK,
  addCourse as addCourseToBook,
  assignTaskCourse,
  clearTaskCourse,
  removeCourse as removeCourseFromBook,
  restoreCourseBook,
  saveCourseBook,
  setDefaultCourse as setDefaultInBook,
  updateCourse as updateCourseInBook,
  type CourseBook,
  type CourseComponent,
} from "@/lib/courses";

/**
 * Every course the student has named, and which task belongs to which.
 *
 * A Blackboard feed never labels a graded item with its course, and one feed can hold several
 * courses, so this cannot be a single label. `save` writes to storage and reports a failure; the
 * book changes on screen only once it is saved.
 */
export function useCourseBook(save: (write: () => void) => boolean) {
  const [courseBook, setCourseBook] = useState<CourseBook>(EMPTY_COURSE_BOOK);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setCourseBook(restoreCourseBook(window.localStorage));
      } catch {
        // Blocked storage: no courses, and the provider says storage failed.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Course edits are saved on every keystroke, so the code is stored exactly as typed: trimming
  // here would swallow the space in "NRE 1000E".
  function commit(next: CourseBook) {
    if (save(() => saveCourseBook(window.localStorage, next))) setCourseBook(next);
  }

  return {
    courseBook,
    setCourseBook,
    addCourse: (code: string, component: CourseComponent | null) => commit(addCourseToBook(courseBook, code, component)),
    editCourse: (courseId: string, patch: { code?: string; component?: CourseComponent | null }) =>
      commit(updateCourseInBook(courseBook, courseId, patch)),
    dropCourse: (courseId: string) => commit(removeCourseFromBook(courseBook, courseId)),
    setDefaultCourse: (courseId: string | null) => commit(setDefaultInBook(courseBook, courseId)),
    setTaskCourse: (taskId: string, courseId: string | null) => commit(assignTaskCourse(courseBook, taskId, courseId)),
    followDefaultCourse: (taskId: string) => commit(clearTaskCourse(courseBook, taskId)),
  };
}
