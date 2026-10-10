"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";

import { AiPlanPanel } from "@/components/ai-plan-panel";
import { useAiPlan } from "@/components/ai-plan-provider";
import { useCalendar } from "@/components/calendar-provider";
import { ExamList } from "@/components/exam-list";
import { TaskOverview } from "@/components/task-overview";
import { useDecisions, useVersionStore } from "@/components/use-announcement-state";
import { TaskCard } from "@/components/task-card";
import { UndatedTodoList } from "@/components/undated-todo-list";
import { isDeadline, type CalendarTask } from "@/lib/calendar-types";
import { formatDate } from "@/lib/format-date";
import { dueTimestamp } from "@/lib/date-utils";
import { t, type Locale, type TranslationKey } from "@/lib/i18n";
import { linkNotices } from "@/lib/announcement-decisions";
import { buildTodo, completionOf, type TodoSectionKey } from "@/lib/todo";

const SECTIONS: ReadonlyArray<{ key: TodoSectionKey; title: TranslationKey; accent: string }> = [
  { key: "overdue", title: "todo.overdue", accent: "bg-[var(--c-e6533c)]" },
  { key: "today", title: "group.today", accent: "bg-[var(--c-e6533c)]" },
  { key: "tomorrow", title: "group.tomorrow", accent: "bg-[var(--c-e9a23b)]" },
  { key: "week", title: "todo.week", accent: "bg-[var(--blue)]" },
  { key: "later", title: "todo.later", accent: "bg-[var(--muted)]" },
];

/** "Fri, Oct 9, 11:59 PM", or without the time for a task that is due some time that day. */
function dueLabel(task: CalendarTask, locale: Locale): string {
  const due = dueTimestamp(task);
  if (due === null) return "";
  return formatDate(new Date(due), locale, { weekday: "short", time: !task.allDay });
}

/**
 * The to-do list: every deadline still to hand in, nearest first, what is
 * overdue on top, and what is done set apart.
 *
 * "Done" is mostly not the student's doing. A homework HuskyCT's gradebook says
 * is handed in or graded is ticked from the grades the helper brought, so the
 * list is a list of what is left rather than a chore of ticking boxes. A tick is
 * still there for the rest, and for reopening one the gradebook got wrong.
 */
