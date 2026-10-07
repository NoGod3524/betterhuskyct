"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelperSyncButton } from "@/components/helper-sync-button";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  BellOff,
  BellRing,
  FileUp,
  Monitor,
  Moon,
  Sparkles,
  Sun,
} from "lucide-react";

import { AppFooter } from "@/components/app-footer";
import { MobileNav } from "@/components/mobile-nav";
import { NAV_ITEMS } from "@/components/nav-items";
import { SyncBanner } from "@/components/sync-banner";
import { useCalendar } from "@/components/calendar-provider";
import { t } from "@/lib/i18n";
import { applyTheme, nextTheme, readTheme, saveTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

/**
 * The theme choice, read from this browser's storage. The server has no
 * storage and renders "system"; the browser then reads the real choice, so
 * the first paint never disagrees with the server's markup.
 */
const themeListeners = new Set<() => void>();
function subscribeTheme(listener: () => void) {
  themeListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    themeListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(
    subscribeTheme,
    () => readTheme(window.localStorage),
    () => "system" as Theme,
  );
  const choose = (next: Theme) => {
    saveTheme(next, window.localStorage);
    applyTheme(next, document.documentElement);
    for (const listener of themeListeners) listener();
  };
  return [theme, choose];
}

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/** True when a drag is carrying files rather than text or a link. */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Persistent chrome: the sidebar and the top header. It is rendered once by the
 * root layout, so the language toggle, reminder toggle, and navigation stay
 * mounted while the routed content below them changes.
 */
export function AppShell({
  version,
  children,
}: {
  version: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [theme, chooseTheme] = useTheme();
  const ThemeIcon = THEME_ICONS[theme];
  const {
    locale,
    changeLocale,
    remindersEnabled,
    toggleReminders,
    hasSavedImport,
    calendarName,
    formattedImportedAt,
    subscriptions,
    importCalendarFiles,
  } = useCalendar();
  const [isDroppingFile, setIsDroppingFile] = useState(false);
  // Drag events fire per element as the pointer moves, so a plain boolean
  // flickers. Counting enters and leaves keeps the overlay steady.
  const dragDepth = useRef(0);
  const importFiles = useRef(importCalendarFiles);

  useEffect(() => {
    importFiles.current = importCalendarFiles;
  }, [importCalendarFiles]);

  /**
   * Accept a dropped calendar anywhere on the page.
   *
   * Aiming at one dashed rectangle is a small thing to ask and a real one to
   * miss, so the whole window is a target — including the routes that have no
   * import card on them.
   */
  useEffect(() => {
    function onDragEnter(event: DragEvent) {
      if (!carriesFiles(event)) return;
      dragDepth.current += 1;
      setIsDroppingFile(true);
    }

    function onDragOver(event: DragEvent) {
      if (!carriesFiles(event)) return;
      // Without this the browser navigates away and opens the file itself.
      event.preventDefault();
    }

    function onDragLeave(event: DragEvent) {
      if (!carriesFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsDroppingFile(false);
    }

    function onDrop(event: DragEvent) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setIsDroppingFile(false);
      void importFiles.current(Array.from(event.dataTransfer?.files ?? []));
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const iconButton =
    "tap-icon grid size-8 shrink-0 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--subtle)] hover:text-[var(--ink)]";
  const languageButton = (active: boolean) =>
    `rounded-md px-2.5 py-1 transition ${
      active ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"
    }`;

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      {isDroppingFile && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-[var(--c-081f3a)]/45 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-white/70 px-12 py-9 text-center text-white">
            <FileUp size={30} className="mx-auto" />
            <p className="font-display mt-3 text-xl font-semibold">
              {t(locale, "file.dropActive")}
            </p>
            <p className="mt-1 text-sm text-blue-100/85">
              {t(locale, "file.dropAnywhere")}
            </p>
          </div>
        </div>
      )}
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[var(--line)] px-3 py-4 lg:flex">
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
            {NAV_ITEMS.map(({ href, key, Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`nav-item${active ? " nav-item-active" : ""}`}
                >
                  <Icon size={16} />{t(locale, key)}
                </Link>
              );
            })}
          </nav>

          <div className="card mt-auto p-3">
            <p className="flex items-center gap-2 text-[13px] font-medium">
              <span className={`size-1.5 shrink-0 rounded-full ${hasSavedImport ? "bg-[var(--success)]" : "bg-[var(--line-strong)]"}`} />
              <span className="truncate">
                {hasSavedImport
                  ? calendarName ??
                    (subscriptions.length === 1
                      ? t(locale, "sidebar.calendarConnected")
                      : t(locale, "sidebar.calendarCount", {
                          count: subscriptions.length,
                        }))
                  : t(locale, "sidebar.demoCalendar")}
              </span>
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {hasSavedImport
                ? t(locale, "sidebar.importedDescription")
                : t(locale, "sidebar.connectDescription")}
            </p>
            {formattedImportedAt && (
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {t(locale, "sidebar.lastImported", { value: formattedImportedAt })}
              </p>
            )}
          </div>
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
              {/* The overview has its own, bigger one. */}
              {pathname !== "/" && <HelperSyncButton variant="compact" />}
              <div
                role="group"
                aria-label={t(locale, "language.label")}
                className="ml-1 hidden items-center rounded-lg bg-[var(--subtle)] p-0.5 text-xs font-medium sm:flex"
              >
                <button
                  type="button"
                  onClick={() => changeLocale("en")}
                  aria-pressed={locale === "en"}
                  aria-label={t(locale, "language.switchToEnglish")}
                  className={languageButton(locale === "en")}
                >
                  {t(locale, "language.english")}
                </button>
                <button
                  type="button"
                  onClick={() => changeLocale("zh-CN")}
                  aria-pressed={locale === "zh-CN"}
                  aria-label={t(locale, "language.switchToChinese")}
                  className={languageButton(locale === "zh-CN")}
                >
                  {t(locale, "language.chinese")}
                </button>
              </div>
              <button
                type="button"
                onClick={() => changeLocale(locale === "en" ? "zh-CN" : "en")}
                aria-label={t(locale, locale === "en" ? "language.switchToChinese" : "language.switchToEnglish")}
                className="whitespace-nowrap rounded-lg px-2.5 text-xs font-medium text-[var(--muted)] hover:bg-[var(--subtle)] hover:text-[var(--ink)] sm:hidden"
              >
                {t(locale, locale === "en" ? "language.chinese" : "language.english")}
              </button>
              <button
                type="button"
                onClick={() => chooseTheme(nextTheme(theme))}
                aria-label={t(locale, "theme.toggle", { mode: t(locale, `theme.${theme}`) })}
                title={t(locale, "theme.toggle", { mode: t(locale, `theme.${theme}`) })}
                className={iconButton}
              >
                <ThemeIcon size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  void toggleReminders();
                }}
                aria-pressed={remindersEnabled}
                aria-label={t(locale, "reminders.toggleLabel")}
                title={
                  remindersEnabled
                    ? t(locale, "reminders.on")
                    : t(locale, "reminders.off")
                }
                className={
                  remindersEnabled
                    ? `${iconButton} bg-[var(--accent-soft)] text-[var(--accent-ink)]`
                    : iconButton
                }
              >
                {remindersEnabled ? <BellRing size={16} /> : <BellOff size={16} />}
              </button>
            </div>
          </header>

          <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col">
            <SyncBanner />
            {/* Keyed by the route, so each page arrives with its own fade. */}
            <div key={pathname} className="page-enter flex-1">
              {children}
            </div>
            <AppFooter version={version} />
          </div>
        </section>
      </div>
      <MobileNav pathname={pathname} locale={locale} />
    </main>
  );
}
