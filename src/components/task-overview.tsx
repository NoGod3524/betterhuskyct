"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

import { useAiPlan } from "@/components/ai-plan-provider";
import { useCalendar } from "@/components/calendar-provider";
import type { CalendarTask } from "@/lib/calendar-types";
import { dateFormatter } from "@/lib/format-date";
import { intlLocale, t } from "@/lib/i18n";
import { buildOverview, type Entry } from "@/lib/task-overview";
import { useInBrowser } from "@/lib/use-in-browser";

type Focus = { kind: "next7" | "overdue" | "undated" } | { kind: "day"; day: string } | { kind: "course"; course: string | null };

function sameFocus(left: Focus | null, right: Focus): boolean {
  if (left === null || left.kind !== right.kind) return false;
  if (left.kind === "day" && right.kind === "day") return left.day === right.day;
  if (left.kind === "course" && right.kind === "course") return left.course === right.course;
  return true;
}

function entriesFor(focus: Focus, overview: ReturnType<typeof buildOverview>): Entry[] {
  switch (focus.kind) {
    case "next7":
      return overview.next7;
    case "overdue":
      return overview.overdue;
    case "undated":
      return overview.undated;
    case "day":
      return overview.byDay.find((entry) => entry.day === focus.day)?.entries ?? [];
    case "course":
      return overview.byCourse.find((entry) => entry.course === focus.course)?.entries ?? [];
  }
}

/**
 * How many things are open, as plain counts: in the next seven days, overdue, with no day; by day
 * and by course. Each number opens the items it counts. It says what is counted and what is not.
 */
export function TaskOverview({ renderTask }: { renderTask: (task: CalendarTask, overdue: boolean) => ReactNode }) {
  const { now, locale, tasks, doneIds, courseLabelFor } = useCalendar();
  const plan = useAiPlan();
  const inBrowser = useInBrowser();
  const [focus, setFocus] = useState<Focus | null>(null);

  const overview = useMemo(
    () => buildOverview(tasks, doneIds, plan?.undated ?? [], now, (task) => courseLabelFor(task)?.code ?? null),
    [tasks, doneIds, plan?.undated, now, courseLabelFor],
  );
  if (!inBrowser) return null;

  const total = overview.next7.length + overview.overdue.length + overview.undated.length;
  const dayName = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short" });
  const dayLong = dateFormatter(locale, { weekday: "long" });

  const entries = focus === null ? [] : entriesFor(focus, overview);

  const pick = (next: Focus) => setFocus((current) => (sameFocus(current, next) ? null : next));

  const tile = (next: Focus, count: number, label: string, warn = false) => (
    <button
      type="button"
      onClick={() => pick(next)}
      aria-pressed={sameFocus(focus, next)}
      disabled={count === 0}
      className="grid min-w-[7.5rem] flex-1 gap-0.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-left transition enabled:hover:bg-[var(--subtle)] disabled:opacity-60 aria-pressed:border-[var(--blue)] aria-pressed:bg-[var(--accent-soft)]"
    >
      <span className={`text-2xl font-semibold tabular-nums ${warn && count > 0 ? "text-[var(--warning)]" : ""}`}>{count}</span>
      <span className="text-xs text-[var(--muted)]">{label}</span>
    </button>
  );

  return (
    <section className="card mt-6 px-5 py-4" aria-labelledby="overview-heading">
      <h3 id="overview-heading" className="font-display text-base font-semibold">
        {t(locale, "overview.heading")}
      </h3>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t(locale, "overview.scope")}</p>

      {total === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">{t(locale, "overview.empty")}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {tile({ kind: "next7" }, overview.next7.length, t(locale, "overview.next7"))}
            {tile({ kind: "overdue" }, overview.overdue.length, t(locale, "overview.overdue"), true)}
            {tile({ kind: "undated" }, overview.undated.length, t(locale, "overview.undated"))}
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t(locale, "overview.byDay")}</p>
            <div className="mt-1.5 grid grid-cols-7 gap-1.5">
              {overview.byDay.map((entry) => {
                const [year, month, day] = entry.day.split("-").map(Number);
                const date = new Date(year, month - 1, day);
                const next: Focus = { kind: "day", day: entry.day };
                return (
                  <button
                    key={entry.day}
                    type="button"
                    onClick={() => pick(next)}
                    aria-pressed={sameFocus(focus, next)}
                    aria-label={`${dayLong.format(date)}: ${t(locale, "overview.items", { count: entry.entries.length })}`}
                    disabled={entry.entries.length === 0}
                    className="grid place-items-center rounded-lg border border-[var(--line)] py-1.5 text-center transition enabled:hover:bg-[var(--subtle)] disabled:opacity-50 aria-pressed:border-[var(--blue)] aria-pressed:bg-[var(--accent-soft)]"
                  >
                    <span className="text-[11px] text-[var(--muted)]">{dayName.format(date)}</span>
                    <span className="text-xs text-[var(--muted)]">{day}</span>
                    <span className="text-base font-semibold tabular-nums">{entry.entries.length}</span>
                  </button>
                );
              })}
            </div>
            {overview.byDay.some((entry) => entry.entries.length > 1) ? <p className="mt-1.5 text-xs text-[var(--muted)]">{t(locale, "overview.sameDay")}</p> : null}
          </div>

          {overview.byCourse.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t(locale, "overview.byCourse")}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {overview.byCourse.map((entry) => {
                  const next: Focus = { kind: "course", course: entry.course };
                  return (
                    <button
                      key={entry.course ?? "__none"}
                      type="button"
                      onClick={() => pick(next)}
                      aria-pressed={sameFocus(focus, next)}
                      className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--subtle)] aria-pressed:border-[var(--blue)] aria-pressed:bg-[var(--accent-soft)]"
                    >
                      {entry.course ?? t(locale, "overview.noCourse")} · {entry.entries.length}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {focus !== null ? (
            <div className="rise-in mt-4 grid gap-2" role="region" aria-label={t(locale, "overview.listHeading")}>
              <p className="text-sm font-semibold">{t(locale, "overview.listHeading")}</p>
              {entries.map((entry) =>
                entry.task ? (
                  <div key={entry.id}>{renderTask(entry.task, focus.kind === "overdue")}</div>
                ) : (
                  <div key={entry.id} className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 text-sm">
                    <button
                      type="button"
                      onClick={() => entry.undatedId && plan?.toggleUndated(entry.undatedId)}
                      aria-label={t(locale, "todo.undatedMark", { title: entry.title })}
                      className="grid size-6 shrink-0 place-items-center rounded-md border border-[var(--line)] bg-[var(--surface)]"
                    >
                      <Check size={14} className="opacity-0" aria-hidden />
                    </button>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{entry.title}</span>
                      {entry.course ? <span className="block text-xs text-[var(--muted)]">{entry.course}</span> : null}
                    </span>
                  </div>
                ),
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
