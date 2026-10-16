"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCalendar } from "@/components/calendar-provider";
import { BACKGROUND_CHANGED, parseBackgroundStatus, requestBackground, type BackgroundStatus } from "@/lib/background-sync";
import { intlLocale, t } from "@/lib/i18n";

function useBackgroundStatus() {
  const [status, setStatus] = useState<BackgroundStatus | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const refresh = () => { void requestBackground("status").then(value => {
      if (active) setStatus(parseBackgroundStatus(value));
    }).catch(() => {}).finally(() => { if (active) setLoading(false); }); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(BACKGROUND_CHANGED, refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); window.removeEventListener(BACKGROUND_CHANGED, refresh); };
  }, []);
  useEffect(() => {
    if (!status?.running) return;
    const timer = window.setInterval(() => { void requestBackground("status").then(value => {
      const next = parseBackgroundStatus(value);
      if (next) setStatus(next);
    }).catch(() => {}); }, 2000);
    return () => window.clearInterval(timer);
  }, [status?.running]);
  return { status, setStatus, loading };
}

export function BackgroundSyncStatusLine() {
  const { locale } = useCalendar();
  const { status, loading } = useBackgroundStatus();
  if (loading) return null;
  const label = !status ? t(locale, "background.unavailable") : status.needsLogin ? t(locale, "background.needsLogin")
    : `${t(locale, status.settings.enabled ? "background.on" : "background.off")}${status.lastSuccess ? ` · ${t(locale, "background.lastSuccess", { at: new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "short", timeStyle: "short" }).format(new Date(status.lastSuccess)) })}` : ""}`;
  return <Link href="/helper" className="mt-1 block text-xs text-[var(--muted)] hover:text-[var(--link)]">{label}</Link>;
}

export function BackgroundSyncSection() {
  const { locale } = useCalendar();
  const { status, setStatus, loading } = useBackgroundStatus();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function act(kind: "settings" | "run-now" | "open-settings", settings?: Record<string, unknown>) {
    setBusy(true);
    setFailed(false);
    try {
      const response = await requestBackground(kind, settings);
      if (!response || typeof response !== "object" || !("ok" in response) || response.ok !== true) setFailed(true);
      const next = parseBackgroundStatus(await requestBackground("status"));
      if (next) setStatus(next);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }

  return (
    <section className="card mt-6 p-4 sm:p-5" aria-labelledby="background-heading">
      <h2 id="background-heading" className="text-base font-semibold">{t(locale, "background.title")}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{t(locale, "background.description")}</p>
      {loading ? <p className="mt-3 text-sm text-[var(--muted)]" role="status">{t(locale, "common.loading")}</p> : !status ? (
        <p className="mt-3 text-sm text-[var(--muted)]">{t(locale, "background.unavailable")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={status.settings.enabled} disabled={busy} onChange={event => { void act("settings", { enabled: event.target.checked, locale }); }} />
            {t(locale, "background.enabled")}
          </label>
          <p className="text-sm text-[var(--muted)]">{status.lastSuccess
            ? t(locale, "background.lastSuccess", { at: new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(new Date(status.lastSuccess)) })
            : t(locale, "background.noSuccess")}</p>
          {status.needsLogin ? <p role="status" className="text-sm text-[var(--warning)]">{t(locale, "background.needsLogin")}</p> : null}
          {status.running ? <p role="status" className="text-sm text-[var(--muted)]">{t(locale, "background.running")}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-quiet" disabled={busy || status.running || !status.settings.enabled} onClick={() => { void act("run-now"); }}>{t(locale, "background.runNow")}</button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => { void act("open-settings"); }}>{t(locale, "background.notifications")}</button>
          </div>
        </div>
      )}
      {failed ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{t(locale, "background.failed")}</p> : null}
    </section>
  );
}
