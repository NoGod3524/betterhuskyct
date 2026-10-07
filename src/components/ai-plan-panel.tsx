"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Sparkles } from "lucide-react";

import { useAiPlan, type AiPlanValue } from "@/components/ai-plan-provider";
import { useCalendar } from "@/components/calendar-provider";
import { localDay, selectedByDefault, suggestionFlags, type Suggestion, type SuggestionFlags } from "@/lib/ai-plan";
import { intlLocale, t, type Locale, type TranslationKey } from "@/lib/i18n";

const BUTTON =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--accent-ink)] disabled:opacity-50";
const PRIMARY =
  "inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--navy)] px-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50";

type Row = { suggestion: Suggestion; flags: SuggestionFlags };

function dayLabel(day: string, time: string | null, locale: Locale): string {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = (time ?? "00:00").split(":").map(Number);
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(time ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(year, month - 1, date, hour, minute));
}

/**
 * The AI's finds, for the student to check before any of it reaches the
 * calendar: a tick, a date that can be changed, where it came from in the
 * source's own words, and a warning where something looks off.
 */
export function AiPlanPanel() {
  const plan = useAiPlan();
  return plan ? <Panel plan={plan} /> : null;
}

function Panel({ plan }: { plan: AiPlanValue }) {
  const { locale, tasks, now } = useCalendar();
  const { enabled, status, pending, enable, disable, checkNow, resolve } = plan;
  const today = localDay(new Date(now));

  const rows: Row[] = useMemo(
    () => pending.map((suggestion) => ({ suggestion, flags: suggestionFlags(suggestion, tasks, today) })),
    [pending, tasks, today],
  );
  // What the student changed; a row they have not touched follows its default.
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [days, setDays] = useState<Record<string, string>>({});
  const isPicked = (row: Row) => picked[row.suggestion.id] ?? selectedByDefault(row.flags);
  const dayOf = (row: Row) => days[row.suggestion.id] ?? row.suggestion.date ?? "";
  const pickedCount = rows.filter(isPicked).length;

  const byCourse = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const key = row.suggestion.course ?? "";
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [rows]);

  function addPicked() {
    const added = rows.filter(isPicked).map((row) => ({ id: row.suggestion.id, day: dayOf(row) || null }));
    const dismissed = rows.filter((row) => !isPicked(row)).map((row) => row.suggestion.id);
    resolve(added, dismissed);
    setPicked({});
    setDays({});
  }

  if (!enabled) {
    return (
      <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-2">
          <Sparkles size={17} className="text-[var(--blue)]" aria-hidden />
          <h3 className="font-display font-semibold">{t(locale, "aiPlan.offTitle")}</h3>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">{t(locale, "aiPlan.offBody")}</p>
        <button type="button" onClick={enable} className={`${PRIMARY} mt-4`}>
          {t(locale, "aiPlan.enable")}
        </button>
      </div>
    );
  }

  const statusText =
    status.phase === "reading"
      ? t(locale, status.what === "syllabus" ? "aiPlan.readingSyllabus" : "aiPlan.readingAnnouncements", { course: status.course })
      : status.problem
        ? t(locale, `aiPlan.problem.${status.problem}` as TranslationKey)
        : t(locale, "aiPlan.upToDate");

  return (
    <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5" aria-labelledby="ai-plan-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles size={17} className="text-[var(--blue)]" aria-hidden />
          <h3 id="ai-plan-heading" className="font-display font-semibold">
            {t(locale, "aiPlan.title")}
          </h3>
          {rows.length > 0 ? (
            <span className="rounded-full bg-[var(--subtle)] px-2 py-0.5 text-xs font-bold text-[var(--muted)]">
              {t(locale, "aiPlan.toCheck", { count: rows.length })}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={checkNow} disabled={status.phase === "reading"} className={BUTTON}>
            {t(locale, "aiPlan.checkNow")}
          </button>
          <button type="button" onClick={disable} className={BUTTON}>
            {t(locale, "aiPlan.disable")}
          </button>
        </div>
      </div>
      <p className="mt-2 text-sm text-[var(--muted)]" role="status">
        {statusText}
      </p>

      {rows.length > 0 ? (
        <>
          <p className="mt-3 text-xs text-[var(--muted)]">{t(locale, "aiPlan.hint")}</p>
          <div className="mt-3 space-y-4">
            {byCourse.map(([course, list]) => (
              <div key={course || "-"}>
                {course ? <h4 className="mb-2 text-sm font-semibold text-[var(--ink)]">{course}</h4> : null}
                <ul className="space-y-2">
                  {list.map((row) => {
                    const { suggestion, flags } = row;
                    const day = dayOf(row);
                    return (
                      <li
                        key={suggestion.id}
                        className="flex gap-3 rounded-xl border border-[var(--line)] bg-[var(--subtle)] p-3"
                        data-suggestion={suggestion.id}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 size-4 shrink-0"
                          checked={isPicked(row)}
                          onChange={(event) => setPicked((current) => ({ ...current, [suggestion.id]: event.target.checked }))}
                          aria-label={t(locale, "aiPlan.pick", { title: suggestion.title })}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{suggestion.title}</span>
                            <span className="rounded-full bg-[var(--subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">
                              {t(locale, `aiPlan.kind.${suggestion.kind}` as TranslationKey)}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                            <input
                              type="date"
                              value={day}
                              onChange={(event) => setDays((current) => ({ ...current, [suggestion.id]: event.target.value }))}
                              aria-label={t(locale, "aiPlan.dateFor", { title: suggestion.title })}
                              className="h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-sm"
                            />
                            <span className="text-[var(--muted)]">
                              {day ? dayLabel(day, day === suggestion.date ? suggestion.time : null, locale) : t(locale, "aiPlan.noDate")}
                            </span>
                          </div>
                          {flags.inCalendar || flags.past || (flags.weekday && day === suggestion.date) ? (
                            <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-[var(--danger)]">
                              <AlertTriangle size={13} aria-hidden />
                              {[
                                flags.inCalendar ? t(locale, "aiPlan.inCalendar") : null,
                                flags.past ? t(locale, "aiPlan.past") : null,
                                flags.weekday && day === suggestion.date ? t(locale, "aiPlan.weekday") : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {suggestion.from === "syllabus"
                              ? t(locale, "aiPlan.fromSyllabus", { name: suggestion.fromLabel })
                              : t(locale, "aiPlan.fromAnnouncement", { title: suggestion.fromLabel })}
                            {suggestion.evidence ? <span className="italic"> — “{suggestion.evidence}”</span> : null}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={addPicked} className={PRIMARY}>
              {t(locale, "aiPlan.add", { count: pickedCount })}
            </button>
            <button
              type="button"
              onClick={() => {
                resolve([], rows.map((row) => row.suggestion.id));
                setPicked({});
                setDays({});
              }}
              className={BUTTON}
            >
              {t(locale, "aiPlan.dismissAll")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** On the overview: a line saying there is something to check, and the way to it. */
export function AiPlanBanner() {
  const plan = useAiPlan();
  const { locale } = useCalendar();
  if (!plan?.enabled || plan.pending.length === 0) return null;
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--accent-soft)] px-3.5 py-2.5">
      <p className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
        <Sparkles size={15} className="text-[var(--accent-ink)]" aria-hidden />
        {t(locale, "aiPlan.banner", { count: plan.pending.length })}
      </p>
      <Link href="/tasks" className="text-sm font-medium text-[var(--accent-ink)] hover:underline">
        {t(locale, "aiPlan.bannerCta")}
      </Link>
    </div>
  );
}
