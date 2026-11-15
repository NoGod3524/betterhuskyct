"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, LoaderCircle, RefreshCw, TriangleAlert, X } from "lucide-react";

import { BackgroundSyncButton } from "@/components/background-sync-button";
import { useCalendar } from "@/components/calendar-provider";
import { HelperSyncButton, useHelperSync } from "@/components/helper-sync-button";
import { ago, SyncStatusDetails, useSyncStatus } from "@/components/sync-status-view";
import { t } from "@/lib/i18n";
import { missedParts } from "@/lib/sync-status";

/** Fired by any "Sync" link on a page, so every page sends the student to the same place. */
export const OPEN_SYNC_EVENT = "betterhuskyct:open-sync";

const noSubscribe = () => () => {};

export function openSyncCenter() {
  window.dispatchEvent(new Event(OPEN_SYNC_EVENT));
}

/**
 * The only way to sync, on every page: a button in the header that says when the last sync was,
 * and a panel with the check that runs in the background, the full sync that also brings file
 * contents, and what the last sync read course by course.
 */
export function SyncCenter() {
  const { locale, now } = useCalendar();
  const status = useSyncStatus();
  const { state } = useHelperSync();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // A phone has no extension, so the full sync is the sync there.
  const phone = useSyncExternalStore(noSubscribe, () => /Android|iPhone|iPad|Mobile/.test(navigator.userAgent), () => false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_SYNC_EVENT, show);
    return () => window.removeEventListener(OPEN_SYNC_EVENT, show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const working = state.phase === "waiting" || state.phase === "syncing";
  const trouble = state.phase === "failed" || state.phase === "blocked" || state.phase === "nodata" || (status ? missedParts(status).length > 0 : false);
  const when = status ? ago(locale, status.lastSync, now) : null;
  const label = working
    ? t(locale, "synccenter.working")
    : when
      ? t(locale, "synccenter.last", { ago: when })
      : t(locale, "synccenter.never");
  const Icon = working ? LoaderCircle : trouble ? TriangleAlert : status ? Check : RefreshCw;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="sync-center"
        aria-label={`${t(locale, "synccenter.title")} · ${label}`}
        className={
          status
            ? `inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs sm:px-2.5 font-medium transition hover:bg-[var(--subtle)] ${trouble ? "text-[var(--warning)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`
            : "btn btn-primary h-8 px-3 text-xs"
        }
      >
        <Icon size={14} aria-hidden className={working ? "animate-spin" : status && !trouble ? "text-[var(--success)]" : undefined} />
        {/* A phone's header has no room for the whole sentence; the time alone says it. */}
        <span className="whitespace-nowrap sm:hidden" suppressHydrationWarning>{working || !when ? label : when}</span>
        <span className="hidden whitespace-nowrap sm:inline" suppressHydrationWarning>{label}</span>
      </button>

      {open ? (
        <div
          id="sync-center"
          role="dialog"
          aria-label={t(locale, "synccenter.title")}
          className="card fixed inset-x-3 top-14 z-40 max-h-[calc(100dvh-5rem)] overflow-y-auto p-4 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[26rem]"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-base font-semibold">{t(locale, "synccenter.title")}</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label={t(locale, "nav.close")} className="tap-icon grid size-7 shrink-0 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--subtle)] hover:text-[var(--ink)]">
              <X size={15} />
            </button>
          </div>

          <div className="mt-3">
            <BackgroundSyncButton />
          </div>

          <div className="mt-4 border-t border-[var(--line)] pt-4" id="full-sync">
            <p className="text-sm font-semibold">{t(locale, "synccenter.fullTitle")}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t(locale, "synccenter.fullBody")}</p>
            <div className="mt-3">
              <HelperSyncButton variant="big" quiet={!phone} />
            </div>
          </div>

          <div className="mt-2 border-t border-[var(--line)]">
            <SyncStatusDetails />
          </div>
        </div>
      ) : null}
    </div>
  );
}
