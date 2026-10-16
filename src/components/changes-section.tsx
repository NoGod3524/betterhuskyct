"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useCalendar } from "@/components/calendar-provider";
import { ListSkeleton } from "@/components/list-skeleton";
import { markChangesAsRead, useChanges } from "@/components/use-changes";
import { CHANGES_RETENTION_DAYS, MAX_CHANGES, type ChangeEntry } from "@/lib/changes";
import { intlLocale, t, type Locale, type TranslationKey } from "@/lib/i18n";

const KIND_LABELS: Record<ChangeEntry["kind"], TranslationKey> = {
  grade: "changes.kind.grade",
  "announcement-new": "changes.kind.announcement-new",
  "announcement-edited": "changes.kind.announcement-edited",
  "deadline-moved": "changes.kind.deadline-moved",
  "deadline-added": "changes.kind.deadline-added",
  "file-new": "changes.kind.file-new",
  "done-by-huskyct": "changes.kind.done-by-huskyct",
};

const PAGE_LABELS: Record<NonNullable<ChangeEntry["ref"]>["page"], TranslationKey> = {
  "/grades": "nav.grades",
  "/announcements": "nav.announcements",
  "/tasks": "nav.tasks",
  "/materials": "nav.materials",
  "/calendar": "nav.calendar",
};

function detailValue(value: string, kind: ChangeEntry["kind"], locale: Locale): string {
  if ((kind === "deadline-moved" || kind === "deadline-added") && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(new Date(year, month - 1, day));
  }
  if ((kind === "deadline-moved" || kind === "deadline-added") && Number.isFinite(Date.parse(value))) {
    return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }
  return value;
}

export function ChangesSection() {
  const { locale, courseColorFor } = useCalendar();
  const { store, ready, unavailable } = useChanges();
  const [saveFailed, setSaveFailed] = useState(false);
  const unread = store.entries.filter((entry) => !entry.read).length;
  const groups = useMemo(() => {
    const days = new Map<string, ChangeEntry[]>();
    for (const entry of [...store.entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
      const day = new Date(entry.at).toDateString();
      const entries = days.get(day) ?? [];
      entries.push(entry);
      days.set(day, entries);
    }
    return [...days.values()];
  }, [store]);
  const dayFormat = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "full" });
  const timeFormat = new Intl.DateTimeFormat(intlLocale(locale), { timeStyle: "short" });

  async function markRead(ids?: readonly string[]) {
    setSaveFailed(!(await markChangesAsRead(ids)));
  }

  return (
    <section className="mt-10" aria-labelledby="changes-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t(locale, "changes.eyebrow")}</p>
          <h1 id="changes-heading" className="font-display mt-1 text-2xl font-semibold">{t(locale, "changes.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">{t(locale, "changes.description")}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{t(locale, "changes.retention", { count: MAX_CHANGES, days: CHANGES_RETENTION_DAYS })}</p>
        </div>
        {ready && unread > 0 ? (
          <button type="button" onClick={() => markRead()} className="btn btn-quiet">{t(locale, "changes.markAllRead")}</button>
        ) : null}
      </div>

      {unavailable || saveFailed ? <p role="alert" className="mt-4 text-sm text-[var(--danger)]">{t(locale, unavailable ? "changes.unavailable" : "errors.saveFailed")}</p> : null}

      {!ready ? <ListSkeleton label={t(locale, "common.loading")} /> : store.entries.length === 0 && !unavailable ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--line-strong)] p-6">
          <p className="text-sm font-semibold">{t(locale, "changes.emptyTitle")}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{t(locale, "changes.emptyBody")}</p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map((entries) => (
            <section key={new Date(entries[0].at).toDateString()}>
              <h2 className="mb-2 text-sm font-semibold">{dayFormat.format(new Date(entries[0].at))}</h2>
              <ul className="card divide-y divide-[var(--line)] overflow-hidden">
                {entries.map((entry) => {
                  const color = entry.courseCode ? courseColorFor(entry.courseCode) : null;
                  return (
                    <li key={entry.id} className="flex gap-3 px-4 py-4 sm:px-5">
                      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${entry.read ? "bg-transparent" : "bg-[var(--blue)]"}`} role={entry.read ? undefined : "img"} aria-label={entry.read ? undefined : t(locale, "changes.unread")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                          {entry.courseCode ? (
                            <span className="inline-flex items-center gap-1.5 rounded bg-[var(--subtle)] px-1.5 py-0.5 font-semibold text-[var(--ink)]">
                              {color ? <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden /> : null}
                              {entry.courseCode}
                            </span>
                          ) : null}
                          <span>{t(locale, KIND_LABELS[entry.kind])}</span>
                          <time dateTime={entry.at} className="ml-auto tabular-nums">{timeFormat.format(new Date(entry.at))}</time>
                        </div>
                        <h3 className="mt-1.5 break-words text-[15px] font-semibold leading-6">{entry.title}</h3>
                        {entry.detail && (entry.detail.from || entry.detail.to) ? (
                          <p className="mt-1 break-words text-sm text-[var(--muted)]">
                            {entry.detail.from ? detailValue(entry.detail.from, entry.kind, locale) : null}
                            {entry.detail.from && entry.detail.to ? " → " : null}
                            {entry.detail.to ? detailValue(entry.detail.to, entry.kind, locale) : null}
                          </p>
                        ) : null}
                        {entry.detail?.text ? <p className="mt-1 whitespace-pre-line break-words text-sm text-[var(--muted)]">{entry.detail.text}</p> : null}
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--link)]">
                          {entry.ref ? <Link href={entry.ref.page} className="tap-link hover:underline">{t(locale, "changes.openPage", { page: t(locale, PAGE_LABELS[entry.ref.page]) })}</Link> : null}
                          {!entry.read ? <button type="button" onClick={() => markRead([entry.id])} aria-label={t(locale, "changes.markReadLabel", { title: entry.title })} className="tap-link hover:underline">{t(locale, "changes.markRead")}</button> : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
