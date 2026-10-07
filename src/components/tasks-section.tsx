"use client";

import { Bell, Check, Download, RefreshCw } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { TaskCard } from "@/components/task-card";
import { t } from "@/lib/i18n";

/** Due-soon banner plus the Today / Tomorrow / This week task board. */
export function TasksSection() {
  const {
    now,
    locale,
    tasks,
    doneIds,
    doneLabelFor,
    toggleTaskCompletion,
    groups,
    dueSoon,
    exportTasks,
    isImported,
    restoreDemo,
    hasSavedImport,
    restoreSavedImport,
    clearSavedData,
  } = useCalendar();

  return (
    <>
      {dueSoon.length > 0 && (
        <div
          className="mt-6 flex items-start gap-2.5 rounded-lg bg-[var(--warning-soft)] px-3.5 py-2.5 text-sm text-[var(--warning)]"
          role="status"
        >
          <Bell size={16} className="mt-0.5 shrink-0" />
          <span>{t(locale, "reminders.banner", { count: dueSoon.length })}</span>
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-end justify-between gap-3" id="tasks">
        <div>
          <p className="eyebrow">{t(locale, "deadlineRadar.eyebrow")}</p>
          <h2 className="font-display mt-0.5 text-lg font-semibold">
            {t(locale, "deadlineRadar.heading")}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tasks.length > 0 && (
            <button
              type="button"
              onClick={exportTasks}
              className="btn btn-quiet h-7 px-2.5 text-xs"
            >
              <Download size={13} />{t(locale, "actions.exportCsv")}
            </button>
          )}
          {isImported && (
            <button
              type="button"
              onClick={restoreDemo}
              className="btn btn-quiet h-7 px-2.5 text-xs"
            >
              <RefreshCw size={13} />{t(locale, "actions.useDemo")}
            </button>
          )}
          {hasSavedImport && !isImported && (
            <button
              type="button"
              onClick={restoreSavedImport}
              className="btn btn-quiet h-7 px-2.5 text-xs"
            >
              {t(locale, "actions.restoreSavedImport")}
            </button>
          )}
          {hasSavedImport && (
            <button
              type="button"
              onClick={clearSavedData}
              className="btn btn-quiet h-7 px-2.5 text-xs"
            >
              {t(locale, "actions.clearSavedData")}
            </button>
          )}
          {!hasSavedImport && (
            <span className="rounded-md bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent-ink)]">
              {t(locale, "actions.demoPreview")}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-3 lg:gap-4">
        {groups.map((group) => (
          <section key={group.key} className="min-w-0">
            <div className="flex items-center justify-between px-1 pb-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`size-2 shrink-0 rounded-full ${group.accentClass}`} />
                <h3 className="text-sm font-semibold">{group.title}</h3>
                <span className="truncate text-xs text-[var(--muted)]">{group.dateLabel}</span>
              </div>
              <span className="shrink-0 rounded-md bg-[var(--subtle)] px-1.5 py-0.5 text-xs font-medium tabular-nums text-[var(--muted)]">
                {group.tasks.length}
              </span>
            </div>
            <div className="space-y-2">
              {group.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  group={group.key}
                  now={now}
                  completed={doneIds.has(task.id)}
                  doneLabel={doneLabelFor(task.id)}
                  onToggleComplete={toggleTaskCompletion}
                  locale={locale}
                />
              ))}
              {group.tasks.length === 0 && (
                <div className="grid min-h-[96px] place-items-center rounded-xl border border-dashed border-[var(--line-strong)] p-5 text-center">
                  <div>
                    <Check size={16} className="mx-auto text-[var(--success)]" />
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      {t(locale, "empty.nothingDue")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
