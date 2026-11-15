"use client";

import { Check, TriangleAlert, X } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { t } from "@/lib/i18n";

/**
 * What the last action said — a sync that arrived, a save that failed, a file exported — at the
 * top of whichever page the student is on, until they close it or the next action replaces it.
 */
export function AppNotice() {
  const { locale, notice, error, clearNotice } = useCalendar();
  const text = error ?? notice;
  if (!text) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      aria-live="polite"
      className={`mt-4 flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm ${error ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--subtle)] text-[var(--ink)]"}`}
    >
      {error ? <TriangleAlert size={16} className="mt-0.5 shrink-0" /> : <Check size={16} className="mt-0.5 shrink-0 text-[var(--success)]" />}
      <span className="min-w-0 flex-1">{text}</span>
      <button type="button" onClick={clearNotice} aria-label={t(locale, "notice.dismiss")} className="tap-icon -my-0.5 grid size-6 shrink-0 place-items-center rounded-md opacity-70 hover:opacity-100">
        <X size={14} />
      </button>
    </div>
  );
}
