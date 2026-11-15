"use client";

import Link from "next/link";

import { NAV_SECTIONS, sectionFor } from "@/components/nav-items";
import { t, type Locale } from "@/lib/i18n";

/**
 * The navigation below the sidebar's breakpoint, where the sidebar is hidden: the same four
 * sections, along the bottom within a thumb's reach. Only ever shown where the sidebar is not, so
 * a page has one navigation on screen, never two.
 */
export function MobileNav({
  pathname,
  locale,
  unreadChanges = 0,
}: {
  pathname: string;
  locale: Locale;
  unreadChanges?: number;
}) {
  const current = sectionFor(pathname);
  return (
    <nav
      aria-label={t(locale, "nav.main")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--surface)]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {NAV_SECTIONS.map((section) => {
          const { href, key, Icon } = section;
          const active = current === section;
          return (
            <li key={href} className="min-w-0">
              <Link
                href={href}
                aria-current={active ? (pathname === href ? "page" : "true") : undefined}
                className={`mobile-tab${active ? " mobile-tab-active" : ""}`}
              >
                <span className="relative">
                  <Icon size={20} aria-hidden />
                  {href === "/" && unreadChanges > 0 ? (
                    <span className="absolute -right-3 -top-1.5 rounded-full bg-[var(--warning-soft)] px-1 text-[10px] font-semibold leading-4 tabular-nums text-[var(--warning)]" aria-label={t(locale, "changes.unreadCount", { count: unreadChanges })}>{unreadChanges}</span>
                  ) : null}
                </span>
                <span className="max-w-full truncate">{t(locale, key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
