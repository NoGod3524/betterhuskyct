"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Sparkles } from "lucide-react";

import { AppFooter } from "@/components/app-footer";
import { AppNotice } from "@/components/app-notice";
import { MobileNav } from "@/components/mobile-nav";
import { NAV_SECTIONS, sectionFor } from "@/components/nav-items";
import { SearchPalette } from "@/components/search-palette";
import { SubNav } from "@/components/sub-nav";
import { SyncBanner } from "@/components/sync-banner";
import { SyncCenter } from "@/components/sync-center";
import { useCalendar } from "@/components/calendar-provider";
import { useChanges } from "@/components/use-changes";
import { announceSeenChanged, useAnnouncementsSeenAt } from "@/components/use-seen";
import { ensureAnnouncementsBaseline, unseenAnnouncements } from "@/lib/seen";
import { t } from "@/lib/i18n";

/**
 * Persistent chrome: the four sections in a sidebar (a bar along the bottom on a phone), a header
 * with Sync and search, and the current section's pages as tabs. It is rendered once by the root
 * layout, so it stays mounted while the routed content below it changes.
 */
export function AppShell({
  version,
  children,
}: {
  version: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const changes = useChanges();
  const newChanges = changes.ready ? changes.store.entries.filter((entry) => !entry.read).length : 0;
  const { locale, announcements } = useCalendar();
  const current = sectionFor(pathname);

  // The first run has no past to compare with, so it starts "new" from now; after that the count
  // of announcements seen since the Announcements page was last left shows on its tab.
  const announcementsSeenAt = useAnnouncementsSeenAt();
  const newAnnouncements = unseenAnnouncements(announcements, announcementsSeenAt).size;
  useEffect(() => {
    ensureAnnouncementsBaseline(window.localStorage, new Date());
    announceSeenChanged();
  }, []);

  const iconButton =
    "tap-icon grid size-8 shrink-0 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--subtle)] hover:text-[var(--ink)]";

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-[var(--line)] px-3 py-4 lg:flex">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--navy)] text-white">
              <Sparkles size={15} strokeWidth={2.2} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-4">{t(locale, "app.name")}</span>
              <span className="block truncate text-[11px] leading-4 text-[var(--muted)]">{t(locale, "app.subtitle")}</span>
            </span>
          </Link>

          <nav className="mt-6 space-y-0.5" aria-label={t(locale, "nav.main")}>
            {NAV_SECTIONS.map((section) => {
              const { href, key, Icon } = section;
              const active = current === section;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? (pathname === href ? "page" : "true") : undefined}
                  className={`nav-item${active ? " nav-item-active" : ""}`}
                >
                  <Icon size={16} />{t(locale, key)}
                  {href === "/" && newChanges > 0 ? (
                    <span className="ml-auto rounded-full bg-[var(--warning-soft)] px-1.5 text-[11px] font-semibold tabular-nums text-[var(--warning)]" aria-label={t(locale, "changes.unreadCount", { count: newChanges })}>
                      {newChanges}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-7 lg:px-10 lg:pb-8">
          <header className="sticky top-0 z-30 -mx-4 flex h-14 items-center gap-2 border-b border-[var(--line)] bg-[var(--canvas)]/85 px-4 backdrop-blur-md sm:-mx-7 sm:px-7 lg:-mx-10 lg:px-10">
            <Link href="/" className="flex items-center gap-2.5 lg:hidden">
              <span className="grid size-7 place-items-center rounded-lg bg-[var(--navy)] text-white">
                <Sparkles size={15} />
              </span>
              <span className="hidden text-sm font-semibold sm:inline">{t(locale, "app.name")}</span>
            </Link>
            <div className="ml-auto flex items-center gap-1.5">
              <SyncCenter />
              <SearchPalette iconButton={iconButton} />
            </div>
          </header>

          <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col">
            <SubNav pathname={pathname} locale={locale} badges={{ "/changes": newChanges, "/announcements": pathname === "/announcements" ? 0 : newAnnouncements }} />
            <SyncBanner />
            <AppNotice />
            {/* Keyed by the route, so each page arrives with its own fade. */}
            <div key={pathname} className="page-enter flex-1">
              {children}
            </div>
            <AppFooter version={version} />
          </div>
        </section>
      </div>
      <MobileNav pathname={pathname} locale={locale} unreadChanges={newChanges} />
    </main>
  );
}
