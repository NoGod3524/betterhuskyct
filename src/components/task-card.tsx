"use client";

import { Clock3, MapPin } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { CoursePicker } from "@/components/course-picker";
import type { CalendarTask, TaskGroup } from "@/lib/calendar-types";
import { formatTaskTime, isDueSoon } from "@/lib/calendar-view";
import { t, type Locale } from "@/lib/i18n";

const courseStyles = [
  "bg-[var(--c-dbe8ff)] text-[var(--c-1851a5)]",
  "bg-[var(--c-e0f0e8)] text-[var(--c-23724b)]",
  "bg-[var(--c-f2e4fa)] text-[var(--c-7c3e9d)]",
  "bg-[var(--c-fff0d9)] text-[var(--c-9b5a05)]",
  "bg-[var(--c-ffe4e1)] text-[var(--c-a34235)]",
];

function styleForCourse(course: string) {
  const hash = Array.from(course).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  return courseStyles[hash % courseStyles.length];
}

export function TaskCard({
  task,
  group,
  now,
  completed,
  onToggleComplete,
  locale,
}: {
  task: CalendarTask;
  group: TaskGroup["key"];
  now: Date;
  completed: boolean;
  onToggleComplete: (taskId: string) => void;
  locale: Locale;
}) {
  const { courseLabelFor } = useCalendar();
  // Blackboard exports no course name on graded items. Rather than invent one,
  // fall back to the user's pick, then the feed, then the default course — and
  // show nothing when none of them applies.
  const course = courseLabelFor(task);
  const checkboxId = `task-complete-${task.id}`;

  return (
    <article className="group rounded-2xl border border-[var(--line)] bg-[var(--c-fcfdff)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--c-bfd3f0)] hover:shadow-[0_8px_22px_rgba(37,74,119,0.08)]">
      <div className="flex items-start gap-3">
        <label htmlFor={checkboxId} className="tap-check shrink-0">
          <input
            id={checkboxId}
            type="checkbox"
            checked={completed}
            onChange={() => onToggleComplete(task.id)}
            aria-label={t(locale, completed ? "task.markIncomplete" : "task.markComplete", {
              title: task.title,
            })}
            className="mt-1 size-4 shrink-0 cursor-pointer accent-[var(--c-2a71d8)]"
          />
        </label>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {course && (
                <span
                  className={`max-w-full truncate rounded-md px-2 py-1 text-[10px] font-bold tracking-[0.06em] ${styleForCourse(course.code)}`}
                  title={course.code}
                >
                  {course.code}
                  {course.component ? ` · ${course.component}` : ""}
                </span>
              )}
              {task.kind && (
                <span className="shrink-0 rounded-md bg-[var(--c-f0f3f7)] px-2 py-1 text-[10px] font-bold tracking-[0.06em] text-[var(--c-536476)]">
                  {t(locale, task.kind === "class" ? "kind.class" : "kind.assignment")}
                </span>
              )}
            </div>
            {isDueSoon(task, now) && (
              <span className="shrink-0 rounded-full bg-[var(--c-fff0ed)] px-2 py-1 text-[10px] font-bold text-[var(--c-c5402d)]">
                {t(locale, "badge.dueSoon")}
              </span>
            )}
          </div>
          <h4
            className={`mt-3 min-h-10 break-words text-sm font-semibold leading-5 ${completed ? "text-[var(--muted)] line-through" : "text-[var(--c-172b41)]"}`}
          >
            <label htmlFor={checkboxId}>{task.title}</label>
          </h4>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-[var(--muted)]">
            <span className="flex items-center gap-1.5">
              <Clock3 size={13} />
              {formatTaskTime(task, group, locale)}
            </span>
            {task.location && (
              <span className="flex max-w-full items-center gap-1.5 truncate" title={task.location}>
                <MapPin size={13} className="shrink-0" />
                <span className="truncate">{task.location}</span>
              </span>
            )}
          </div>
          <CoursePicker taskId={task.id} className="mt-3" />
        </div>
      </div>
    </article>
  );
}
