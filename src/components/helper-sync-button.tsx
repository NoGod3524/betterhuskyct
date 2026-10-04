"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import {
  createHelperSync,
  HUSKYCT_TAB_NAME,
  HUSKYCT_URL,
  type HelperSyncState,
  type HuskyctTab,
  type SyncDeps,
} from "@/lib/helper-sync";
import { t, type Locale } from "@/lib/i18n";

/** Opens the HuskyCT tab, or finds the one already open, from the press that is in progress. */
function openHuskyctTab(): HuskyctTab | null {
  const tab = window.open("", HUSKYCT_TAB_NAME);
  if (!tab) return null;
  try {
    // A tab this press just opened is blank. One already on HuskyCT is another origin: reading its
    // address throws, and it is left alone so nothing reloads under the student.
    if (tab.location.href === "about:blank") tab.location.href = HUSKYCT_URL;
  } catch {
    /* already HuskyCT */
  }
  try {
    // The sync runs in that tab without anyone watching it: bring the student back here if the browser allows.
    window.focus();
  } catch {
    /* the browser decides */
  }
  return tab;
}

type Value = { state: HelperSyncState; start: () => void };
const Context = createContext<Value>({ state: { phase: "idle" }, start: () => undefined });

/**
 * Holds the one sync in progress for every Sync button on the page, and listens for what the helper
 * says about it. `deps` is for tests; the app uses the real window.
 */
export function HelperSyncProvider({ children, deps }: { children: ReactNode; deps?: Partial<SyncDeps> }) {
  const [state, setState] = useState<HelperSyncState>({ phase: "idle" });
  const sync = useRef<ReturnType<typeof createHelperSync> | null>(null);
  if (sync.current === null) {
    sync.current = createHelperSync({
      open: deps?.open ?? openHuskyctTab,
      schedule: deps?.schedule ?? ((run, ms) => {
        const id = window.setTimeout(run, ms);
        return () => window.clearTimeout(id);
      }),
      now: deps?.now ?? (() => Date.now()),
      onChange: setState,
    });
  }

  useEffect(() => {
    const listener = (event: MessageEvent) => sync.current?.receive({ origin: event.origin, data: event.data, source: event.source });
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  const start = useCallback(() => sync.current?.start(), []);
  const value = useMemo(() => ({ state, start }), [state, start]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** What the button says about how the sync is going, in the reader's language. */
export function syncStatusText(locale: Locale, state: HelperSyncState): string {
  switch (state.phase) {
    case "idle":
      return "";
    case "blocked":
      return t(locale, "helpersync.blocked");
    case "waiting":
      return t(locale, "helpersync.waiting");
    case "syncing":
      return state.index > 0 && state.course
        ? t(locale, "helpersync.syncingCourse", { course: state.course, index: state.index, total: state.total })
        : t(locale, "helpersync.syncing");
    case "done": {
      const read = t(locale, "helpersync.done", { courses: state.courses, announcements: state.announcements, items: state.gradeItems });
      const skipped = state.skipped.length ? t(locale, "helpersync.skipped", { courses: state.skipped.join(", ") }) : "";
      return read + skipped + (state.sent ? "" : t(locale, "helpersync.partial"));
    }
    case "nodata":
      return t(locale, "helpersync.nodata");
    case "failed":
      return t(locale, state.reason === "stalled" ? "helpersync.stalled" : state.reason === "closed" ? "helpersync.closed" : "helpersync.noanswer");
  }
}

/**
 * The Sync button: it opens HuskyCT in another tab, where the helper reads announcements and grades
 * in the background, and the result comes back here. `big` is the one on the overview; `compact`
 * sits in the header, and shares the same sync.
 */
export function HelperSyncButton({ variant }: { variant: "big" | "compact" }) {
  const { locale } = useCalendar();
  const { state, start } = useContext(Context);
  const working = state.phase === "waiting" || state.phase === "syncing";
  const text = syncStatusText(locale, state);
  const failed = state.phase === "failed" || state.phase === "blocked" || state.phase === "nodata";

  const icon = working ? <LoaderCircle size={variant === "big" ? 20 : 15} className="animate-spin" aria-hidden /> : <RefreshCw size={variant === "big" ? 20 : 15} aria-hidden />;

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={start}
        disabled={working}
        title={text || t(locale, "helpersync.hint")}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--blue)] px-3.5 text-xs font-semibold text-white shadow-[0_6px_16px_rgba(35,104,200,0.22)] transition hover:bg-[var(--c-1857aa)] disabled:cursor-wait disabled:opacity-70"
      >
        {icon}
        <span className="hidden sm:inline">{t(locale, working ? "helpersync.working" : "helpersync.button")}</span>
      </button>
    );
  }

  return (
    <div className="mt-5 max-w-xl">
      <button
        type="button"
        onClick={start}
        disabled={working}
        className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-[var(--blue)] px-6 text-base font-semibold text-white shadow-[0_12px_30px_rgba(35,104,200,0.28)] transition hover:bg-[var(--c-1857aa)] disabled:cursor-wait disabled:opacity-80 sm:w-auto"
      >
        {icon}
        {t(locale, working ? "helpersync.working" : "helpersync.button")}
      </button>
      <p role="status" className={`mt-2 text-sm ${failed ? "text-[var(--c-9f3527)]" : "text-[var(--muted)]"}`}>
        {text || t(locale, "helpersync.hint")}
        {state.phase === "failed" && state.reason === "noanswer" ? (
          <>
            {" "}
            <Link href="/helper" className="font-semibold text-[var(--link)] hover:underline">
              {t(locale, "helpersync.helperLink")}
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
