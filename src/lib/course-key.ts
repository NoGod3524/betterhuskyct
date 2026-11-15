import { normaliseCourseCode } from "./courses.ts";

/**
 * The one name a course goes by across tasks, announcements, files, grades and changes: its code,
 * spaces collapsed and in capitals ("CSE 2050"). Each source spells codes its own way; this is
 * what makes them meet. Null when there is no code.
 */
export function courseKey(code: string | null | undefined): string | null {
  const normalised = code ? normaliseCourseCode(code).toUpperCase() : "";
  return normalised || null;
}

/** The course's address in the app: "CSE 2050" is /courses/cse-2050. */
export function courseSlug(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "course";
}

export function coursePath(key: string, tab?: CourseTab): string {
  return `/courses/${courseSlug(key)}${tab && tab !== "activity" ? `?tab=${tab}` : ""}`;
}

/** The tabs of a course's page, in order. */
export const COURSE_TABS = ["activity", "tasks", "announcements", "materials", "grades"] as const;
export type CourseTab = (typeof COURSE_TABS)[number];

export function isCourseTab(value: unknown): value is CourseTab {
  return typeof value === "string" && (COURSE_TABS as readonly string[]).includes(value);
}

/** Which tab a page of the old all-courses layout corresponds to. */
export function tabForPage(page: string): CourseTab {
  switch (page) {
    case "/announcements":
      return "announcements";
    case "/materials":
      return "materials";
    case "/grades":
      return "grades";
    case "/tasks":
    case "/calendar":
      return "tasks";
    default:
      return "activity";
  }
}
