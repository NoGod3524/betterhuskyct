"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ListChecks } from "lucide-react";

import { useAiPlan } from "@/components/ai-plan-provider";
import { useCalendar } from "@/components/calendar-provider";
import { updateDecisions, useDecisions } from "@/components/use-announcement-state";
import { extractCandidates, isAddable, type ActionKind, type Candidate } from "@/lib/announcement-actions";
import { dayKey, type DayParts } from "@/lib/announcement-dates";
import { dismiss, markAdded, undismiss } from "@/lib/announcement-decisions";
import { draftFrom, todoFrom, type TodoDraft } from "@/lib/announcement-todo";
import type { Announcement } from "@/lib/announcements";
import { intlLocale, t, type Locale, type TranslationKey } from "@/lib/i18n";

const KIND_STYLE: Record<ActionKind, string> = {
  deadline: "bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  exam: "bg-[var(--warning-soft)] text-[var(--warning)]",
  quiz: "bg-[var(--warning-soft)] text-[var(--warning)]",
  "no-class": "bg-[var(--subtle)] text-[var(--muted)]",
  change: "bg-[var(--subtle)] text-[var(--ink)]",
  mention: "bg-[var(--subtle)] text-[var(--muted)]",
};

export function formatDay(day: DayParts, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(day.year, day.month - 1, day.day));
}

/** The sentence as written, with the date's words marked. */
function Evidence({ candidate }: { candidate: Candidate }) {
  const { sentence, match } = candidate;
  if (!match) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, match.start)}
      <mark className="rounded bg-[var(--warning-soft)] px-0.5 text-inherit">{sentence.slice(match.start, match.end)}</mark>
      {sentence.slice(match.end)}
    </>
  );
}

