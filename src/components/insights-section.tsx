"use client";

import { useMemo } from "react";

import { useCalendar } from "@/components/calendar-provider";
import { addDays, startOfLocalDay } from "@/lib/date-utils";
import { intlLocale, t } from "@/lib/i18n";

/** Workload analytics: completion rate, next 7 days, tasks per course, next 4 weeks. */
export function InsightsSection() {
  const {
    now,
    locale,
    insights,
    completionPercent,
    busiestDay,
    busiestWeek,
    busiestCourse,
  } = useCalendar();

  const weekdayFormat = useMemo(
    () => new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short" }),
    [locale],
  );

  function dayLabel(index: number) {
    if (index === 0) return t(locale, "group.today");
    if (index === 1) return t(locale, "group.tomorrow");
    return weekdayFormat.format(addDays(startOfLocalDay(now), index));
  }

  function barHeight(count: number, busiest: number) {
    if (count <= 0) return 0;
    // Keep any non-zero bar visible even when it is far below the maximum.
    return Math.max(8, Math.round((count / busiest) * 100));
  }

  return (
    <section className="mt-10" aria-labelledby="insights-heading" id="insights">
      <div>
        <p className="eyebrow">{t(locale, "insights.eyebrow")}</p>
        <h2
          id="insights-heading"
          className="font-display mt-1 text-2xl font-semibold tracking-[-0.025em]"
        >
          {t(locale, "insights.heading")}
        </h2>
      </div>

      {insights.total === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-[var(--c-d7e1ec)] bg-[var(--c-fafcff)] p-5 text-sm text-[var(--muted)]">
          {t(locale, "insights.empty")}
        </p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_8px_30px_rgba(31,58,92,0.05)]">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              {t(locale, "insights.completion")}
            </h3>
            <p className="font-display mt-3 text-3xl font-semibold text-[var(--c-172b41)]">
              {completionPercent}%
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {t(locale, "insights.completedOf", {
                completed: insights.completed,
                total: insights.total,
              })}
            </p>
            <div
              className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--c-eef2f7)]"
              role="progressbar"
              aria-label={t(locale, "insights.completion")}
              aria-valuenow={completionPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-[var(--c-2f8f5b)]"
                style={{ width: `${completionPercent}%` }}
              />
            </div>
          </article>

          <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_8px_30px_rgba(31,58,92,0.05)]">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              {t(locale, "insights.nextSevenDays")}
            </h3>
            <div className="mt-4 flex items-end gap-2">
              {insights.nextSevenDays.map((count, index) => (
                <div
                  key={index}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <span className="text-xs font-semibold text-[var(--c-31506f)]">
                    {count}
                  </span>
                  <div className="flex h-24 w-full items-end rounded-md bg-[var(--c-f0f3f7)]">
                    <div
                      className="w-full rounded-md bg-[var(--c-2a71d8)]"
                      style={{ height: `${barHeight(count, busiestDay)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-[var(--muted)]">
                    {dayLabel(index)}
                  </span>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_8px_30px_rgba(31,58,92,0.05)]">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              {t(locale, "insights.byCourse")}
            </h3>
            <ul className="mt-4 space-y-3">
              {insights.byCourse.map((row) => (
                <li key={row.course ?? "__uncategorized"}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-semibold text-[var(--c-31506f)]">
                      {row.course ?? t(locale, "insights.uncategorized")}
                    </span>
                    <span className="shrink-0 text-[var(--muted)]">
                      {row.completed}/{row.total}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--c-eef2f7)]">
                    <div
                      className="h-full rounded-full bg-[var(--c-2a71d8)]"
                      style={{
                        width: `${barHeight(row.total, busiestCourse)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_8px_30px_rgba(31,58,92,0.05)]">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              {t(locale, "insights.byWeek")}
            </h3>
            <div className="mt-4 flex items-end gap-3">
              {insights.byWeek.map((count, index) => (
                <div
                  key={index}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <span className="text-xs font-semibold text-[var(--c-31506f)]">
                    {count}
                  </span>
                  <div className="flex h-24 w-full items-end rounded-md bg-[var(--c-f0f3f7)]">
                    <div
                      className="w-full rounded-md bg-[var(--c-e9a23b)]"
                      style={{ height: `${barHeight(count, busiestWeek)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-[var(--muted)]">
                    {t(locale, "insights.week", { index: index + 1 })}
                  </span>
                </div>
              ))}
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
