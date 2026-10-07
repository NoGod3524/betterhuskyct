"use client";

import { Clock3 } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { HelperSyncButton } from "@/components/helper-sync-button";
import { t } from "@/lib/i18n";

/** The greeting block at the top of the overview route. */
export function HeroSection() {
  const { locale, formattedToday, visibleCount } = useCalendar();

  return (
    <div className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="eyebrow" suppressHydrationWarning>{formattedToday}</p>
        <h1 className="font-display mt-1.5 text-2xl font-semibold sm:text-[28px] sm:leading-9">
          {t(locale, "hero.title")}
        </h1>
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-[var(--muted)]">
          <Clock3 size={14} className="shrink-0 text-[var(--blue)]" />
          {t(locale, "hero.dueCount", { count: visibleCount })}
        </p>
      </div>
      <HelperSyncButton variant="big" />
    </div>
  );
}
