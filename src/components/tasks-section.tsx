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
    completedIds,
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
          className="mt-6 flex items-start gap-2.5 rounded-2xl border border-[var(--c-f0d9a8)] bg-[var(--c-fffaf0)] px-4 py-3 text-sm text-[var(--c-8a5a12)]"
          role="status"
        >
          <Bell size={17} className="mt-0.5 shrink-0" />
          <span>{t(locale, "reminders.banner", { count: dueSoon.length })}</span>
        </div>
      )}

      <div className="mt-8 flex items-end justify-between gap-4" id="tasks">
        <div>
          <p className="eyebrow">{t(locale, "deadlineRadar.eyebrow")}</p>
          <h2 className="font-display mt-1 text-2xl font-semibold tracking-[-0.025em]">
            {t(locale, "deadlineRadar.heading")}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tasks.length > 0 && (
            <button
              type="button"
              onClick={exportTasks}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--c-4e647b)] transition hover:border-[var(--c-9fb7d1)] hover:text-[var(--c-244e7a)]"
            >
              <Download size={13} />{t(locale, "actions.exportCsv")}
            </button>
          )}
          {isImported && (
            <button
              type="button"
              onClick={restoreDemo}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--c-4e647b)] transition hover:border-[var(--c-9fb7d1)] hover:text-[var(--c-244e7a)]"
            >
              <RefreshCw size={13} />{t(locale, "actions.useDemo")}
            </button>
          )}
          {hasSavedImport && !isImported && (
            <button
              type="button"
              onClick={restoreSavedImport}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--c-4e647b)] transition hover:border-[var(--c-9fb7d1)] hover:text-[var(--c-244e7a)]"
            >
              {t(locale, "actions.restoreSavedImport")}
            </button>
          )}
          {hasSavedImport && (
            <button
              type="button"
              onClick={clearSavedData}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--c-4e647b)] transition hover:border-[var(--c-9fb7d1)] hover:text-[var(--c-244e7a)]"
            >
              {t(locale, "actions.clearSavedData")}
            </button>
          )}
          {!hasSavedImport && (
            <span className="rounded-full bg-[var(--c-eaf2ff)] px-3 py-1.5 text-xs font-semibold text-[var(--c-245ea9)]">
              {t(locale, "actions.demoPreview")}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {groups.map((group) => (
          <section
            key={group.key}
            className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_8px_30px_rgba(31,58,92,0.05)]"
          >
            <div className="flex items-center justify-between px-1 pb-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={`size-2.5 shrink-0 rounded-full ${group.accentClass}`} />
                <h3 className="font-display font-semibold">{group.title}</h3>
                <span className="truncate text-xs text-[var(--muted)]">{group.dateLabel}</span>
              </div>
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--c-f0f3f7)] text-xs font-bold text-[var(--c-536476)]">
                {group.tasks.length}
              </span>
            </div>
            <div className="space-y-3">
              {group.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  group={group.key}
                  now={now}
                  completed={completedIds.has(task.id)}
                  onToggleComplete={toggleTaskCompletion}
                  locale={locale}
                />
              ))}
              {group.tasks.length === 0 && (
                <div className="grid min-h-[132px] place-items-center rounded-2xl border border-dashed border-[var(--c-d7e1ec)] bg-[var(--c-fafcff)] p-5 text-center">
                  <div>
                    <Check size={18} className="mx-auto text-[var(--c-5ba97d)]" />
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
