"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Download, Send, Upload } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import {
  BACKUP_MAX_BYTES,
  backupFileName,
  createBackup,
  parseBackup,
  restoreBackup,
  summarize,
  type Backup,
  type RestoreMode,
} from "@/lib/backup";
import { t, type TranslationKey } from "@/lib/i18n";
import { withChangesLock } from "@/lib/changes";

type Step =
  | { phase: "idle" }
  | { phase: "chosen"; backup: Backup; name: string }
  | { phase: "done" };

/** Save everything this browser holds as one file, and load such a file back. Nothing is sent anywhere. */
export function BackupSection({ version }: { version: string }) {
  const { locale } = useCalendar();
  const [step, setStep] = useState<Step>({ phase: "idle" });
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const selection = useRef(0);

  function backupFile(): File {
    const now = new Date();
    const backup = createBackup(window.localStorage, now, version);
    return new File([JSON.stringify(backup)], backupFileName(now), { type: "application/json" });
  }

  function download(file: File) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportBackup() {
    try {
      const file = backupFile();
      download(file);
      setMessage({ text: t(locale, "backup.exported", { name: file.name }), bad: false });
    } catch {
      setMessage({ text: t(locale, "backup.exportFailed"), bad: true });
    }
  }

  /**
   * The way to a phone: the system's share sheet carries the file itself (Phone Link, Nearby Share,
   * AirDrop, a chat app, mail), so there is no link to be too long. Where a browser cannot share a
   * file, it is downloaded instead, to be sent by hand.
   */
  async function sendToPhone() {
    try {
      const file = backupFile();
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: file.name });
          setMessage({ text: t(locale, "backup.shared"), bad: false });
        } catch (error) {
          if ((error as Error).name !== "AbortError") setMessage({ text: t(locale, "backup.shareFailed"), bad: true });
        }
        return;
      }
      download(file);
      setMessage({ text: t(locale, "backup.shareFallback", { name: file.name }), bad: false });
    } catch {
      setMessage({ text: t(locale, "backup.exportFailed"), bad: true });
    }
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    const current = ++selection.current;
    setMessage(null);
    setStep({ phase: "idle" });
    if (file.size > BACKUP_MAX_BYTES) {
      setMessage({ text: t(locale, "backup.reason.tooBig"), bad: true });
      return;
    }
    try {
      const parsed = parseBackup(await file.text());
      if (current !== selection.current) return;
      if (!parsed.ok) {
        setMessage({ text: t(locale, `backup.reason.${parsed.reason}` as TranslationKey), bad: true });
        return;
      }
      setStep({ phase: "chosen", backup: parsed.backup, name: file.name });
    } catch {
      if (current === selection.current) {
        setMessage({ text: t(locale, "backup.reason.unreadable"), bad: true });
      }
    }
  }

  async function apply() {
    if (step.phase !== "chosen") return;
    if (mode === "replace" && !window.confirm(t(locale, "backup.replaceConfirm"))) return;
    let result;
    try {
      result = await withChangesLock(() => restoreBackup(window.localStorage, step.backup, mode));
    } catch {
      result = { ok: false };
    }
    if (!result.ok) {
      setMessage({ text: t(locale, "backup.failed"), bad: true });
      return;
    }
    setStep({ phase: "done" });
    setMessage({ text: t(locale, "backup.done"), bad: false });
    // The app holds what it loaded in memory and would save that over the restored values.
    window.setTimeout(() => window.location.reload(), 900);
  }

  const summary = step.phase === "chosen" ? summarize(step.backup) : [];

  return (
    <section className="mt-10 max-w-2xl" aria-labelledby="backup-heading">
      <p className="eyebrow">{t(locale, "backup.eyebrow")}</p>
      <h2 id="backup-heading" className="font-display mt-1 text-2xl font-semibold tracking-[-0.025em]">
        {t(locale, "backup.title")}
      </h2>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{t(locale, "backup.intro")}</p>

      <div className="card mt-6 p-4 sm:p-5">
        <h3 className="font-display text-base font-semibold">{t(locale, "backup.exportTitle")}</h3>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t(locale, "backup.exportBody")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={exportBackup}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {t(locale, "backup.exportButton")}
          </button>
          <button type="button" className="btn" onClick={() => void sendToPhone()}>
            <Send className="h-4 w-4" aria-hidden="true" />
            {t(locale, "backup.shareButton")}
          </button>
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{t(locale, "backup.phoneSteps")}</p>
      </div>

      <div className="card mt-4 p-4 sm:p-5">
        <h3 className="font-display text-base font-semibold">{t(locale, "backup.importTitle")}</h3>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t(locale, "backup.importBody")}</p>
        <input
          ref={picker}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <button type="button" className="btn mt-3" onClick={() => picker.current?.click()}>
          <Upload className="h-4 w-4" aria-hidden="true" />
          {t(locale, "backup.chooseButton")}
        </button>

        {step.phase === "chosen" ? (
          <div className="mt-4 border-t border-[var(--line)] pt-4">
            <p className="text-sm font-medium">{t(locale, "backup.contains", { name: step.name })}</p>
            {step.backup.exportedAt ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                {t(locale, "backup.madeAt", { date: step.backup.exportedAt.slice(0, 10), version: step.backup.appVersion || "?" })}
              </p>
            ) : null}
            <ul className="mt-2 grid gap-1 text-sm">
              {summary.map((entry) => (
                <li key={entry.id}>
                  {t(locale, `backup.group.${entry.id}` as TranslationKey)} · {entry.items}
                </li>
              ))}
            </ul>

            <fieldset className="mt-4 grid gap-2 text-sm">
              <legend className="sr-only">{t(locale, "backup.modeLegend")}</legend>
              {(["merge", "replace"] as const).map((value) => (
                <label key={value} className="flex items-start gap-2">
                  <input type="radio" name="backup-mode" checked={mode === value} onChange={() => setMode(value)} className="mt-1" />
                  <span>
                    <span className="font-medium">{t(locale, `backup.mode.${value}` as TranslationKey)}</span>
                    <span className="block text-xs text-[var(--muted)]">{t(locale, `backup.mode.${value}Help` as TranslationKey)}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="mt-4 flex gap-2">
              <button type="button" className="btn btn-primary" onClick={apply}>
                {t(locale, "backup.apply")}
              </button>
              <button type="button" className="btn" onClick={() => setStep({ phase: "idle" })}>
                {t(locale, "backup.cancel")}
              </button>
            </div>
          </div>
        ) : null}

        {message ? (
          <p className={"mt-3 text-sm " + (message.bad ? "text-[var(--danger,#b42318)]" : "text-[var(--muted)]")} role="status">
            {message.text}
          </p>
        ) : null}
      </div>

      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        {t(locale, "backup.filesNote")}{" "}
        <Link href="/materials" className="underline underline-offset-2">
          {t(locale, "nav.materials")}
        </Link>
      </p>
    </section>
  );
}
