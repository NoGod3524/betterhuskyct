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
  failed: "summary.errorFailed",
} as const;

/**
 * The summary panel above a course's announcements.
 *
 * The line saying where the announcements go is always visible next to the
 * button, not tucked behind a first-time dialog: sending them off the device is
 * the one thing about this feature a reader has a right to know before pressing.
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

  if (!course) {
    return <p className="mt-4 text-xs text-[var(--muted)]">{t(locale, "summary.pickCourse")}</p>;
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
      const { text, provider } = await requestSummary(request);
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
    <div className="mt-4 rounded-[20px] border border-[#d7e1ec] bg-[#fafcff] p-5" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={summarize}
          disabled={working}
          className="inline-flex h-9 items-center rounded-lg bg-[var(--navy)] px-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {summary ? t(locale, "summary.again") : t(locale, "summary.button", { course: course.label })}
        </button>
        {working ? <span className="text-sm text-[#31506f]">{t(locale, "summary.working")}</span> : null}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">{t(locale, "summary.disclosure")}</p>

      {pending?.kind === "error" ? (
        <p className="mt-3 text-sm text-[#b3412e]">{t(locale, PROBLEM_KEYS[pending.problem])}</p>
      ) : null}

      {summary && !working ? (
        <div className="mt-4">
          <h3 className="font-display text-base font-semibold text-[#172b41]">
            {t(locale, "summary.title", { course: course.label })}
          </h3>
          {/* The model's text, shown as text: never parsed as HTML. */}
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#31506f]" data-summary>
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
