"use client";

import { useEffect, useState } from "react";

import type { Announcement } from "@/lib/announcements";
import {
  SummaryError,
  summarizeCourse,
  summarizerFrom,
  summaryAvailability,
  summarySignature,
  type CourseSummary,
  type SummaryAvailability,
  type SummaryProblem,
} from "@/lib/announcement-summary";
import { t, type Locale } from "@/lib/i18n";

/**
 * Summaries made this session, keyed by what they were made from, so moving
 * between courses does not redo the work. Deliberately not persisted: a summary
 * is derived, cheap to remake, and one more thing to store is one more thing to
 * go stale.
 */
const made = new Map<string, CourseSummary>();

export type SummaryCourse = {
  /** Shown on the button and above the summary. */
  label: string;
  /** Given to the model as context; always English, whatever the app shows. */
  modelLabel: string;
};

type Status =
  | { kind: "idle" }
  | { kind: "downloading"; fraction: number }
  | { kind: "working" }
  | { kind: "done"; summary: CourseSummary; signature: string }
  | { kind: "error"; problem: SummaryProblem };

const PROBLEM_KEYS = {
  unavailable: "summary.errorUnavailable",
  "too-long": "summary.errorTooLong",
  failed: "summary.errorFailed",
} as const;

/**
 * The summary panel above a course's announcements.
 *
 * On a device that cannot summarise, it says why in one line and offers no
 * button: a button that can only fail is worse than none.
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
  const [availability, setAvailability] = useState<SummaryAvailability | null>(null);
  const signature = course ? `${course.modelLabel}\n${summarySignature(announcements)}` : null;
  const [status, setStatus] = useState<Status>(() => {
    const cached = signature ? made.get(signature) : undefined;
    return cached && signature ? { kind: "done", summary: cached, signature } : { kind: "idle" };
  });

  useEffect(() => {
    let live = true;
    void summaryAvailability(summarizerFrom(globalThis)).then((result) => {
      if (live) setAvailability(result);
    });
    return () => {
      live = false;
    };
  }, []);

  // Asking the browser takes a moment; saying nothing until it answers avoids a
  // note that flickers into a button.
  if (availability === null) return null;

  if (availability === "unsupported" || availability === "unavailable") {
    return (
      <p className="mt-4 text-xs text-[var(--muted)]">
        {t(locale, availability === "unsupported" ? "summary.unsupported" : "summary.unavailable")}
      </p>
    );
  }

  if (!course || !signature) {
    return <p className="mt-4 text-xs text-[var(--muted)]">{t(locale, "summary.pickCourse")}</p>;
  }

  // A summary of a different set of announcements — the course gained one
  // since — is not shown as if it were current.
  const current = status.kind === "done" && status.signature !== signature ? { kind: "idle" as const } : status;
  const busy = current.kind === "downloading" || current.kind === "working";

  async function summarize() {
    const api = summarizerFrom(globalThis);
    if (!api || !course || !signature) return;

    setStatus(availability === "available" ? { kind: "working" } : { kind: "downloading", fraction: 0 });
    try {
      // Nothing is awaited before this call: a first-time model download is only
      // allowed in direct response to the click.
      const summary = await summarizeCourse(api, announcements, {
        courseLabel: course.modelLabel,
        onDownloadProgress: (fraction) =>
          setStatus(fraction >= 1 ? { kind: "working" } : { kind: "downloading", fraction }),
      });
      made.set(signature, summary);
      setAvailability("available");
      setStatus({ kind: "done", summary, signature });
    } catch (error) {
      setStatus({ kind: "error", problem: error instanceof SummaryError ? error.problem : "failed" });
    }
  }

  const language = t(locale, "summary.language");

  return (
    <div className="mt-4 rounded-[20px] border border-[#d7e1ec] bg-[#fafcff] p-5" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={summarize}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-lg bg-[var(--navy)] px-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {current.kind === "done"
            ? t(locale, "summary.again")
            : t(locale, "summary.button", { course: course.label })}
        </button>
        {current.kind === "downloading" ? (
          <span className="text-sm text-[#31506f]">
            {t(locale, "summary.downloading", { percent: Math.round(current.fraction * 100) })}
          </span>
        ) : null}
        {current.kind === "working" ? (
          <span className="text-sm text-[#31506f]">{t(locale, "summary.working")}</span>
        ) : null}
      </div>

      {current.kind === "idle" && availability !== "available" ? (
        <p className="mt-2 text-xs text-[var(--muted)]">{t(locale, "summary.downloadNote")}</p>
      ) : null}

      {current.kind === "error" ? (
        <p className="mt-3 text-sm text-[#b3412e]">{t(locale, PROBLEM_KEYS[current.problem])}</p>
      ) : null}

      {current.kind === "done" ? (
        <div className="mt-4">
          <h3 className="font-display text-base font-semibold text-[#172b41]">
            {t(locale, "summary.title", { course: course.label })}
          </h3>
          {/* Plain text from the model, shown as text: never parsed as HTML. */}
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#31506f]" data-summary>
            {current.summary.text}
          </p>
          <p className="mt-3 text-xs text-[var(--muted)]">
            {t(locale, "summary.basis", { count: current.summary.included })}
            {current.summary.omitted > 0
              ? ` ${t(locale, "summary.omitted", { count: current.summary.omitted })}`
              : ""}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {t(locale, "summary.privacy")}
            {language ? ` ${language}` : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}
