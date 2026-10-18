"use client";

import { useMemo, useSyncExternalStore } from "react";

import { useCalendar } from "@/components/calendar-provider";
import { t, type Locale, type TranslationKey } from "@/lib/i18n";
import {
  agoUnit,
  COURSE_PARTS,
  missedParts,
  parseSyncStatus,
  SYNC_STATUS_CHANGED,
  SYNC_STATUS_KEY,
  type PartStatus,
  type SyncStatus,
} from "@/lib/sync-status";

function subscribe(onChange: () => void) {
  window.addEventListener(SYNC_STATUS_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SYNC_STATUS_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function snapshot(): string | null {
  try {
    return window.localStorage.getItem(SYNC_STATUS_KEY);
  } catch {
    return null;
  }
}

/** The stored status, kept current; null on the server and before any sync. */
function useSyncStatus(): SyncStatus | null {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  return useMemo(() => {
    try {
      return parseSyncStatus(JSON.parse(raw || "null"));
    } catch {
      return null;
    }
  }, [raw]);
}

function ago(locale: Locale, then: string, now: Date): string {
  const { unit, count } = agoUnit(then, now);
  return t(locale, `syncstatus.ago.${unit}` as TranslationKey, { count });
}

/** Keep course-by-course diagnostics available without a separate setup page. */
export function SyncStatusDetails() {
  const { locale, now } = useCalendar();
  const status = useSyncStatus();
  if (!status) return null;
  const when = ago(locale, status.lastSync, now);
  const missed = missedParts(status);
  const what = missed
    .slice(0, 4)
    .map((entry) => (entry.course ? `${entry.course} ${t(locale, `syncstatus.part.${entry.part}` as TranslationKey).toLowerCase()}` : t(locale, `syncstatus.part.${entry.part}` as TranslationKey)))
    .join(", ") + (missed.length > 4 ? " …" : "");
  return (
    <details id="sync-status" className="mt-3 text-xs text-[var(--muted)]">
      <summary className="tap-link cursor-pointer">
        {t(locale, missed.length ? "syncstatus.missed" : "syncstatus.allRead", { ago: when, what })}{" · "}
        <span className="text-[var(--link)]">{t(locale, "syncstatus.details")}</span>
      </summary>
      <SyncStatusTable />
    </details>
  );
}

function Part({ locale, label, part, now }: { locale: Locale; label: string; part: PartStatus; now: Date }) {
  const text = !part.missed && part.lastRead
    ? t(locale, "syncstatus.read", { ago: ago(locale, part.lastRead, now) })
    : part.lastRead
      ? t(locale, "syncstatus.notRead", { ago: ago(locale, part.lastRead, now) })
      : t(locale, "syncstatus.never");
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs " +
        (part.missed ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" : "border-[var(--line)] text-[var(--muted)]")
      }
    >
      <span className="font-medium text-[var(--ink)]">{label}</span>
      {text}
    </span>
  );
}

/** Each course's announcements, grades and files, and the term-wide parts. */
function SyncStatusTable() {
  const { locale, now } = useCalendar();
  const status = useSyncStatus();
  const label = (name: string) => t(locale, `syncstatus.part.${name}` as TranslationKey);

  return (
    <div className="mt-3">
      <h3 className="font-display text-lg font-semibold">{t(locale, "syncstatus.title")}</h3>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">{t(locale, status ? "syncstatus.intro" : "syncstatus.none")}</p>
      {status ? (
        <div className="card mt-4 divide-y divide-[var(--line)]">
          <div className="flex flex-wrap items-center gap-2 p-3.5">
            <span className="mr-1 text-sm font-semibold">{t(locale, "syncstatus.last", { ago: ago(locale, status.lastSync, now) })}</span>
            <Part locale={locale} label={label("dueDates")} part={status.dueDates} now={now} />
            <Part locale={locale} label={label("todo")} part={status.todo} now={now} />
          </div>
          {status.courses.map((course) => (
            <div key={course.id} className="flex flex-wrap items-center gap-2 p-3.5">
              <span className="mr-1 min-w-24 text-sm font-semibold">{course.code ?? course.id}</span>
              {COURSE_PARTS.map((name) => (
                <Part key={name} locale={locale} label={label(name)} part={course[name]} now={now} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
