"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";

import { useAiPlan } from "@/components/ai-plan-provider";
import { t, type Locale } from "@/lib/i18n";

/**
 * A course's syllabus summed up, at the top of its files on the Materials page:
 * the grading, exams and policies a student would otherwise dig through the
 * PDF for. Written by the same read that finds the syllabus's dates.
 */
export function SyllabusSummaryCard({ courseId, locale }: { courseId: string; locale: Locale }) {
  const plan = useAiPlan();
  const summary = plan?.enabled ? plan.summaries[courseId] : undefined;
  if (!summary) return null;

  return (
    <section
      className="mt-4 rounded-2xl border border-[var(--c-cdddf4)] bg-[var(--c-eef4ff)] p-4"
      aria-label={t(locale, "materials.syllabusSummary")}
      data-syllabus-summary={courseId}
    >
      <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--c-31506f)]">
        <Sparkles size={15} className="text-[var(--c-2a71d8)]" aria-hidden />
        {t(locale, "materials.syllabusSummary")}
      </h4>
      <ul className="mt-2 space-y-1.5 text-sm text-[var(--c-172b41)]">
        {summary.text.split("\n").map((line, index) => (
          <li key={index} className="flex gap-2">
            <span aria-hidden className="text-[var(--c-6b7f94)]">
              •
            </span>
            <span>{line.replace(/^- /, "")}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-[var(--muted)]">{t(locale, "materials.syllabusFrom", { files: summary.files })}</p>
    </section>
  );
}

/**
 * Said once above the courses while the reading is off, so the summaries can
 * be found; nothing is read until it is turned on, on the to-do page.
 */
export function SyllabusSummaryHint({ locale }: { locale: Locale }) {
  const plan = useAiPlan();
  if (!plan || plan.enabled) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
      <Sparkles size={13} className="text-[var(--c-2a71d8)]" aria-hidden />
      {t(locale, "materials.syllabusHint")}{" "}
      <Link href="/tasks" className="font-semibold text-[var(--link)] hover:underline">
        {t(locale, "materials.syllabusHintCta")}
      </Link>
    </p>
  );
}
