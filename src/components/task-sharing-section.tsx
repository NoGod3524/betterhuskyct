"use client";

import { useState, useSyncExternalStore } from "react";
import { useAiPlan } from "@/components/ai-plan-provider";
import { useCalendar } from "@/components/calendar-provider";
import { t } from "@/lib/i18n";
import { latestImportAt } from "@/lib/subscriptions";
import { buildTaskSnapshot } from "@/lib/task-snapshot";
import type { ShareCredentials } from "@/lib/task-share-store";

// Deliberately excluded from portable backups: the write credential controls a remote share.
const KEY = "betterhuskyct.privateTaskShare.v1";
const EVENT = "bhc-task-share-credentials";
const read = () => { try { return window.localStorage.getItem(KEY) ?? ""; } catch { return ""; } };
const serverRead = () => "";
const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener(EVENT, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(EVENT, notify); };
};
function credentials(raw: string): ShareCredentials | null {
  try {
    const value = JSON.parse(raw);
    return /^[a-f0-9]{32}$/.test(value.id) && /^[a-f0-9]{64}$/.test(value.readToken) && /^[a-f0-9]{64}$/.test(value.writeToken) && Number.isFinite(Date.parse(value.expiresAt)) ? value : null;
  } catch { return null; }
}

/** Nothing is uploaded, or even fetched, until the student presses Publish. */
export function TaskSharingSection() {
  const calendar = useCalendar();
  const plan = useAiPlan();
  const raw = useSyncExternalStore(subscribe, read, serverRead);
  const [volatile, setVolatile] = useState<ShareCredentials | null | undefined>(undefined);
  const current = volatile === undefined ? credentials(raw) : volatile;
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { locale } = calendar;
  const active = current && Date.parse(current.expiresAt) > calendar.now.valueOf() ? current : null;

  function remember(value: ShareCredentials | null) {
    setVolatile(value);
    try {
      if (value) window.localStorage.setItem(KEY, JSON.stringify(value));
      else window.localStorage.removeItem(KEY);
      window.dispatchEvent(new window.Event(EVENT));
    } catch { setMessage(t(locale, "taskShare.storageFailed")); }
  }
  async function publish() {
    if (!consent || busy || !calendar.calendarReady || !calendar.isImported) return;
    setBusy(true); setMessage("");
    try {
      const snapshot = buildTaskSnapshot({ tasks: calendar.tasks, doneIds: calendar.doneIds,
        courseFor: (task) => calendar.courseLabelFor(task)?.code ?? null, undated: plan?.undated ?? [],
        sourceImportedAt: latestImportAt(calendar.subscriptions) });
      const response = await fetch(active ? `/api/task-share/${active.id}` : "/api/task-share", {
        method: active ? "PUT" : "POST", headers: { "Content-Type": "application/json", ...(active ? { Authorization: `Bearer ${active.writeToken}` } : {}) },
        body: JSON.stringify(snapshot), cache: "no-store", signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) { setMessage(t(locale, response.status === 503 ? "taskShare.unavailable" : response.status === 404 ? "taskShare.notFound" : response.status === 429 ? "taskShare.rateLimited" : "taskShare.failed")); return; }
      const result = await response.json();
      setMessage(t(locale, "taskShare.published", { at: snapshot.capturedAt }));
      remember(active ? { ...active, expiresAt: result.expiresAt } : result);
    } catch { setMessage(t(locale, "taskShare.failed")); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!current || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/task-share/${current.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${current.writeToken}` }, cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (!response.ok && response.status !== 404) throw new Error();
      setMessage(t(locale, "taskShare.revoked")); remember(null); setConsent(false);
    } catch { setMessage(t(locale, "taskShare.revokeFailed")); }
    finally { setBusy(false); }
  }
  async function copy(kind: "mcp" | "json") {
    if (!current) return;
    const path = kind === "mcp" ? "mcp/tasks" : "task-share";
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/api/${path}/${current.id}/${current.readToken}`);
      setMessage(t(locale, "taskShare.copied"));
    } catch { setMessage(t(locale, "taskShare.copyFailed")); }
  }

  return <section className="card mt-6 max-w-2xl p-4 sm:p-5" aria-labelledby="task-sharing-heading">
    <h2 id="task-sharing-heading" className="font-display text-xl font-semibold">{t(locale, "taskShare.title")}</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t(locale, "taskShare.intro")}</p>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t(locale, "taskShare.privacy")}</p>
    <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} className="mt-1" /><span>{t(locale, "taskShare.consent")}</span></label>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="btn btn-primary" disabled={!consent || busy || !calendar.calendarReady || !calendar.isImported} onClick={() => void publish()}>{t(locale, busy ? "taskShare.busy" : active ? "taskShare.update" : "taskShare.publish")}</button>
      {current ? <><button type="button" className="btn" disabled={busy} onClick={() => void copy("mcp")}>{t(locale, "taskShare.copyMcp")}</button><button type="button" className="btn" disabled={busy} onClick={() => void copy("json")}>{t(locale, "taskShare.copyJson")}</button><button type="button" className="btn" disabled={busy} onClick={() => void revoke()}>{t(locale, "taskShare.revoke")}</button></> : null}
    </div>
    {!calendar.isImported ? <p className="mt-2 text-sm">{t(locale, "taskShare.importFirst")}</p> : null}
    {current ? <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{t(locale, "taskShare.lastPublished", { at: new Date(Date.parse(current.expiresAt) - 7 * 86400000).toISOString() })}<br />{t(locale, "taskShare.expires", { at: current.expiresAt })}</p> : null}
    {calendar.calendarReady && latestImportAt(calendar.subscriptions) ? <p className="mt-2 text-xs text-[var(--muted)]">{t(locale, "taskShare.lastImport", { at: latestImportAt(calendar.subscriptions)! })}</p> : null}
    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{t(locale, "taskShare.limits")}</p>
    {message ? <p className="mt-3 text-sm" role="status">{message}</p> : null}
  </section>;
}
