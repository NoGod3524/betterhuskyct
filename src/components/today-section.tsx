"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Check, RefreshCw } from "lucide-react";

import { AiPlanBanner } from "@/components/ai-plan-panel";
import { useCalendar } from "@/components/calendar-provider";
import { ChangesSection } from "@/components/changes-section";
import { ListSkeleton } from "@/components/list-skeleton";
import { openSyncCenter } from "@/components/sync-center";
import { TaskCard } from "@/components/task-card";
import { dueLabel } from "@/components/todo-section";
import { t, type TranslationKey } from "@/lib/i18n";
import { buildTodo, type TodoSectionKey } from "@/lib/todo";

/** What is due soon enough to belong on the first page; the rest is on To-do. */
const DUE: ReadonlyArray<{ key: TodoSectionKey; title: TranslationKey; accent: string }> = [
  { key: "overdue", title: "todo.overdue", accent: "bg-[var(--c-e6533c)]" },
  { key: "today", title: "group.today", accent: "bg-[var(--c-e6533c)]" },
  { key: "tomorrow", title: "group.tomorrow", accent: "bg-[var(--c-e9a23b)]" },
  { key: "week", title: "todo.week", accent: "bg-[var(--blue)]" },
];

/** Before the first sync there is nothing of the student's to show: say how to get it. */
function FirstRun() {
  const { locale } = useCalendar();
  return (
    <div className="card mt-6 p-5">
      <p className="font-display text-base font-semibold">{t(locale, "today.firstTitle")}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[var(--muted)]">
        <li>{t(locale, "today.firstStep1")}</li>
        <li>{t(locale, "today.firstStep2")}</li>
        <li>{t(locale, "today.firstStep3")}</li>
      </ol>
      <button type="button" onClick={openSyncCenter} className="btn btn-primary mt-4">
        <RefreshCw size={15} aria-hidden />
        {t(locale, "today.firstCta")}
      </button>
      <p className="mt-3 text-xs text-[var(--muted)]">{t(locale, "today.demoNote")}</p>
    </div>
  );
}

/**
 * The first page: what changed since the student last looked, then what is due from overdue to the
 * end of the week, in one column. Everything else is a press away on To-do and Courses.
 */
export function TodaySection() {
  const { now, locale, calendarReady, formattedToday, tasks, doneIds, doneLabelFor, toggleTaskCompletion, hasSavedImport } = useCalendar();
  const todo = useMemo(() => buildTodo(tasks, doneIds, now), [tasks, doneIds, now]);
  const dueCount = DUE.reduce((sum, { key }) => sum + todo.open[key].length, 0);

  return (
    <>
      <div className="mt-6">
        <p className="eyebrow" suppressHydrationWarning>{formattedToday}</p>
        <h1 className="font-display mt-1 text-2xl font-semibold sm:text-[28px] sm:leading-9">{t(locale, "nav.today")}</h1>
        {calendarReady ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t(locale, "today.summary", { today: todo.open.today.length, overdue: todo.open.overdue.length, week: dueCount })}
          </p>
        ) : null}
      </div>

      {calendarReady && !hasSavedImport ? <FirstRun /> : null}

      <ChangesSection preview />
      <AiPlanBanner />

      <section className="mt-8" aria-labelledby="due-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="due-heading" className="text-base font-semibold">
            {t(locale, "today.dueTitle")}
            {calendarReady && !hasSavedImport ? (
              <span className="ml-2 rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--accent-ink)]">{t(locale, "actions.demoPreview")}</span>
            ) : null}
          </h2>
          <Link href="/tasks" className="tap-link text-sm font-semibold text-[var(--link)] hover:underline">{t(locale, "today.allTasks")}</Link>
        </div>

        {!calendarReady ? (
          <ListSkeleton label={t(locale, "common.loading")} />
        ) : dueCount === 0 ? (
          <div className="mt-3 flex items-center gap-2.5 rounded-lg bg-[var(--success-soft)] px-3.5 py-2.5 text-sm font-medium text-[var(--success)]" role="status">
            <Check size={17} aria-hidden />
            {t(locale, "today.nothingDue")}
          </div>
        ) : (
          <div className="mt-3 space-y-5">
            {DUE.map(({ key, title, accent }) =>
              todo.open[key].length === 0 ? null : (
                <div key={key}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`size-2 shrink-0 rounded-full ${accent}`} />
                    <h3 className="text-sm font-semibold">{t(locale, title)}</h3>
                    <span className="rounded-md bg-[var(--subtle)] px-1.5 py-0.5 text-xs font-medium tabular-nums text-[var(--muted)]">{todo.open[key].length}</span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {todo.open[key].map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        group="week"
                        now={now}
                        completed={false}
                        doneLabel={doneLabelFor(task.id)}
                        timeLabel={dueLabel(task, locale)}
                        overdue={key === "overdue"}
                        onToggleComplete={toggleTaskCompletion}
                        locale={locale}
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>
    </>
  );
}
