"use client";

import { useCalendar } from "@/components/calendar-provider";
import { openSyncCenter } from "@/components/sync-center";
import { t } from "@/lib/i18n";

/** Says the page is showing examples until the first sync, with the way to replace them. */
export function DemoNote() {
  const { locale } = useCalendar();
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--muted)]">
      <span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--accent-ink)]">{t(locale, "actions.demoPreview")}</span>
      {t(locale, "demo.sectionNote")}
      <button type="button" onClick={openSyncCenter} className="tap-link font-semibold text-[var(--link)] hover:underline">
        {t(locale, "demo.syncCta")}
      </button>
    </p>
  );
}
