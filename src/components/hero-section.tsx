"use client";

import { Clock3 } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { HelperSyncButton } from "@/components/helper-sync-button";
import { formatTaskTime, summarizeDays } from "@/lib/calendar-view";
import { t } from "@/lib/i18n";
import { useInBrowser } from "@/lib/use-in-browser";

/** The greeting block at the top of the overview route. */
export function HeroSection() {
  const { locale, formattedToday, groups, doneIds } = useCalendar();
  const inBrowser = useInBrowser();
  const summary = summarizeDays(groups, doneIds);
  const total = summary.today + summary.tomorrow + summary.later;

  return (
    <div className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="eyebrow" suppressHydrationWarning>{formattedToday}</p>
        <h1 className="font-display mt-1.5 text-2xl font-semibold sm:text-[28px] sm:leading-9">
          {t(locale, "hero.title")}
        </h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
          <Clock3 size={14} className="shrink-0 text-[var(--blue)]" />
          {total === 0 ? (
            t(locale, "hero.none")
          ) : (
            <>
              <span className={summary.today > 0 ? "font-semibold text-[var(--ink)]" : undefined}>{t(locale, "hero.today", { count: summary.today })}</span>
              <span>{t(locale, "hero.tomorrow", { count: summary.tomorrow })}</span>
              <span>{t(locale, "hero.later", { count: summary.later })}</span>
            </>
          )}
        </p>
        {summary.next && (
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t(locale, "hero.next", { title: summary.next.task.title })}
            {inBrowser ? " · " + formatTaskTime(summary.next.task, summary.next.group, locale) : null}
          </p>
        )}
      </div>
      <HelperSyncButton variant="big" />
    </div>
  );
}
