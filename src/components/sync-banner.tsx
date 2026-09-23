"use client";

import { Check, X } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { describeSync } from "@/lib/sync";
import { t } from "@/lib/i18n";

/**
 * The incoming half of device sync.
 *
 * Rendered at the top of every route, because a sync link can be opened on any
 * of them. It states exactly what arrived and waits: nothing is written to this
 * device until the user says so.
 */
export function SyncBanner() {
  const { locale, pendingSync, applyPendingSync, dismissPendingSync } =
    useCalendar();

  if (!pendingSync) return null;

  const summary = describeSync(pendingSync);

  return (
    <div
      className="mt-6 overflow-hidden rounded-2xl border border-[#bcd4f2] bg-[#f4f8ff]"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold text-[#172b41]">
            {t(locale, "sync.incomingTitle")}
          </p>
          <p className="mt-1 text-sm text-[#31506f]">
            {t(locale, "sync.incomingBody", {
              calendars: summary.feeds,
              deadlines: summary.deadlines,
              completed: summary.completed,
              courses: summary.courses,
            })}
            {summary.announcements > 0
              ? ` ${t(locale, "sync.incomingAnnouncements", {
                  count: summary.announcements,
                })}.`
              : null}
          </p>
          {/* Only worth saying when there are some: a link from an older helper
              carries none, and a line about nothing is noise. */}
          {summary.announcements > 0 ? (
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {t(locale, "sync.incomingAnnouncementsNote")}
            </p>
          ) : null}
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            {t(locale, "sync.incomingNote")}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={applyPendingSync}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--blue)] px-3 text-sm font-semibold text-white transition hover:bg-[#1857aa]"
          >
            <Check size={15} />
            {t(locale, "sync.apply")}
          </button>
          <button
            type="button"
            onClick={dismissPendingSync}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#cdd9e6] bg-white px-3 text-sm font-semibold text-[#4e647b] transition hover:border-[#9fb7d1] hover:text-[#244e7a]"
          >
            <X size={15} />
            {t(locale, "sync.dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
