"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { BACKGROUND_CHANGED, parseBackgroundStatus, requestBackground, type BackgroundStatus } from "@/lib/background-sync";
import { EDGE_ADDONS_URL, EXTENSION_INSTALL_URL, HELPER_SOURCE_URL, managerFor } from "@/lib/helper";
import { HUSKYCT_URL } from "@/lib/helper-sync";
import { intlLocale, t } from "@/lib/i18n";

const subscribeBrowser = () => () => {};

/** One check uses the extension's existing session, without opening a HuskyCT tab. */
export function BackgroundSyncButton() {
  const { locale } = useCalendar();
  const [status, setStatus] = useState<BackgroundStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const browser = useSyncExternalStore(subscribeBrowser, () => /Android|iPhone|iPad|Mobile/.test(navigator.userAgent) ? "mobile" : managerFor(navigator.userAgent).id, () => "other");

  useEffect(() => {
    let active = true;
    const refresh = () => { void requestBackground("status").then(value => {
      if (active) {
        const next = parseBackgroundStatus(value);
        setStatus(next);
        if (next) setFailed(false);
      }
    }).catch(() => { if (active) setStatus(null); }).finally(() => { if (active) setLoading(false); }); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(BACKGROUND_CHANGED, refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener(BACKGROUND_CHANGED, refresh);
    };
  }, []);

  useEffect(() => {
    if (!status?.running) return;
    let active = true;
    const timer = window.setInterval(() => { void requestBackground("status").then(value => {
      if (active) {
        const next = parseBackgroundStatus(value);
        setStatus(next);
        setFailed(!next);
      }
    }).catch(() => { if (active) { setStatus(null); setFailed(true); } }); }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [status?.running]);

  async function check() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await requestBackground("run-now");
      const next = parseBackgroundStatus(await requestBackground("status"));
      setStatus(next);
      setFailed(!response || typeof response !== "object" || !("ok" in response) || response.ok !== true || !next);
    } catch { setStatus(null); setFailed(true); }
    finally { setBusy(false); }
  }

  const working = busy || status?.running;
  const installHref = browser === "edge" ? EDGE_ADDONS_URL : browser === "chrome" ? "/betterhuskyct-extension.zip" : EXTENSION_INSTALL_URL;
  return (
    <div className="sm:max-w-sm sm:text-right" id="check-updates">
      {loading || status || busy || failed ? (
        <button type="button" onClick={() => { void check(); }} disabled={loading || working} className="btn btn-primary h-9 w-full px-4 text-sm sm:w-auto">
          {working ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />}
          {t(locale, working ? "background.running" : "background.runNow")}
        </button>
      ) : browser === "mobile" ? (
        <Link href="/materials#manual-sync" className="tap-link btn btn-primary h-9 w-full px-4 text-sm sm:w-auto">{t(locale, "background.manual")}</Link>
      ) : (
        <a href={installHref} download={browser === "chrome" || undefined} className="tap-link btn btn-primary h-9 w-full px-4 text-sm sm:w-auto">
          {t(locale, "background.install")}
        </a>
      )}
      <div className="mt-2 text-xs leading-5 text-[var(--muted)]" role="status">
        {loading ? t(locale, "common.loading") : !status ? (
          <>
            <p>{t(locale, browser === "mobile" ? "background.manualOnly" : "background.unavailable")}</p>
            <a href={browser === "mobile" ? HELPER_SOURCE_URL : EXTENSION_INSTALL_URL} className="tap-link font-semibold text-[var(--link)] hover:underline">{t(locale, "background.installHelp")}</a>
            {browser !== "mobile" ? <>{" · "}<Link href="/materials#manual-sync" className="tap-link font-semibold text-[var(--link)] hover:underline">{t(locale, "background.manual")}</Link></> : null}
          </>
        ) : (
          <>
            <p>{t(locale, status.settings.enabled ? "background.on" : "background.off")}</p>
            <p>{status.lastSuccess
              ? t(locale, "background.lastSuccess", { at: new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "short", timeStyle: "short" }).format(new Date(status.lastSuccess)) })
              : t(locale, "background.noSuccess")}</p>
            {status.needsLogin ? (
              <p className="text-[var(--warning)]">
                {t(locale, "background.needsLogin")}{" "}
                <a href={HUSKYCT_URL} target="_blank" rel="noopener noreferrer" className="tap-link font-semibold text-[var(--link)] hover:underline">{t(locale, "background.signIn")}</a>
              </p>
            ) : status.lastError ? <p role="alert" className="text-[var(--danger)]">{t(locale, "background.failed")}</p> : null}
          </>
        )}
      </div>
      {failed ? <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{t(locale, "background.failed")}</p> : null}
    </div>
  );
}
