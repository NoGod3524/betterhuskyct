"use client";

import Link from "next/link";

import { useCalendar } from "@/components/calendar-provider";
import { t } from "@/lib/i18n";

const GITHUB = "https://github.com/NoGod3524/betterhuskyct";

/** What the project promises and what it does not, in the open, with where to check and whom to reach. */
export function AboutSection() {
  const { locale } = useCalendar();
  const promises = ["about.free", "about.open", "about.yours", "about.notracking"] as const;
  const nots = ["about.not1", "about.not2", "about.not3", "about.not4"] as const;
  const link = "font-medium text-[var(--blue)] underline-offset-2 hover:underline";

  return (
    <section className="mt-10 max-w-2xl" aria-labelledby="about-heading">
      <p className="eyebrow">{t(locale, "about.eyebrow")}</p>
      <h2 id="about-heading" className="font-display mt-1 text-2xl font-semibold tracking-[-0.025em]">
        {t(locale, "about.title")}
      </h2>
      <p className="mt-4 text-sm leading-6">{t(locale, "about.intro")}</p>

      <h3 className="font-display mt-6 text-base font-semibold">{t(locale, "about.promiseTitle")}</h3>
      <ul className="mt-2 grid gap-2 text-sm leading-6">
        {promises.map((key) => (
          <li key={key} className="border-l-2 border-[var(--blue)] pl-3">
            {t(locale, key)}
          </li>
        ))}
      </ul>

      <h3 className="font-display mt-6 text-base font-semibold">{t(locale, "about.notTitle")}</h3>
      <ul className="mt-2 grid gap-2 text-sm leading-6 text-[var(--muted)]">
        {nots.map((key) => (
          <li key={key} className="border-l-2 border-[var(--line)] pl-3">
            {t(locale, key)}
          </li>
        ))}
      </ul>

      <h3 className="font-display mt-6 text-base font-semibold">{t(locale, "about.costTitle")}</h3>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t(locale, "about.costBody")}</p>

      <h3 className="font-display mt-6 text-base font-semibold">{t(locale, "about.verifyTitle")}</h3>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
        {t(locale, "about.verifyBody")}{" "}
        <a href={`${GITHUB}/blob/main/tools/extension/VERIFY.md`} target="_blank" rel="noopener noreferrer" className={link}>
          {t(locale, "about.verifyLink")}
        </a>
      </p>

      <h3 className="font-display mt-6 text-base font-semibold">{t(locale, "about.whoTitle")}</h3>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t(locale, "about.whoBody")}</p>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a href={GITHUB} target="_blank" rel="noopener noreferrer" className={link}>
          {t(locale, "about.sourceLink")}
        </a>
        <a href={`${GITHUB}/issues`} target="_blank" rel="noopener noreferrer" className={link}>
          {t(locale, "about.issuesLink")}
        </a>
        <a href={`${GITHUB}/security/advisories/new`} target="_blank" rel="noopener noreferrer" className={link}>
          {t(locale, "about.securityLink")}
        </a>
        <Link href="/privacy" className={link}>
          {t(locale, "about.privacyLink")}
        </Link>
      </p>
    </section>
  );
}
