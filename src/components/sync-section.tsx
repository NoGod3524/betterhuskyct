"use client";

import { useState } from "react";
import { Check, Copy, LoaderCircle, TriangleAlert } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { t } from "@/lib/i18n";

/**
 * The outgoing half of device sync: pack this device's set-up into a link.
 *
 * Shown only when there is something to send, and never automatically — the
 * user asks for a link, copies it, and sends it to themselves.
 */
export function SyncSection() {
  const { locale, createSyncLink, outgoingSyncLink, isPackingSync, syncError } =
    useCalendar();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!outgoingSyncLink) return;
    try {
      await navigator.clipboard.writeText(outgoingSyncLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the link is on screen to select anyway.
    }
  }

  return (
    <div className="mt-3">
      <p className="text-xs leading-5 text-[var(--muted)]">
        {t(locale, "sync.hint")}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void createSyncLink()}
          disabled={isPackingSync}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--c-244e7a)] transition hover:border-[var(--c-9fb7d1)] disabled:cursor-wait disabled:opacity-60"
        >
          {isPackingSync ? (
            <>
              <LoaderCircle size={15} className="animate-spin" />
              {t(locale, "sync.generating")}
            </>
          ) : (
            t(locale, outgoingSyncLink ? "sync.regenerate" : "sync.generate")
          )}
        </button>

        {outgoingSyncLink && (
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--blue)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--c-1857aa)]"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {t(locale, copied ? "sync.copied" : "sync.copy")}
          </button>
        )}
      </div>

      {outgoingSyncLink && (
        <>
          <label className="sr-only" htmlFor="sync-link">
            {t(locale, "sync.linkLabel")}
          </label>
          <textarea
            id="sync-link"
            readOnly
            value={outgoingSyncLink}
            rows={3}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-2 w-full resize-none rounded-xl border border-[var(--line-strong)] bg-[var(--c-fbfcfe)] p-3 font-mono text-[11px] leading-5 text-[var(--c-31506f)] outline-none focus:border-[var(--c-2a71d8)]"
          />
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            {t(locale, "sync.linkNote", {
              size: outgoingSyncLink.length.toLocaleString(),
            })}
          </p>
        </>
      )}

      {syncError && (
        <p className="mt-2 flex items-start gap-2 text-xs text-[var(--c-9f3527)]">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          {syncError}
        </p>
      )}
    </div>
  );
}
