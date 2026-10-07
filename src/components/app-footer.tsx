"use client";

import { useCalendar } from "@/components/calendar-provider";
import { t } from "@/lib/i18n";

/**
 * Version footer shown at the bottom of every route.
 *
 * The version is read from package.json at build time and passed down by the
 * layout, so there is a single source of truth for it.
 */
export function AppFooter({ version }: { version: string }) {
  const { locale } = useCalendar();

  return (
    <footer className="mt-12 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
      <span>
        <span className="font-medium text-[var(--ink)]">{t(locale, "app.name")}</span>
        {" · "}
        {t(locale, "footer.version", { version })}
        {" · "}
        {t(locale, "footer.disclaimer")}
      </span>
      <span>{t(locale, "footer.builtWith")}</span>
    </footer>
  );
}
