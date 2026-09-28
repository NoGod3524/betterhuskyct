"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Ellipsis } from "lucide-react";

import { MORE_NAV, PRIMARY_NAV, type NavItem } from "@/components/nav-items";
import { t, type Locale } from "@/lib/i18n";

/**
 * The navigation below the sidebar's breakpoint, where the sidebar is hidden.
 *
 * A bar along the bottom, within a thumb's reach, with the pages opened most
 * and a "More" that lists the rest in a sheet. It is only ever shown where the
 * sidebar is not, so a page has one navigation on screen, never two.
 *
 * The sheet is modal: focus moves into it, Tab stays inside it, Escape and the
 * backdrop close it, and the page behind does not scroll. It also closes by
 * itself when the route changes, because it remembers *where* it was opened.
 */
export function MobileNav({
  pathname,
  locale,
  primary = PRIMARY_NAV,
  more = MORE_NAV,
}: {
  pathname: string;
  locale: Locale;
  primary?: readonly NavItem[];
  more?: readonly NavItem[];
}) {
  // The route the sheet was opened on. Open means "still on that route".
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const moreButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const moreActive = more.some((item) => item.href === pathname);

  function close() {
    setOpenedOn(null);
    moreButton.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const dialog = sheet.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("a[href], button") ?? []);
    focusable()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenedOn(null);
        moreButton.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = scroll;
    };
  }, [open]);

  return (
    <>
      <nav
        aria-label={t(locale, "nav.main")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {primary.map(({ href, key, Icon }) => {
            const active = pathname === href;
            return (
              <li key={href} className="min-w-0">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`mobile-tab${active ? " mobile-tab-active" : ""}`}
                >
                  <Icon size={20} aria-hidden />
                  <span className="max-w-full truncate">{t(locale, key)}</span>
                </Link>
              </li>
            );
          })}
          <li className="min-w-0">
            <button
              ref={moreButton}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpenedOn(open ? null : pathname)}
              className={`mobile-tab w-full${moreActive ? " mobile-tab-active" : ""}`}
            >
              <Ellipsis size={20} aria-hidden />
              <span className="max-w-full truncate">{t(locale, "nav.more")}</span>
            </button>
          </li>
        </ul>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" tabIndex={-1} aria-label={t(locale, "nav.close")} onClick={close} className="scrim absolute inset-0 cursor-default" />
          <div
            ref={sheet}
            role="dialog"
            aria-modal="true"
            aria-label={t(locale, "nav.moreLabel")}
            className="rise-in absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-[var(--line)] bg-[var(--surface)] px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_40px_rgba(8,31,58,0.18)]"
          >
            <ul className="mx-auto max-w-xl space-y-1">
              {more.map(({ href, key, Icon }) => {
                const active = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`nav-item min-h-12${active ? " nav-item-active" : ""}`}
                    >
                      <Icon size={18} aria-hidden />
                      {t(locale, key)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
