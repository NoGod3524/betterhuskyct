"use client";

import { useSyncExternalStore } from "react";
import { Download, ShieldCheck, Sparkles } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import {
  HELPER_SCRIPT_URL,
  HELPER_SOURCE_URL,
  MANAGER_FALLBACK,
  managerFor,
} from "@/lib/helper";
import { t } from "@/lib/i18n";

/** The user agent never changes, so there is nothing to subscribe to. */
const NEVER_CHANGES = () => () => {};

/**
 * How to get the browser helper.
 *
 * The whole point is that a newcomer does not have to find anything: two store
 * links and a sentence about what to do when they get there.
 *
 * The store link comes from the user agent, which the server cannot read — so
 * it renders the neutral fallback while the client renders the real one. That
 * is a client-only value with two snapshots, which is what `useSyncExternalStore`
 * is for; doing it with an effect and a `setState` is both a wasted paint and
 * something the hooks lint rule rejects. `getSnapshot` returns one of the
 * module's own constants, so its identity is stable and React does not loop.
 */
export function HelperSection() {
  const { locale } = useCalendar();
  const manager = useSyncExternalStore(
    NEVER_CHANGES,
    () => managerFor(navigator.userAgent),
    () => MANAGER_FALLBACK,
  );

  const steps = [
    {
      title: t(locale, "helper.step1Title"),
      body: t(locale, "helper.step1Body"),
      action: {
        href: manager.url,
        label: t(locale, "helper.step1Button", { store: manager.store }),
        primary: false,
      },
    },
    {
      title: t(locale, "helper.step2Title"),
      body: t(locale, "helper.step2Body"),
      action: {
        href: HELPER_SCRIPT_URL,
        label: t(locale, "helper.step2Button"),
        primary: true,
      },
    },
    {
      title: t(locale, "helper.step3Title"),
      body: t(locale, "helper.step3Body"),
      action: null,
    },
  ];

  const does = [
    t(locale, "helper.doesDeadlines"),
    t(locale, "helper.doesCourse"),
    t(locale, "helper.doesCalendar"),
  ];

  const willNot = [
    t(locale, "helper.privacyCredentials"),
    t(locale, "helper.privacyRequests"),
    t(locale, "helper.privacyUpload"),
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

      <ol className="mt-5 grid gap-3">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="rounded-[20px] border border-[var(--line)] bg-white p-5 shadow-[0_8px_30px_rgba(31,58,92,0.05)]"
          >
            <div className="flex flex-wrap items-start gap-4">
              <span
                aria-hidden="true"
                className="font-display flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#eaf2ff] text-sm font-semibold text-[#245ea9]"
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-base font-semibold text-[#172b41]">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{step.body}</p>
              </div>
              {step.action ? (
                <a
                  href={step.action.href}
                  className={
                    step.action.primary
                      ? "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--blue)] px-3 text-sm font-semibold text-white transition hover:bg-[#1857aa]"
                      : "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#cdd9e6] bg-white px-3 text-sm font-semibold text-[#244e7a] transition hover:border-[#9fb7d1]"
                  }
                >
                  <Download size={15} />
                  {step.action.label}
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <article className="rounded-[20px] border border-[var(--line)] bg-white p-5 shadow-[0_8px_30px_rgba(31,58,92,0.05)]">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            <Sparkles size={14} />
            {t(locale, "helper.whatItDoes")}
          </h3>
          <ul className="mt-3 grid gap-3 text-sm leading-6 text-[#31506f]">
            {does.map((line) => (
              <li key={line} className="border-l-2 border-[#dbe7f5] pl-3">
                {line}
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-[20px] border border-[var(--line)] bg-white p-5 shadow-[0_8px_30px_rgba(31,58,92,0.05)]">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            <ShieldCheck size={14} />
            {t(locale, "helper.privacyTitle")}
          </h3>
          <ul className="mt-3 grid gap-3 text-sm leading-6 text-[#31506f]">
            {willNot.map((line) => (
              <li key={line} className="border-l-2 border-[#dbe7f5] pl-3">
                {line}
              </li>
            ))}
          </ul>
          <a
            href={HELPER_SOURCE_URL}
            className="mt-4 inline-block text-xs font-semibold text-[#245ea9] underline underline-offset-2"
          >
            {t(locale, "helper.sourceLink")}
          </a>
        </article>
      </div>
    </section>
  );
}
