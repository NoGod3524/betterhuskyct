"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { helperMessage, isBridgeHello, openThroughBridge, pingBridge } from "@/lib/helper-bridge";
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

/** HuskyCT in front, for signing in: a sync behind this page cannot show the sign-in page. */
function showHuskyct() {
  window.open(HUSKYCT_URL, HUSKYCT_TAB_NAME);
}

/**
 * Holds the one sync in progress for every Sync button on the page, and listens for what the helper
 * says about it. `deps` is for tests; the app uses the real window.
 *
 * When the helper runs on this page too (1.11.0 and later) the sync goes through its bridge: HuskyCT
 * opens behind this tab, or an open HuskyCT tab is used, and the student stays here. Otherwise
 * HuskyCT opens in front, as it did.
 */
export function HelperSyncProvider({ children, deps }: { children: ReactNode; deps?: Partial<SyncDeps> }) {
  const [state, setState] = useState<HelperSyncState>({ phase: "idle" });
  const sync = useRef<ReturnType<typeof createHelperSync> | null>(null);
  // Whether the helper on this page can reach HuskyCT behind it; found out once the page has loaded.
  const [bridge] = useState(() => ({ found: false }));
  if (sync.current === null) {
    sync.current = createHelperSync({
      open: deps?.open ?? (() => (bridge.found ? openThroughBridge(window) : openHuskyctTab())),
      schedule: deps?.schedule ?? ((run, ms) => {
        const id = window.setTimeout(run, ms);
        return () => window.clearTimeout(id);
      }),
      now: deps?.now ?? (() => Date.now()),
      onChange: setState,
    });
  }

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      // A helper that started after the ping says so itself.
      if (isBridgeHello(event, window)) bridge.found = true;
      sync.current?.receive(helperMessage(event, window));
    };
    window.addEventListener("message", listener);
    let live = true;
    // Asked once, for a helper that was there before this page's own code ran. One that the
    // userscript manager starts later announces itself, and the listener above hears it.
    if (!deps?.open) {
      void pingBridge(window).then((found) => {
        if (live && found) bridge.found = true;
      });
    }
    return () => {
      live = false;
      window.removeEventListener("message", listener);
    };
  }, [deps?.open, bridge]);

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
      if (state.files && state.course) return t(locale, "helpersync.syncingFile", { name: state.course, index: state.index, total: state.total });
      return state.index > 0 && state.course
        ? t(locale, "helpersync.syncingCourse", { course: state.course, index: state.index, total: state.total })
        : t(locale, "helpersync.syncing");
    case "done": {
      const read =
        t(locale, "helpersync.done", { courses: state.courses, announcements: state.announcements, items: state.gradeItems }) +
        (state.files > 0 ? t(locale, "helpersync.files", { files: state.files }) : "");
      const skipped = state.skipped.length ? t(locale, "helpersync.skipped", { courses: state.skipped.join(", ") }) : "";
      return read + skipped + (state.sent ? "" : t(locale, "helpersync.partial"));
    }
    case "nodata": {
      if (!state.why) return t(locale, "helpersync.nodata");
      const step = t(locale, `helpersync.step.${state.why.step}`);
      return t(locale, "helpersync.nodata") + t(locale, "helpersync.nodataWhy", { why: state.why.detail ? t(locale, "helpersync.whyDetail", { step, detail: state.why.detail }) : step });
    }
    case "failed":
      return t(
        locale,
        state.reason === "stalled"
          ? "helpersync.stalled"
          : state.reason === "closed"
            ? "helpersync.closed"
            : state.reason === "signin"
              ? "helpersync.signin"
              : state.reason === "signedout"
                ? "helpersync.signedout"
                : "helpersync.noanswer",
      );
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

  const icon = working ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />;

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={start}
        disabled={working}
        title={text || t(locale, "helpersync.hint")}
        className="btn btn-primary"
      >
        {icon}
        <span className="hidden sm:inline">{t(locale, working ? "helpersync.working" : "helpersync.button")}</span>
      </button>
    );
  }

  return (
    <div className="shrink-0 sm:max-w-xs sm:text-right">
      <button
        type="button"
        onClick={start}
        disabled={working}
        className="btn btn-primary h-9 w-full px-4 text-sm sm:w-auto"
      >
        {icon}
        {t(locale, working ? "helpersync.working" : "helpersync.button")}
      </button>
      <p role="status" className={`mt-2 text-xs leading-5 ${failed ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>
        {text || t(locale, "helpersync.hint")}
        {state.phase === "failed" && (state.reason === "signin" || state.reason === "signedout") ? (
          <>
            {" "}
            <button type="button" onClick={showHuskyct} className="font-semibold text-[var(--link)] hover:underline">
              {t(locale, "helpersync.openHuskyct")}
            </button>
          </>
        ) : null}
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
