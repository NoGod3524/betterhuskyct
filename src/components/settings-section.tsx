"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Monitor, Moon, RefreshCw, Sun } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { ConnectSection } from "@/components/connect-section";
import { openSyncCenter } from "@/components/sync-center";
import { useTheme } from "@/components/use-theme";
import { BACKGROUND_CHANGED, NO_ANSWER_MS, parseBackgroundStatus, requestBackground, type BackgroundStatus } from "@/lib/background-sync";
import { CHANGE_KINDS } from "@/lib/changes";
import { EXTENSION_INSTALL_URL } from "@/lib/helper";
import { t, type Locale, type TranslationKey } from "@/lib/i18n";
import type { Theme } from "@/lib/theme";

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">{title}</h2>
      <div className="card divide-y divide-[var(--line)]">{children}</div>
    </section>
  );
}

function Row({ title, body, children }: { title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        {body ? <div className="mt-0.5 max-w-md text-xs leading-5 text-[var(--muted)]">{body}</div> : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string; icon?: ReactNode }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-[var(--subtle)] p-0.5 text-sm font-medium">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
            value === option.value ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"
          }`}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, label, disabled = false, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition disabled:opacity-50 ${on ? "bg-[var(--blue)]" : "bg-[var(--line-strong)]"}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-[var(--surface)] shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`} />
    </button>
  );
}

/** The extension's own settings, read and changed through its relay; null while it does not answer. */
function useExtension() {
  const [status, setStatus] = useState<BackgroundStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<"permission" | "failed" | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void requestBackground("status")
        .then((value) => {
          if (alive) setStatus(parseBackgroundStatus(value));
        })
        .catch(() => {
          if (alive) setStatus(null);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    refresh();
    // Say "not connected" early; a late answer still replaces it.
    const patience = window.setTimeout(() => { if (alive) setLoading(false); }, NO_ANSWER_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener(BACKGROUND_CHANGED, refresh);
    return () => {
      alive = false;
      window.clearTimeout(patience);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(BACKGROUND_CHANGED, refresh);
    };
  }, []);

  async function save(patch: Record<string, unknown>) {
    setProblem(null);
    try {
      const response = await requestBackground("settings", patch);
      const next = parseBackgroundStatus(response);
      if (next) {
        setStatus(next);
        return;
      }
      // Notifications need the browser's permission, which only the extension itself can ask for.
      setProblem((response as { reason?: string } | null)?.reason === "permission" ? "permission" : "failed");
    } catch {
      setProblem("failed");
    }
  }

  return { status, loading, problem, save };
}

/** Everything this browser remembers about how the app looks and behaves, in one place. */
export function SettingsSection() {
  const { locale, changeLocale, remindersEnabled, toggleReminders, hasSavedImport, clearSavedData } = useCalendar();
  const [theme, chooseTheme] = useTheme();
  const extension = useExtension();
  const themes: Theme[] = ["system", "light", "dark"];
  const settings = extension.status?.settings ?? null;

  function chooseLocale(next: Locale) {
    changeLocale(next);
    // The extension's notifications speak the app's language unless told otherwise.
    if (extension.status) void extension.save({ locale: next });
  }

  return (
    <section className="mt-6 max-w-3xl" aria-labelledby="settings-heading">
      <h1 id="settings-heading" className="font-display text-2xl font-semibold">{t(locale, "nav.settings")}</h1>
      <p className="mt-1.5 text-sm text-[var(--muted)]">{t(locale, "settings.intro")}</p>

      <Card title={t(locale, "settings.appearance")}>
        <Row title={t(locale, "language.label")}>
          <Choice<Locale>
            label={t(locale, "language.label")}
            value={locale}
            onChange={chooseLocale}
            options={[
              { value: "en", label: t(locale, "language.english") },
              { value: "zh-CN", label: t(locale, "language.chinese") },
            ]}
          />
        </Row>
        <Row title={t(locale, "settings.theme")}>
          <Choice<Theme>
            label={t(locale, "settings.theme")}
            value={theme}
            onChange={chooseTheme}
            options={themes.map((value) => {
              const Icon = THEME_ICONS[value];
              return { value, label: t(locale, `settings.theme.${value}` as TranslationKey), icon: <Icon size={14} aria-hidden /> };
            })}
          />
        </Row>
      </Card>

      <Card title={t(locale, "settings.syncing")}>
        {extension.loading ? (
          <Row title={t(locale, "settings.extension")} body={t(locale, "common.loading")} />
        ) : !settings ? (
          <Row
            title={t(locale, "settings.extension")}
            body={
              <>
                {t(locale, "settings.noExtension")}{" "}
                <a href={EXTENSION_INSTALL_URL} className="tap-link font-semibold text-[var(--link)] hover:underline">
                  {t(locale, "background.installHelp")}
                </a>
              </>
            }
          />
        ) : (
          <>
            <Row title={t(locale, "settings.autoCheck")} body={t(locale, "settings.autoCheckBody")}>
              <Switch on={settings.enabled} label={t(locale, "settings.autoCheck")} onChange={(next) => void extension.save({ enabled: next })} />
            </Row>
            <Row
              title={t(locale, "settings.notifications")}
              body={
                <>
                  {t(locale, "settings.notificationsBody")}
                  {extension.problem === "permission" ? (
                    <span className="mt-1 block text-[var(--warning)]">
                      {t(locale, "settings.notificationsPermission")}{" "}
                      <button type="button" onClick={() => void requestBackground("open-settings").catch(() => undefined)} className="tap-link font-semibold text-[var(--link)] hover:underline">
                        {t(locale, "settings.openExtension")}
                      </button>
                    </span>
                  ) : null}
                </>
              }
            >
              <Switch on={settings.notifications} label={t(locale, "settings.notifications")} onChange={(next) => void extension.save({ notifications: next })} />
            </Row>
            {settings.notifications ? (
              <div className="px-4 py-4 sm:px-5">
                <p className="text-sm font-semibold">{t(locale, "settings.notifyAbout")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CHANGE_KINDS.map((kind) => {
                    const on = settings.kinds[kind] !== false;
                    return (
                      <button
                        key={kind}
                        type="button"
                        aria-pressed={on}
                        onClick={() => void extension.save({ kinds: { [kind]: !on } })}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          on ? "border-[var(--blue)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]"
                        }`}
                      >
                        {t(locale, `changes.kind.${kind}` as TranslationKey)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </>
        )}
        {extension.problem === "failed" ? <p role="alert" className="px-4 py-3 text-xs text-[var(--danger)] sm:px-5">{t(locale, "background.failed")}</p> : null}
        <Row title={t(locale, "settings.reminders")} body={t(locale, "settings.remindersBody")}>
          <Switch on={remindersEnabled} label={t(locale, "settings.reminders")} onChange={() => void toggleReminders()} />
        </Row>
        <Row title={t(locale, "settings.sync")} body={t(locale, "settings.syncBody")}>
          <button type="button" onClick={openSyncCenter} className="btn btn-quiet">
            <RefreshCw size={15} aria-hidden />
            {t(locale, "settings.syncOpen")}
          </button>
        </Row>
      </Card>

      <ConnectSection />

      {hasSavedImport ? (
        <Card title={t(locale, "settings.data")}>
          <Row title={t(locale, "actions.clearSavedData")} body={t(locale, "backup.clearBody")}>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                if (window.confirm(t(locale, "backup.clearConfirm"))) void clearSavedData();
              }}
            >
              {t(locale, "actions.clearSavedData")}
            </button>
          </Row>
        </Card>
      ) : null}
    </section>
  );
}
