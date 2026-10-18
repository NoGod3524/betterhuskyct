"use client";

import Link from "next/link";

import { useCalendar } from "@/components/calendar-provider";
import { t } from "@/lib/i18n";

const GITHUB = "https://github.com/NoGod3524/betterhuskyct";

/** The privacy policy of the helper, in the open, for the stores' listings to point at. */
export function PrivacySection() {
  const { locale } = useCalendar();
  const never = ["privacy.never1", "privacy.never2", "privacy.never3"] as const;
  const perms = ["privacy.perm1", "privacy.perm2", "privacy.perm3", "privacy.perm4", "privacy.perm5"] as const;

  return (
    <section className="mt-10 max-w-2xl" aria-labelledby="privacy-heading">
      <p className="eyebrow">{t(locale, "privacy.eyebrow")}</p>
      <h2 id="privacy-heading" className="font-display mt-1 text-2xl font-semibold tracking-[-0.025em]">
        {t(locale, "privacy.title")}
      </h2>
      <p className="mt-1 text-xs text-[var(--muted)]">{t(locale, "privacy.updated")}</p>
      <p className="mt-4 text-sm leading-6">{t(locale, "privacy.intro")}</p>

      <h3 className="font-display mt-6 text-base font-semibold">{t(locale, "privacy.readsTitle")}</h3>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t(locale, "privacy.readsBody")}</p>

      <h3 className="font-display mt-6 text-base font-semibold">{t(locale, "privacy.neverTitle")}</h3>
      <ul className="mt-1 grid gap-2 text-sm leading-6 text-[var(--muted)]">
        {never.map((key) => (
          <li key={key} className="border-l-2 border-[var(--line)] pl-3">
            {t(locale, key)}
          </li>
        ))}
      </ul>

      <h3 className="font-display mt-6 text-base font-semibold">{t(locale, "privacy.goesTitle")}</h3>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t(locale, "privacy.goesBody")}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t(locale, "privacy.siteBody")}</p>

      <h3 className="font-display mt-6 text-base font-semibold">{t(locale, "privacy.permsTitle")}</h3>
      <ul className="mt-1 grid gap-2 text-sm leading-6 text-[var(--muted)]">
        {perms.map((key) => (
          <li key={key} className="border-l-2 border-[var(--line)] pl-3">
            {t(locale, key)}
          </li>
        ))}
      </ul>

      <h3 className="font-display mt-6 text-base font-semibold">{t(locale, "privacy.contactTitle")}</h3>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
        {t(locale, "privacy.contactBody")}{" "}
        <a href={GITHUB} className="font-semibold text-[var(--accent-ink)] underline underline-offset-2">
          {t(locale, "privacy.contactLink")}
        </a>
      </p>
      <p className="mt-6 text-xs">
        <Link href="/" className="tap-link font-semibold text-[var(--accent-ink)] underline underline-offset-2">
          {t(locale, "nav.dashboard")}
        </Link>
      </p>
    </section>
  );
}
