"use client";

import { useSyncExternalStore } from "react";
import { Clock3, MapPin } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { CoursePicker } from "@/components/course-picker";
import type { CalendarTask, TaskGroup } from "@/lib/calendar-types";
import { chipStyle } from "@/lib/course-colors";
import { formatTaskTime, isDueSoon } from "@/lib/calendar-view";
import { t, type Locale } from "@/lib/i18n";
import type { DoneLabel } from "@/lib/task-status";

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

/** False while the server renders and true in the browser; there is nothing to subscribe to. */
const NEVER_CHANGES = () => () => {};
const IN_BROWSER = () => true;
const ON_SERVER = () => false;

export function TaskCard({
  task,
  group,
  now,
  completed,
  doneLabel = null,
  timeLabel,
  overdue = false,
  onToggleComplete,
  locale,
}: {
  task: CalendarTask;
  group: TaskGroup["key"];
  now: Date;
  completed: boolean;
  /** Why it is done, when HuskyCT says so: the card names it. */
  doneLabel?: DoneLabel | null;
  /** Overrides the time line, for a list that spans more than a week. */
  timeLabel?: string;
  overdue?: boolean;
  onToggleComplete: (taskId: string) => void;
  locale: Locale;
}) {
  const { courseLabelFor, courseColorFor } = useCalendar();
  // A time is in the reader's zone, which the server does not know: it leaves the time out, so the
  // text the browser puts in is not a mismatch.
  const inBrowser = useSyncExternalStore(NEVER_CHANGES, IN_BROWSER, ON_SERVER);
  // Blackboard exports no course name on graded items. Rather than invent one,
  // fall back to the user's pick, then the feed, then the default course — and
  // show nothing when none of them applies.
  const course = courseLabelFor(task);
  const checkboxId = `task-complete-${task.id}`;
  const color = course ? courseColorFor(course.code) : null;

  return (
    <article
      className={`card group p-3.5 transition hover:border-[var(--line-strong)] ${completed ? "bg-[var(--canvas)] shadow-none" : ""}`}
      style={color && !completed ? { borderLeftColor: color, borderLeftWidth: 3 } : undefined}
    >
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
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--blue)]"
          />
        </label>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h4
              className={`min-w-0 break-words text-sm font-medium leading-5 ${completed ? "text-[var(--muted)] line-through" : "text-[var(--ink)]"}`}
            >
              <label htmlFor={checkboxId} className="cursor-pointer">{task.title}</label>
            </h4>
            {doneLabel === "submitted" || doneLabel === "graded" ? (
              <span
                className="shrink-0 rounded-md bg-[var(--success-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--success)]"
                title={t(locale, "task.doneByHuskyctHint")}
              >
                {t(locale, doneLabel === "graded" ? "badge.graded" : "badge.submitted")}
              </span>
            ) : overdue && !completed ? (
              <span className="shrink-0 rounded-md bg-[var(--danger-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--danger)]">
                {t(locale, "badge.overdue")}
              </span>
            ) : !completed && isDueSoon(task, now) ? (
              <span className="shrink-0 rounded-md bg-[var(--danger-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--danger)]">
                {t(locale, "badge.dueSoon")}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-[var(--muted)]">
            {course && (
              <span
                className={`max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                  courseColorFor(course.code) ? "" : styleForCourse(course.code)
                }`}
                style={courseColorFor(course.code) ? chipStyle(courseColorFor(course.code)!) : undefined}
                title={course.code}
                data-course-color={courseColorFor(course.code) ?? undefined}
              >
                {course.code}
                {course.component ? ` · ${course.component}` : ""}
              </span>
            )}
            {task.kind && <span>{t(locale, task.kind === "class" ? "kind.class" : "kind.assignment")}</span>}
            <span className="flex items-center gap-1 tabular-nums">
              <Clock3 size={12} />
              {inBrowser ? (timeLabel ?? formatTaskTime(task, group, locale)) : null}
            </span>
            {task.location && (
              <span className="flex max-w-full items-center gap-1 truncate" title={task.location}>
                <MapPin size={12} className="shrink-0" />
                <span className="truncate">{task.location}</span>
              </span>
            )}
          </div>
          <CoursePicker taskId={task.id} className="mt-2.5" />
        </div>
      </div>
    </article>
  );
}
