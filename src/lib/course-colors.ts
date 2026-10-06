import type { CSSProperties } from "react";

/**
 * Each course's colour, as HuskyCT's Courses page draws it, brought over by the helper, so a
 * course looks the same here as it does there. Keyed by course code ("MATH 1070Q"); a course
 * with no colour keeps the one this app picks for it.
 */
export type CourseColors = Record<string, string>;

export const COURSE_COLORS_KEY = "huskypilot.courseColors.v1";
const MAX_COLORS = 60;
const HEX = /^#[0-9a-f]{6}$/i;

/** "MATH 1070Q", "math-1070q" and "MATH1070Q" are one course. */
export function colorKey(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Colours from a payload or from storage, checked; anything malformed is dropped. */
export function parseCourseColors(value: unknown): CourseColors {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const colors: CourseColors = {};
  for (const [code, color] of Object.entries(value as Record<string, unknown>).slice(0, MAX_COLORS)) {
    const key = colorKey(code);
    if (!key || key.length > 20 || typeof color !== "string" || !HEX.test(color)) continue;
    colors[key] = color.toLowerCase();
  }
  return colors;
}

/** What arrives joins what was kept; a course read again takes its new colour. */
export function mergeCourseColors(kept: CourseColors, arrived: CourseColors): CourseColors {
  return parseCourseColors({ ...kept, ...arrived });
}

export function restoreCourseColors(storage: Pick<Storage, "getItem">): CourseColors {
  try {
    return parseCourseColors(JSON.parse(storage.getItem(COURSE_COLORS_KEY) ?? "{}"));
  } catch {
    return {};
  }
}

export function saveCourseColors(storage: Pick<Storage, "setItem">, colors: CourseColors): void {
  try {
    storage.setItem(COURSE_COLORS_KEY, JSON.stringify(colors));
  } catch {
    /* kept for this visit */
  }
}

export function courseColor(colors: CourseColors, code: string | null | undefined): string | null {
  return code ? colors[colorKey(code)] ?? null : null;
}

/**
 * A course chip in the course's colour that reads in both themes: a wash of the colour behind,
 * and the colour mixed towards the page's own text colour in front, so it is dark on the light
 * theme and light on the dark one.
 */
export function chipStyle(color: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
    color: `color-mix(in srgb, ${color} 70%, var(--c-172b41))`,
  };
}