export function TodoSection() {
  const { now, locale, tasks, doneIds, doneLabelFor, toggleTaskCompletion, courseLabelFor, courseColorFor, hasGrades, announcements } = useCalendar();
  const plan = useAiPlan();
  const versions = useVersionStore();
  const decisions = useDecisions();
  // To-dos made from an announcement that has changed since: the student is asked to look, nothing is changed.
  const stale = useMemo(
    () =>
      linkNotices(decisions, announcements, versions).filter((notice) =>
        notice.added.taskKind === "undated" ? plan?.undated.some((todo) => todo.id === notice.added.taskId) : tasks.some((task) => task.id === notice.added.taskId),
      ).length,
    [decisions, announcements, versions, plan?.undated, tasks],
  );
  const [pickedCourse, setCourse] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const codes = useMemo(() => {
    const found = new Set<string>();
    for (const task of tasks) {
      const code = isDeadline(task) ? courseLabelFor(task)?.code : null;
      if (code) found.add(code);
    }
    return [...found].sort();
  }, [tasks, courseLabelFor]);
  // A course that has gone from the data is no longer a filter.
  const course = pickedCourse && codes.includes(pickedCourse) ? pickedCourse : null;

  const shown = useMemo(
    () => (course ? tasks.filter((task) => courseLabelFor(task)?.code === course) : tasks),
    [tasks, course, courseLabelFor],
  );
  const todo = useMemo(() => buildTodo(shown, doneIds, now), [shown, doneIds, now]);
  const empty = todo.openCount === 0 && todo.done.length === 0;

  // The whole term, not the window above, and not narrowed by the course filter.
  const completion = useMemo(
    () => completionOf(tasks, doneIds, (task) => courseLabelFor(task)?.code ?? null),
    [tasks, doneIds, courseLabelFor],
  );
  const percent = completion.overall.total === 0 ? 0 : Math.round((completion.overall.completed / completion.overall.total) * 100);

  const card = (task: CalendarTask, overdue = false) => (
    <TaskCard
      key={task.id}
      task={task}
      group="week"
      now={now}
      completed={doneIds.has(task.id)}
      doneLabel={doneLabelFor(task.id)}
      timeLabel={dueLabel(task, locale)}
      overdue={overdue}
      onToggleComplete={toggleTaskCompletion}
      locale={locale}
    />
  );

  return (
    <section className="mt-10" aria-labelledby="todo-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t(locale, "todo.eyebrow")}</p>
          <h2 id="todo-heading" className="font-display mt-1 text-2xl font-semibold">
            {t(locale, "todo.heading")}
          </h2>
          <p className="mt-2 text-sm font-semibold text-[var(--ink)]">
            {t(locale, "todo.summary", { open: todo.openCount, done: todo.done.length })}
          </p>
        </div>
      </div>

      {stale > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-[var(--warning-soft)] px-3.5 py-2.5 text-sm text-[var(--warning)]" role="status">
          <span>{t(locale, "ann.stale", { count: stale })}</span>
          <Link href="/announcements?filter=changed" className="font-semibold underline">
            {t(locale, "ann.staleCta")}
          </Link>
        </div>
      ) : null}

      <ExamList />

      <TaskOverview renderTask={(task, overdue) => card(task, overdue)} />

      {completion.overall.total > 0 ? (
        <div className="mt-4 max-w-md">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="font-semibold text-[var(--ink)]">{t(locale, "todo.completion")}</span>
            <span className="text-[var(--muted)]">
              {t(locale, "todo.completedOf", { completed: completion.overall.completed, total: completion.overall.total })}
            </span>
          </div>
          <div
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--subtle)]"
            role="progressbar"
            aria-label={t(locale, "todo.completion")}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-[var(--success)]" style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : null}

      <p className="mt-2 max-w-2xl text-xs text-[var(--muted)]">
        {hasGrades ? t(locale, "todo.autoHint") : t(locale, "todo.noGradesHint")}{" "}
        {hasGrades ? null : (
          <Link href="/helper" className="font-semibold text-[var(--link)] hover:underline">
            {t(locale, "todo.noGradesCta")}
          </Link>
        )}
      </p>

      <AiPlanPanel />

      {codes.length > 1 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label={t(locale, "todo.filter")}>
          <FilterChip active={course === null} onClick={() => setCourse(null)}>
            {t(locale, "todo.allCourses")}
          </FilterChip>
          {codes.map((code) => (
            <FilterChip key={code} active={course === code} onClick={() => setCourse(code)}>
              {courseColorFor(code) ? (
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: courseColorFor(code)! }} aria-hidden />
              ) : null}
              {code}
              <span className="opacity-70">
                {completion.byCourse.get(code)?.completed ?? 0}/{completion.byCourse.get(code)?.total ?? 0}
              </span>
            </FilterChip>
          ))}
        </div>
      ) : null}

      {empty ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--line-strong)] p-6">
          <p className="text-sm font-semibold text-[var(--ink)]">{t(locale, course ? "todo.nothingInCourse" : "todo.emptyTitle")}</p>
          {course ? null : <p className="mt-1 text-sm text-[var(--muted)]">{t(locale, "todo.emptyBody")}</p>}
        </div>
      ) : (
        <div className="mt-4 space-y-6">
          {todo.openCount === 0 ? (
            <div className="flex items-center gap-2.5 rounded-lg bg-[var(--success-soft)] px-3.5 py-2.5 text-sm font-medium text-[var(--success)]" role="status">
              <Check size={17} aria-hidden />
              {t(locale, "todo.allDone")}
            </div>
          ) : null}

          {SECTIONS.map(({ key, title, accent }) =>
            todo.open[key].length === 0 ? null : (
              <div key={key}>
                <div className="mb-2.5 flex items-center gap-2">
                  <span className={`size-2 shrink-0 rounded-full ${accent}`} />
                  <h3 className="text-sm font-semibold">{t(locale, title)}</h3>
                  <span className="rounded-md bg-[var(--subtle)] px-1.5 py-0.5 text-xs font-medium tabular-nums text-[var(--muted)]">
                    {todo.open[key].length}
                  </span>
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{todo.open[key].map((task) => card(task, key === "overdue"))}</div>
              </div>
            ),
          )}

          {todo.done.length > 0 ? (
            <div>
              <button
                type="button"
                onClick={() => setShowDone((open) => !open)}
                aria-expanded={showDone}
                className="flex items-center gap-2 text-left text-sm font-semibold text-[var(--ink)] transition hover:opacity-80"
              >
                <ChevronRight
                  size={16}
                  className={`shrink-0 text-[var(--muted)] transition-transform ${showDone ? "rotate-90" : ""}`}
                  aria-hidden
                />
                {t(locale, "todo.done", { count: todo.done.length })}
              </button>
              {showDone ? (
                <div className="rise-in mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{todo.done.map((task) => card(task))}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-6 empty:hidden">
        <UndatedTodoList locale={locale} course={course} />
      </div>
    </section>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition ${
        active ? "bg-[var(--ink)] text-[var(--surface)]" : "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--subtle)]"
      }`}
    >
      {children}
    </button>
  );
}
