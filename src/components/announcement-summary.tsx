"use client";

import { useState } from "react";

import type { Announcement } from "@/lib/announcements";
import {
  SummaryError,
  buildSummaryRequest,
  requestSummary,
  summarySignature,
  type SummaryProblem,
} from "@/lib/announcement-summary";
import { t, type Locale } from "@/lib/i18n";
import {
  SUMMARY_CHOICES,
  isSummaryChoice,
  restoreSummaryChoice,
  saveSummaryChoice,
  type SummaryChoice,
} from "@/lib/summary-choice";
import type { ProviderId } from "@/lib/summary-models";

type MadeSummary = {
  text: string;
  included: number;
  omitted: number;
  /** Which service wrote it; the credit line names it. */
  provider: ProviderId | null;
};

const CREDIT_KEYS = {
  glm: "summary.creditGlm",
  gemini: "summary.creditGemini",
  groq: "summary.creditGroq",
} as const;

/**
 * Summaries made this session, keyed by what they were made from. Moving
 * between courses — or back to one — shows the summary again without another
 * request, which matters on a free model that serves one request at a time.
 * Deliberately not persisted: a summary is derived and cheap to remake.
 */
const made = new Map<string, MadeSummary>();

export type SummaryCourse = {
  /** Shown on the button and above the summary. */
  label: string;
  /** Given to the model as the course's name; always English. */
  modelLabel: string;
};

/** Pending work and failures, tied to what they were for. A finished summary lives in `made`. */
type Status =
  | { kind: "idle" }
  | { kind: "working"; signature: string }
  | { kind: "error"; problem: SummaryProblem; signature: string };

const PROBLEM_KEYS = {
  busy: "summary.errorBusy",
  "rate-limited": "summary.errorRateLimited",
  refused: "summary.errorRefused",
  unavailable: "summary.errorUnavailable",
  region: "summary.errorRegion",
  "choice-unavailable": "summary.errorChoice",
  failed: "summary.errorFailed",
} as const;

const CHOICE_KEYS = {
  auto: "summary.choiceAuto",
  glm: "summary.choiceGlm",
  gemini: "summary.choiceGemini",
  groq: "summary.choiceGroq",
} as const;

/** What the choice means for where the text goes, said under the button. */
const CHOICE_NOTE_KEYS = {
  glm: "summary.choiceNoteGlm",
  gemini: "summary.choiceNoteGemini",
  groq: "summary.choiceNoteGroq",
} as const;

/**
 * The summary panel above a course's announcements.
 *
 * The line saying where the announcements go is always visible next to the
 * button, not tucked behind a first-time dialog: sending them off the device is
 * the one thing about this feature a reader has a right to know before pressing.
 *
 * Once a summary is made, the button goes: the same announcements summed up
 * again spend shared free quota for nothing new. It comes back when the
 * announcements change, or as "Try again" when a summary could not be made.
 */
export function AnnouncementSummary({
  locale,
  course,
  announcements,
}: {
  locale: Locale;
  course: SummaryCourse | null;
  announcements: Announcement[];
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Read once, where there is a browser; the panel is only drawn once a course
  // is picked, so the server's markup never contains it.
  const [choice, setChoice] = useState<SummaryChoice>(() =>
    typeof window === "undefined" ? "auto" : restoreSummaryChoice(window.localStorage),
  );

  if (!course) {
    return <p className="text-xs text-[var(--muted)]">{t(locale, "summary.pickCourse")}</p>;
  }

  const signature = `${course.modelLabel}\n${summarySignature(announcements, locale)}`;
  // Pending state for a different set of announcements, or a different
  // language, is not this panel's any more.
  const pending = status.kind !== "idle" && status.signature === signature ? status : null;
  const summary = made.get(signature);
  const working = pending?.kind === "working";

  async function summarize() {
    if (!course) return;
    const { request, omitted } = buildSummaryRequest(announcements, course.modelLabel, locale);
    setStatus({ kind: "working", signature });
    try {
      const { text, provider } = await requestSummary(request, undefined, choice);
      made.set(signature, { text, provider, included: request.announcements.length, omitted });
      setStatus({ kind: "idle" });
    } catch (error) {
      setStatus({
        kind: "error",
        problem: error instanceof SummaryError ? error.problem : "failed",
        signature,
      });
    }
  }

  return (
    <div className="card p-4 sm:p-5" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        {summary ? null : (
          <button
            type="button"
            onClick={summarize}
            disabled={working}
            className="btn btn-primary"
          >
            {pending?.kind === "error" ? t(locale, "summary.retry") : t(locale, "summary.button", { course: course.label })}
          </button>
        )}
        {working ? <span className="text-sm text-[var(--muted)]">{t(locale, "summary.working")}</span> : null}
        <label className="ml-auto flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
          {t(locale, "summary.modelLabel")}
          <select
            value={choice}
            onChange={(event) => {
              if (!isSummaryChoice(event.target.value)) return;
              setChoice(event.target.value);
              saveSummaryChoice(window.localStorage, event.target.value);
            }}
            className="h-8 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 text-xs font-medium text-[var(--ink)] outline-none transition focus:border-[var(--blue)] focus:ring-4 focus:ring-[var(--blue)]/10"
          >
            {SUMMARY_CHOICES.map((option) => (
              <option key={option} value={option}>
                {t(locale, CHOICE_KEYS[option])}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">{t(locale, "summary.disclosure")}</p>
      {choice !== "auto" ? (
        <p className="mt-1 text-xs font-medium text-[var(--ink)]">{t(locale, CHOICE_NOTE_KEYS[choice])}</p>
      ) : null}

      {pending?.kind === "error" ? (
        <p className="mt-3 text-sm text-[var(--danger)]">{t(locale, PROBLEM_KEYS[pending.problem])}</p>
      ) : null}

      {summary && !working ? (
        <div className="mt-4 border-t border-[var(--line)] pt-4">
          <h3 className="font-display text-base font-semibold">
            {t(locale, "summary.title", { course: course.label })}
          </h3>
          {/* The model's text, shown as text: never parsed as HTML. */}
          <p className="mt-2 whitespace-pre-line text-sm leading-6" data-summary>
            {summary.text}
          </p>
          <p className="mt-3 text-xs text-[var(--muted)]">
            {t(locale, "summary.basis", { count: summary.included })}
            {summary.omitted > 0 ? ` ${t(locale, "summary.omitted", { count: summary.omitted })}` : ""}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {t(locale, summary.provider ? CREDIT_KEYS[summary.provider] : "summary.creditOther")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
