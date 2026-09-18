import type { CalendarTask } from "./calendar-types.ts";
import { courseCodeForTitle } from "./course-catalogue.ts";

export const COURSES_STORAGE_KEY = "huskypilot.courses.v1";

/** Written by 1.0.1, where a calendar could only have one course. Read once. */
export const LEGACY_COURSE_LABEL_KEY = "huskypilot.courseLabel.v1";

const COURSES_VERSION = 1;
const MAX_CODE_LENGTH = 24;

/** Enough for a semester; a longer list stops being a list and becomes a form. */
export const MAX_COURSES = 12;

/** Teaching component a course runs, matching what the registrar prints. */
export type CourseComponent = "LEC" | "DIS" | "LAB" | "SEM";

export const COURSE_COMPONENTS: readonly CourseComponent[] = [
  "LEC",
  "DIS",
  "LAB",
  "SEM",
];

export type Course = {
  id: string;
  code: string;
  component: CourseComponent | null;
  /** The course most rows belong to, used by any row with no pick of its own. */
  isDefault: boolean;
};

/** What a row shows, once the pick, the feed, and the default are resolved. */
export type CourseLabel = {
  code: string;
  component: CourseComponent | null;
};

/**
 * Every course the user has named, plus the per-task overrides.
 *
 * A Blackboard calendar feed carries no course name on its graded items — no
 * categories, no usable description — and one feed can hold several courses, so
 * a single label for the whole feed is not enough. The feed *does* name the
 * course on class meetings, which is why the default covers most rows, and the
 * overrides exist for the rest.
 */
export type CourseBook = {
  courses: Course[];
  /** Task id -> course id, or `null` for "this row shows no course at all". */
  assignments: Record<string, string | null>;
};

export const EMPTY_COURSE_BOOK: CourseBook = { courses: [], assignments: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isCourseComponent(value: unknown): value is CourseComponent {
  return (
    value === "LEC" || value === "DIS" || value === "LAB" || value === "SEM"
  );
}

/** Collapse and trim a course code, for display and for values read back. */
export function normaliseCourseCode(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_CODE_LENGTH);
}

/**
 * The code exactly as typed: runs of spaces collapsed and the length capped, but
 * deliberately *not* trimmed. The code is saved on every keystroke, so trimming
 * here would swallow the space the moment someone pressed it and "NRE 1000E"
 * would become "NRE1000E".
 */
export function courseCodeAsTyped(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, MAX_CODE_LENGTH);
}

export function sameCourse(left: Course, right: Course): boolean {
  return (
    normaliseCourseCode(left.code).toLowerCase() ===
      normaliseCourseCode(right.code).toLowerCase() &&
    left.component === right.component
  );
}

