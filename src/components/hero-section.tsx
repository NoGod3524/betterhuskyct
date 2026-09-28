"use client";

import { Clock3 } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { t } from "@/lib/i18n";

/** The greeting block at the top of the overview route. */
export function HeroSection() {
  const { locale, formattedToday, visibleCount } = useCalendar();

  return (
    <div className="mt-8 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div>
        <p className="eyebrow" suppressHydrationWarning>{formattedToday}</p>
        <h1 className="font-display mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
          {t(locale, "hero.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base">
          {t(locale, "hero.description")}
        </p>
      </div>
      <div className="flex items-center gap-2 self-start rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-xs font-semibold text-[var(--muted)] shadow-sm xl:self-auto">
        <Clock3 size={15} className="text-[var(--c-2a71d8)]" />
        {t(locale, "hero.dueCount", { count: visibleCount })}
      </div>
    </div>
  );
}
