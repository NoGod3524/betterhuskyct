"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BellOff,
  BellRing,
  CalendarDays,
  ChartColumn,
  Check,
  FileUp,
  LayoutDashboard,
  ListChecks,
  Sparkles,
} from "lucide-react";

import { AppFooter } from "@/components/app-footer";
import { SyncBanner } from "@/components/sync-banner";
import { useCalendar } from "@/components/calendar-provider";
import { t } from "@/lib/i18n";

/** True when a drag is carrying files rather than text or a link. */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

const NAV_ITEMS = [
  { href: "/", key: "nav.dashboard", Icon: LayoutDashboard },
  { href: "/plan", key: "nav.plan", Icon: ListChecks },
  { href: "/tasks", key: "nav.tasks", Icon: Check },
  { href: "/calendar", key: "nav.calendar", Icon: CalendarDays },
  { href: "/insights", key: "insights.eyebrow", Icon: ChartColumn },
] as const;

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
  const {
    locale,
    changeLocale,
    remindersEnabled,
    toggleReminders,
    hasSavedImport,
    calendarName,
    formattedImportedAt,
    restoredFromStorage,
    isImported,
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

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      {isDroppingFile && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-[#081f3a]/45 backdrop-blur-sm">
          <div className="rounded-3xl border-2 border-dashed border-white/70 px-12 py-9 text-center text-white">
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
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--line)] bg-white px-5 py-7 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="grid size-10 place-items-center rounded-xl bg-[var(--navy)] text-white shadow-[0_8px_24px_rgba(8,31,58,0.18)]">
              <Sparkles size={19} strokeWidth={2.2} />
            </div>
            <div>
              <p className="font-display text-lg font-semibold tracking-[-0.02em]">{t(locale, "app.name")}</p>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                {t(locale, "app.subtitle")}
              </p>
            </div>
          </div>

          <nav className="mt-12 space-y-2" aria-label="Main navigation">
            {NAV_ITEMS.map(({ href, key, Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`nav-item${active ? " nav-item-active" : ""}`}
                >
                  <Icon size={18} />{t(locale, key)}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto rounded-2xl bg-[var(--navy)] p-4 text-white">
            <p className="text-sm font-semibold">
              {hasSavedImport
                ? calendarName ??
                  (subscriptions.length === 1
                    ? t(locale, "sidebar.calendarConnected")
                    : t(locale, "sidebar.calendarCount", {
                        count: subscriptions.length,
                      }))
                : t(locale, "sidebar.demoCalendar")}
            </p>
            <p className="mt-1 text-xs leading-5 text-blue-100/75">
              {hasSavedImport
                ? t(locale, "sidebar.importedDescription")
                : t(locale, "sidebar.connectDescription")}
            </p>
            {formattedImportedAt && (
              <p className="mt-2 text-[11px] text-blue-100/85">
                {t(locale, "sidebar.lastImported", { value: formattedImportedAt })}
              </p>
            )}
            {restoredFromStorage && (
              <p className="mt-1 text-[11px] text-blue-100/85">
                {t(locale, "sidebar.restoredFromStorage")}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-[#9ec5ff]">
              <span className="size-2 rounded-full bg-[#68d59b]" />
              {isImported
                ? t(locale, "sidebar.statusImported")
                : hasSavedImport
                  ? t(locale, "sidebar.statusSavedAvailable")
                  : t(locale, "sidebar.statusReady")}
            </div>
          </div>

        </aside>

        <section className="flex min-w-0 flex-1 flex-col px-4 py-5 sm:px-7 lg:px-10 lg:py-8">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 lg:hidden">
              <div className="grid size-10 place-items-center rounded-xl bg-[var(--navy)] text-white">
                <Sparkles size={18} />
              </div>
              <span className="font-display text-lg font-semibold">{t(locale, "app.name")}</span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div
                role="group"
                aria-label={t(locale, "language.label")}
                className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-white p-1 text-xs font-semibold"
              >
                <button
                  type="button"
                  onClick={() => changeLocale("en")}
                  aria-pressed={locale === "en"}
                  aria-label={t(locale, "language.switchToEnglish")}
                  className={`rounded-full px-3 py-1.5 transition ${
                    locale === "en"
                      ? "bg-[var(--navy)] text-white"
                      : "text-[var(--muted)] hover:text-[#172b41]"
                  }`}
                >
                  {t(locale, "language.english")}
                </button>
                <button
                  type="button"
                  onClick={() => changeLocale("zh-CN")}
                  aria-pressed={locale === "zh-CN"}
                  aria-label={t(locale, "language.switchToChinese")}
                  className={`rounded-full px-3 py-1.5 transition ${
                    locale === "zh-CN"
                      ? "bg-[var(--navy)] text-white"
                      : "text-[var(--muted)] hover:text-[#172b41]"
                  }`}
                >
                  {t(locale, "language.chinese")}
                </button>
              </div>
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
                className={`grid size-9 shrink-0 place-items-center rounded-full border transition ${
                  remindersEnabled
                    ? "border-[var(--navy)] bg-[var(--navy)] text-white"
                    : "border-[var(--line)] bg-white text-[var(--muted)] hover:text-[#172b41]"
                }`}
              >
                {remindersEnabled ? <BellRing size={16} /> : <BellOff size={16} />}
              </button>
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold">{t(locale, "header.studentName")}</p>
                <p className="text-xs text-[var(--muted)]">{t(locale, "header.privateDashboard")}</p>
              </div>
              <div className="grid size-10 place-items-center rounded-full bg-[#dbe8ff] text-sm font-bold text-[#1851a5]">
                HS
              </div>
            </div>
          </header>

          <SyncBanner />
          <div className="flex-1">{children}</div>
          <AppFooter version={version} />
        </section>
      </div>
    </main>
  );
}
