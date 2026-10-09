"use client";

import { useMemo } from "react";
import { GraduationCap } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { chipStyle } from "@/lib/course-colors";
import { intlLocale, t } from "@/lib/i18n";
import { upcomingExams } from "@/lib/exams";
import { useInBrowser } from "@/lib/use-in-browser";

/** The exams still ahead in the term, nearest first, with the days left. It goes by the title. */
export function ExamList() {
  const { now, locale, tasks, doneIds, courseLabelFor, courseColorFor } = useCalendar();
  const inBrowser = useInBrowser();
  const exams = useMemo(() => upcomingExams(tasks, doneIds, now), [tasks, doneIds, now]);
  if (exams.length === 0) return null;

  const dayFormat = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", month: "short", day: "numeric" });
  const daysText = (days: number) =>
    days === 0 ? t(locale, "exams.today") : days === 1 ? t(locale, "exams.tomorrow") : t(locale, "exams.inDays", { count: days });

  return (
    <section className="card mt-6 px-5 py-4" aria-labelledby="exams-heading">
      <h3 id="exams-heading" className="flex items-center gap-2 font-display text-base font-semibold">
        <GraduationCap size={16} className="text-[var(--blue)]" aria-hidden />
        {t(locale, "exams.heading")}
      </h3>
      <ul className="mt-2 divide-y divide-[var(--line)]">
        {exams.map(({ task, daysLeft }) => {
          const code = courseLabelFor(task)?.code ?? null;
          const color = code ? courseColorFor(code) : null;
          return (
            <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              {code ? (
                <span
                  className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--accent-ink)]"
                  style={color ? chipStyle(color) : undefined}
                >
                  {code}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
              <span className="shrink-0 tabular-nums text-[var(--muted)]">
                {inBrowser ? dayFormat.format(new Date(task.start)) : null}
              </span>
              <span className={`shrink-0 font-semibold tabular-nums ${daysLeft <= 7 ? "text-[var(--warning)]" : "text-[var(--ink)]"}`}>
                {inBrowser ? daysText(daysLeft) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-[var(--muted)]">{t(locale, "exams.note")}</p>
    </section>
  );
}
