"use client";

import { useCalendar } from "@/components/calendar-provider";
import { t } from "@/lib/i18n";

/** Sentinel for "this row shows no course", distinct from "follow the default". */
const NO_COURSE = "__none";

/**
 * The per-row course override.
 *
 * A Blackboard feed names the course on class meetings but never on graded
 * items, and a single feed can hold several courses, so the default alone is not
 * enough. Rows with nothing to choose from render nothing at all.
 */
export function CoursePicker({
  taskId,
  className,
}: {
  taskId: string;
  className?: string;
}) {
  const {
    locale,
    courses,
    courseIdForTask,
    setTaskCourse,
    followDefaultCourse,
  } = useCalendar();

  if (courses.length === 0) return null;

  const picked = courseIdForTask(taskId);
  const fallback = courses.find((course) => course.isDefault) ?? null;

  return (
    <select
      aria-label={t(locale, "course.rowLabel")}
      value={picked === null ? NO_COURSE : (picked ?? "")}
      onChange={(event) => {
        const value = event.target.value;
        if (value === "") followDefaultCourse(taskId);
        else if (value === NO_COURSE) setTaskCourse(taskId, null);
        else setTaskCourse(taskId, value);
      }}
      className={`h-8 max-w-[11rem] rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-2 text-[11px] font-semibold text-[var(--c-31506f)] outline-none transition focus:border-[var(--c-2a71d8)] focus:ring-4 focus:ring-[var(--c-2a71d8)]/10 ${className ?? ""}`}
    >
      <option value="">
        {fallback
          ? t(locale, "course.followDefaultWith", {
              code: fallback.code.trim(),
            })
          : t(locale, "course.followDefault")}
      </option>
      {courses.map((course) => (
        <option key={course.id} value={course.id}>
          {course.code.trim() || t(locale, "course.untitled")}
        </option>
      ))}
      <option value={NO_COURSE}>{t(locale, "course.none")}</option>
    </select>
  );
}
