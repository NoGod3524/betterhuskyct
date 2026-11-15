"use client";

import type { ReactNode } from "react";
import { Monitor, Moon, RefreshCw, Sun } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { openSyncCenter } from "@/components/sync-center";
import { useTheme } from "@/components/use-theme";
import { t, type Locale, type TranslationKey } from "@/lib/i18n";
import type { Theme } from "@/lib/theme";

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

function Row({ title, body, children }: { title: string; body?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        {body ? <p className="mt-0.5 max-w-md text-xs leading-5 text-[var(--muted)]">{body}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
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

/** Everything this browser remembers about how the app looks and behaves, in one place. */
export function SettingsSection() {
  const { locale, changeLocale, remindersEnabled, toggleReminders } = useCalendar();
  const [theme, chooseTheme] = useTheme();
  const themes: Theme[] = ["system", "light", "dark"];

  return (
    <section className="mt-8 max-w-3xl" aria-labelledby="settings-heading">
      <h1 id="settings-heading" className="font-display text-2xl font-semibold">{t(locale, "nav.settings")}</h1>
      <p className="mt-1.5 text-sm text-[var(--muted)]">{t(locale, "settings.intro")}</p>

      <div className="card mt-6 divide-y divide-[var(--line)]">
        <Row title={t(locale, "language.label")}>
          <Choice<Locale>
            label={t(locale, "language.label")}
            value={locale}
            onChange={changeLocale}
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
        <Row title={t(locale, "settings.reminders")} body={t(locale, "settings.remindersBody")}>
          <button
            type="button"
            role="switch"
            aria-checked={remindersEnabled}
            aria-label={t(locale, "settings.reminders")}
            onClick={() => {
              void toggleReminders();
            }}
            className={`relative h-6 w-11 rounded-full transition ${remindersEnabled ? "bg-[var(--blue)]" : "bg-[var(--line-strong)]"}`}
          >
            <span className={`absolute top-0.5 size-5 rounded-full bg-[var(--surface)] shadow transition-all ${remindersEnabled ? "left-[1.375rem]" : "left-0.5"}`} />
          </button>
        </Row>
        <Row title={t(locale, "settings.sync")} body={t(locale, "settings.syncBody")}>
          <button type="button" onClick={openSyncCenter} className="btn btn-quiet">
            <RefreshCw size={15} aria-hidden />
            {t(locale, "settings.syncOpen")}
          </button>
        </Row>
      </div>
    </section>
  );
}
