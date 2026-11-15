"use client";

import Link from "next/link";

import { sectionFor } from "@/components/nav-items";
import { t, type Locale } from "@/lib/i18n";

/**
 * The pages of the current section, as tabs at the top of the page: To-do's list and month, a
 * course's announcements, files and grades. A section with one page has no tabs.
 */
export function SubNav({ pathname, locale, badges = {} }: { pathname: string; locale: Locale; badges?: Record<string, number> }) {
  const section = sectionFor(pathname);
  // A page under a section that is not one of its tabs (a course's own page) has tabs of its own.
  if (!section || section.pages.length < 2 || !section.pages.some((page) => page.href === pathname)) return null;
  return (
    <nav aria-label={t(locale, section.key)} className="-mx-1 mt-4 overflow-x-auto px-1 [scrollbar-width:none]">
      <ul className="flex w-max gap-1 rounded-lg bg-[var(--subtle)] p-0.5 text-sm font-medium">
        {section.pages.map(({ href, key }) => {
          const active = pathname === href;
          const badge = badges[href] ?? 0;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`tap-link inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
                  active ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {t(locale, key)}
                {badge > 0 ? (
                  <span className="rounded-full bg-[var(--warning-soft)] px-1.5 text-[11px] font-semibold tabular-nums text-[var(--warning)]">{badge}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