function newCourseId(): string {
  const generated = globalThis.crypto?.randomUUID?.();
  if (generated) return generated;
  return `course-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseCourse(value: unknown): Course | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  if (typeof value.code !== "string") return null;

  const code = normaliseCourseCode(value.code);
  if (!code) return null;

  return {
    id: value.id,
    code,
    component: isCourseComponent(value.component) ? value.component : null,
    isDefault: value.isDefault === true,
  };
}

/**
 * Reads a stored book, dropping anything malformed instead of throwing.
 *
 * Forgiving on purpose: one bad row must not cost the user their whole course
 * list. At most one course is allowed to be the default, and an override that
 * points at a course which no longer exists is discarded.
 */
export function parseStoredCourseBook(rawValue: string): CourseBook | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.version !== COURSES_VERSION) return null;
  if (!Array.isArray(parsed.courses)) return null;

  let sawDefault = false;
  const courses: Course[] = [];
  for (const entry of parsed.courses) {
    const course = parseCourse(entry);
    if (!course) continue;
    if (course.isDefault) {
      if (sawDefault) course.isDefault = false;
      else sawDefault = true;
    }
    courses.push(course);
  }

  const known = new Set(courses.map((course) => course.id));
  const assignments: Record<string, string | null> = {};
  if (isRecord(parsed.assignments)) {
    for (const [taskId, courseId] of Object.entries(parsed.assignments)) {
      if (!taskId) continue;
      if (courseId === null) {
        assignments[taskId] = null;
      } else if (typeof courseId === "string" && known.has(courseId)) {
        assignments[taskId] = courseId;
      }
    }
  }

  return { courses, assignments };
}

export function saveCourseBook(storage: Storage, book: CourseBook) {
  storage.setItem(
    COURSES_STORAGE_KEY,
    JSON.stringify({
      version: COURSES_VERSION,
      courses: book.courses,
      assignments: book.assignments,
    }),
  );
}

export function clearCourseBook(storage: Storage) {
  storage.removeItem(COURSES_STORAGE_KEY);
  storage.removeItem(LEGACY_COURSE_LABEL_KEY);
}

/**
 * Turns the 1.0.1 single-label setting into a one-course book.
 *
 * Without this, everyone who had already said "this calendar is NRE 1000E"
 * would open the new version to an empty course list.
 */
export function migrateLegacyCourseLabel(storage: Storage): CourseBook | null {
  const raw = storage.getItem(LEGACY_COURSE_LABEL_KEY);
  if (!raw) return null;
  storage.removeItem(LEGACY_COURSE_LABEL_KEY);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.code !== "string") return null;

  const code = normaliseCourseCode(parsed.code);
  if (!code) return null;

  const book: CourseBook = {
    courses: [
      {
        id: newCourseId(),
        code,
        component: isCourseComponent(parsed.component) ? parsed.component : null,
        isDefault: true,
      },
    ],
    assignments: {},
  };
  saveCourseBook(storage, book);
  return book;
}

export function restoreCourseBook(storage: Storage): CourseBook {
  const raw = storage.getItem(COURSES_STORAGE_KEY);
  if (!raw) return migrateLegacyCourseLabel(storage) ?? EMPTY_COURSE_BOOK;

  const parsed = parseStoredCourseBook(raw);
  if (parsed) return parsed;

  // Unreadable: drop it rather than let it break the page on every open.
  clearCourseBook(storage);
  return EMPTY_COURSE_BOOK;
}

export function defaultCourse(book: CourseBook): Course | null {
  return book.courses.find((course) => course.isDefault) ?? null;
}

/**
 * The override stored for a task: a course id, `null` for "show nothing", or
 * `undefined` when the user has never touched this row.
 */
export function courseIdForTask(
  book: CourseBook,
  taskId: string,
): string | null | undefined {
  return book.assignments[taskId];
}

export function addCourse(
  book: CourseBook,
  code: string,
  component: CourseComponent | null,
): CourseBook {
  const typed = courseCodeAsTyped(code);
  if (!normaliseCourseCode(typed)) return book;
  if (book.courses.length >= MAX_COURSES) return book;

  const candidate: Course = {
    id: newCourseId(),
    code: typed,
    component: isCourseComponent(component) ? component : null,
    // The first course added is what the untouched rows should show.
    isDefault: book.courses.length === 0,
  };
  if (book.courses.some((course) => sameCourse(course, candidate))) return book;

  return { ...book, courses: [...book.courses, candidate] };
}

/** Edits in place. Kept out of `addCourse` so renaming never creates a duplicate. */
export function updateCourse(
  book: CourseBook,
  id: string,
  patch: { code?: string; component?: CourseComponent | null },
): CourseBook {
  return {
    ...book,
    courses: book.courses.map((course) =>
      course.id === id
        ? {
            ...course,
            code:
              patch.code === undefined
                ? course.code
                : courseCodeAsTyped(patch.code),
            component:
              patch.component === undefined
                ? course.component
                : isCourseComponent(patch.component)
                  ? patch.component
                  : null,
          }
        : course,
    ),
  };
}

export function removeCourse(book: CourseBook, id: string): CourseBook {
  const assignments: Record<string, string | null> = {};
  for (const [taskId, courseId] of Object.entries(book.assignments)) {
    // Overrides pointing at a deleted course fall back to the default.
    if (courseId !== id) assignments[taskId] = courseId;
  }

  const courses = book.courses.filter((course) => course.id !== id);
  // Deleting the default must not blank the whole list, so hand it to the next
  // course rather than leaving every untouched row with nothing.
  if (!courses.some((course) => course.isDefault) && courses.length > 0) {
    courses[0] = { ...courses[0], isDefault: true };
  }

  return { courses, assignments };
}

export function setDefaultCourse(book: CourseBook, id: string | null): CourseBook {
  const exists = id !== null && book.courses.some((course) => course.id === id);
  return {
    ...book,
    courses: book.courses.map((course) => ({
      ...course,
      isDefault: exists && course.id === id,
    })),
  };
}

export function assignTaskCourse(
  book: CourseBook,
  taskId: string,
  courseId: string | null,
): CourseBook {
  const assignments = { ...book.assignments };
  if (courseId === null) {
    assignments[taskId] = null;
  } else if (book.courses.some((course) => course.id === courseId)) {
    assignments[taskId] = courseId;
  } else {
    delete assignments[taskId];
  }

  return { ...book, assignments };
}

/** Drops the override, so the row follows the default again. */
export function clearTaskCourse(book: CourseBook, taskId: string): CourseBook {
  const assignments = { ...book.assignments };
  delete assignments[taskId];
  return { ...book, assignments };
}

/**
 * What one row should print: the user's pick, else the course named by the feed
 * itself, else the course UConn's catalogue says owns that title, else the
 * course the feed was filed under, else the default course. Never an invented
 * name.
 *
 * The catalogue step is what makes a Blackboard feed usable without setup: a
 * class meeting is titled "Environmental Science" and carries no code, and only
 * one course owns that title. An assignment titled "Take-home Quiz 1" matches
 * nothing, and falls through to the course its feed was filed under.
 */
export function labelForTask(
  book: CourseBook,
  task: CalendarTask,
  feedCourseId: string | null = null,
): CourseLabel | null {
  const picked = book.assignments[task.id];
  if (picked === null) return null;

  let course: Course | null = null;
  if (typeof picked === "string") {
    course = book.courses.find((entry) => entry.id === picked) ?? null;
  }
  if (!course) {
    const fromFeed = (task.course ?? "").trim();
    if (fromFeed) return { code: fromFeed, component: null };

    const fromCatalogue = courseCodeForTitle(task.title);
    if (fromCatalogue) {
      return {
        code: fromCatalogue,
        // A catalogue match arrives bare; if the user already named this course
        // with a component, reuse it rather than dropping it.
        component:
          task.kind === "class" ? componentForCode(book, fromCatalogue) : null,
      };
    }

    course =
      book.courses.find((entry) => entry.id === feedCourseId) ?? defaultCourse(book);
  }
  if (!course) return null;

  const code = normaliseCourseCode(course.code);
  if (!code) return null;

  // A teaching component describes a class meeting, not an assignment.
  return {
    code,
    component: task.kind === "class" ? course.component : null,
  };
}

function componentForCode(book: CourseBook, code: string): CourseComponent | null {
  const wanted = code.toUpperCase();
  const match = book.courses.find(
    (entry) => normaliseCourseCode(entry.code).toUpperCase() === wanted,
  );
  return match?.component ?? null;
}
