"use client";

import { Download, ShieldCheck, Sparkles } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { HELPER_SOURCE_URL } from "@/lib/helper";
import { t } from "@/lib/i18n";

/** How to get the browser helper: the extension, added by hand once, then three steps. */
export function HelperSection() {
  const { locale } = useCalendar();

  const ownExtSteps = [
    t(locale, "helper.ownExtStep1"),
    t(locale, "helper.ownExtStep2"),
    t(locale, "helper.ownExtStep3"),
  ];

  const steps = [
    { title: t(locale, "helper.step4Title"), body: t(locale, "helper.step4Body") },
    { title: t(locale, "helper.step5Title"), body: t(locale, "helper.step5Body") },
    { title: t(locale, "helper.step6Title"), body: t(locale, "helper.step6Body") },
  ];

  const does = [
    t(locale, "helper.doesDeadlines"),
    t(locale, "helper.doesCourse"),
    t(locale, "helper.doesGrades"),
  ];

  const willNot = [
    t(locale, "helper.privacyCredentials"),
    t(locale, "helper.privacyRequests"),
    t(locale, "helper.privacyUpload"),
    t(locale, "helper.privacyBridge"),
  ];

  return (
    <section className="mt-10" aria-labelledby="helper-heading" id="helper">
      <div>
        <p className="eyebrow">{t(locale, "helper.eyebrow")}</p>
        <h2
          id="helper-heading"
          className="font-display mt-1 text-2xl font-semibold tracking-[-0.025em]"
        >
          {t(locale, "helper.heading")}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          {t(locale, "helper.description")}
        </p>
      </div>

      <article className="card mt-6 p-5">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <Download size={16} className="text-[var(--blue)]" aria-hidden />
          {t(locale, "helper.ownExtTitle")}
        </h3>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t(locale, "helper.ownExtLead")}</p>
        <ol className="mt-3 grid gap-2 text-sm leading-6">
          {ownExtSteps.map((line, index) => (
            <li key={line} className="flex gap-3">
              <span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent-ink)]">
                {index + 1}
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
        <a href="/betterhuskyct-extension.zip" download className="btn btn-primary mt-4 w-fit">
          <Download size={15} aria-hidden />
          {t(locale, "helper.ownExtButton")}
        </a>
      </article>

      <ol className="mt-5 grid gap-3">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_8px_30px_rgba(31,58,92,0.05)]"
          >
            <div className="flex flex-wrap items-start gap-4">
              <span
                aria-hidden="true"
                className="font-display flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent-ink)]"
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-base font-semibold text-[var(--ink)]">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{step.body}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_8px_30px_rgba(31,58,92,0.05)]">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            <Sparkles size={14} />
            {t(locale, "helper.whatItDoes")}
          </h3>
          <ul className="mt-3 grid gap-3 text-sm leading-6 text-[var(--ink)]">
            {does.map((line) => (
              <li key={line} className="border-l-2 border-[var(--line)] pl-3">
                {line}
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_8px_30px_rgba(31,58,92,0.05)]">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            <ShieldCheck size={14} />
            {t(locale, "helper.privacyTitle")}
          </h3>
          <ul className="mt-3 grid gap-3 text-sm leading-6 text-[var(--ink)]">
            {willNot.map((line) => (
              <li key={line} className="border-l-2 border-[var(--line)] pl-3">
                {line}
              </li>
            ))}
          </ul>
          <a
            href={HELPER_SOURCE_URL}
            className="tap-link mt-4 inline-block text-xs font-semibold text-[var(--accent-ink)] underline underline-offset-2"
          >
            {t(locale, "helper.sourceLink")}
          </a>
        </article>
      </div>
    </section>
  );
}