function CandidateRow({ announcement, candidate, locale, versionAt }: { announcement: Announcement; candidate: Candidate; locale: Locale; versionAt: string | null }) {
  const { addCustomEvent } = useCalendar();
  const plan = useAiPlan();
  const decisions = useDecisions();
  const [draft, setDraft] = useState<TodoDraft>(() => draftFrom(candidate));
  const [problem, setProblem] = useState<"title" | "date" | "time" | null>(null);
  const added = decisions.added[candidate.id];
  const addable = isAddable(candidate);

  function add() {
    const made = todoFrom(draft, announcement);
    if (made.kind === "invalid") {
      setProblem(made.problem);
      return;
    }
    let taskId: string;
    if (made.kind === "event") {
      taskId = addCustomEvent(made.input);
    } else if (plan) {
      taskId = plan.addUndated(made.todo);
    } else {
      return;
    }
    setProblem(null);
    updateDecisions((current) =>
      markAdded(current, candidate.id, {
        taskId,
        taskKind: made.kind,
        announcementId: announcement.id,
        sentence: candidate.sentence,
        day: made.kind === "event" ? draft.date : null,
        title: draft.title.trim(),
        addedAt: new Date().toISOString(),
        versionAt,
      }),
    );
  }

  const reasons = candidate.basis.map((code) => t(locale, `annBasis.${code}` as TranslationKey));

  return (
    <li className="grid gap-2 rounded-lg border border-[var(--line)] p-3" data-candidate={candidate.id}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-1.5 py-0.5 font-semibold ${KIND_STYLE[candidate.kind]}`}>{t(locale, `annKind.${candidate.kind}` as TranslationKey)}</span>
        {candidate.changed ? <span className="rounded bg-[var(--subtle)] px-1.5 py-0.5 font-medium">{t(locale, "ann.mentionsChange")}</span> : null}
        {candidate.check && !added ? <span className="rounded bg-[var(--warning-soft)] px-1.5 py-0.5 font-semibold text-[var(--warning)]">{t(locale, "ann.check")}</span> : null}
        <span className="text-[var(--muted)]">{t(locale, candidate.from === "title" ? "ann.fromTitle" : "ann.fromText")}</span>
      </div>

      <blockquote className="border-l-2 border-[var(--line-strong)] pl-3 text-sm leading-6">
        <Evidence candidate={candidate} />
      </blockquote>

      <p className="text-xs leading-5 text-[var(--muted)]">
        {candidate.keywords.length > 0 ? `${t(locale, "ann.matched", { words: candidate.keywords.join(", ") })} · ` : ""}
        {reasons.join(" ")}
      </p>

      {added ? (
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--success)]">
          <Check size={15} aria-hidden />
          {t(locale, "ann.added", { title: added.title })}
          <Link href="/tasks" className="text-xs font-semibold text-[var(--link)] hover:underline">
            {t(locale, "ann.openTodo")}
          </Link>
        </p>
      ) : !addable ? (
        <p className="text-xs text-[var(--muted)]">{t(locale, "ann.notAdded")}</p>
      ) : (
        <div className="grid gap-2">
          {candidate.options.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[var(--muted)]">{t(locale, "ann.pickDay")}</span>
              {candidate.options.map((option) => (
                <button
                  key={dayKey(option.date)}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, date: dayKey(option.date) }))}
                  aria-pressed={draft.date === dayKey(option.date)}
                  className="rounded-md border border-[var(--line)] px-2 py-1 font-medium hover:bg-[var(--subtle)] aria-pressed:border-[var(--blue)] aria-pressed:bg-[var(--accent-soft)]"
                >
                  {formatDay(option.date, locale)}
                  {option.note === "us" ? ` · ${t(locale, "ann.monthFirst")}` : option.note === "day-first" ? ` · ${t(locale, "ann.dayFirst")}` : ""}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-[10rem] flex-1 gap-1">
              <span className="text-xs text-[var(--muted)]">{t(locale, "ann.titleLabel")}</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                className="h-9 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 text-sm"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--muted)]">{t(locale, "ann.dateLabel")}</span>
              <input
                type="date"
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                className="h-9 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 text-sm"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--muted)]">{t(locale, "ann.timeLabel")}</span>
              <input
                type="time"
                value={draft.time}
                onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                className="h-9 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 text-sm"
              />
            </label>
          </div>
          {draft.date === "" ? <p className="text-xs text-[var(--muted)]">{t(locale, "ann.noDayHint")}</p> : null}
          {problem ? (
            <p role="alert" className="text-xs text-[var(--warning)]">
              {t(locale, `ann.err.${problem}` as TranslationKey)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={add} className="btn btn-primary h-8 px-3 text-xs">
              {t(locale, draft.date === "" ? "ann.addNoDay" : "ann.add")}
            </button>
            <button type="button" onClick={() => updateDecisions((current) => dismiss(current, candidate.id))} className="btn btn-quiet h-8 px-3 text-xs">
              {t(locale, "ann.dismiss")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * The to-dos the rules found in one announcement, each with the sentence it came from and why, for
 * the student to confirm, change or turn down. Nothing reaches the to-do list until they add it.
 */
export function CandidateList({ announcement, locale, versionAt }: { announcement: Announcement; locale: Locale; versionAt: string | null }) {
  const decisions = useDecisions();
  const [showDismissed, setShowDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const candidates = useMemo(() => extractCandidates(announcement), [announcement]);
  if (candidates.length === 0) return null;

  const open = candidates.filter((candidate) => !decisions.dismissed[candidate.id]);
  const dismissed = candidates.filter((candidate) => decisions.dismissed[candidate.id]);
  const pending = open.filter((candidate) => !decisions.added[candidate.id] && isAddable(candidate)).length;

  return (
    <section className="mt-3 grid gap-2 rounded-xl bg-[var(--subtle)] p-3" aria-label={t(locale, "ann.panelTitle", { count: open.length })}>
      <h4 className="text-sm font-semibold">
        <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="flex w-full items-center gap-2 text-left font-semibold">
          <ListChecks size={15} className="text-[var(--blue)]" aria-hidden />
          {t(locale, "ann.panelTitle", { count: open.length })}
          {pending > 0 ? <span className="rounded-full bg-[var(--warning-soft)] px-2 text-[11px] font-semibold text-[var(--warning)]">{t(locale, "ann.toConfirm", { count: pending })}</span> : null}
          <ChevronDown size={15} className={`ml-auto shrink-0 text-[var(--muted)] transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </h4>
      {expanded ? <p className="text-xs leading-5 text-[var(--muted)]">{t(locale, "ann.panelNote")}</p> : null}
      {expanded && open.length > 0 ? (
        <ul className="grid gap-2">
          {open.map((candidate) => (
            <CandidateRow key={candidate.id} announcement={announcement} candidate={candidate} locale={locale} versionAt={versionAt} />
          ))}
        </ul>
      ) : null}
      {expanded && dismissed.length > 0 ? (
        <div>
          <button type="button" onClick={() => setShowDismissed((value) => !value)} aria-expanded={showDismissed} className="text-xs font-medium text-[var(--link)] hover:underline">
            {t(locale, "ann.dismissedCount", { count: dismissed.length })}
          </button>
          {showDismissed ? (
            <ul className="mt-1 grid gap-1 text-xs text-[var(--muted)]">
              {dismissed.map((candidate) => (
                <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate">{candidate.sentence}</span>
                  <button type="button" onClick={() => updateDecisions((current) => undismiss(current, candidate.id))} className="font-medium text-[var(--link)] hover:underline">
                    {t(locale, "ann.restore")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
