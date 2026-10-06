import { HUSKYCT_ORIGINS } from "./materials.ts";

/**
 * BetterHuskyCT's Sync button, which asks the helper in a HuskyCT tab to read HuskyCT in the
 * background.
 *
 * Only a press may open a tab, so the press opens (or finds) a tab named "huskyct" and the helper in
 * it does the reading. The helper loads some time after the tab opens, and a student who is signed
 * out has to sign in first, so the request is repeated until the helper answers. What the helper
 * reads comes back over the channels the Grades page and the calendar already listen on; this only
 * follows how it is going, for the button.
 *
 * Everything from the tab is untrusted until it has come from HuskyCT's own origin, from the very
 * tab this opened, and is shaped as expected.
 */
export const HELPER_SYNC_PROTOCOL = "betterhuskyct/sync@1";
export const HUSKYCT_URL = "https://lms.uconn.edu/ultra/course";
export const HUSKYCT_TARGET_ORIGIN = "https://lms.uconn.edu";
export const HUSKYCT_TAB_NAME = "huskyct";

/** How often the request is repeated while the helper has not answered, and how long to wait for it (a sign-in takes a while). */
export const RETRY_EVERY_MS = 1000;
export const GIVE_UP_AFTER_MS = 90_000;
/**
 * A HuskyCT tab opened behind this one has nobody watching it: if it has not answered in this
 * long, it is most likely on the sign-in page, and the student is told to sign in.
 */
export const BACKGROUND_GIVE_UP_MS = 25_000;
/** Once the helper has answered, how long it may go without a word before the sync is called stalled. */
export const STALL_AFTER_MS = 120_000;

export type SyncSummary = {
  courses: number;
  announcements: number;
  gradeItems: number;
  skipped: string[];
  /** Whether everything the helper read arrived here. */
  sent: boolean;
};

export type HelperSyncState =
  | { phase: "idle" }
  /** The browser would not open the HuskyCT tab. */
  | { phase: "blocked" }
  /** The tab is open and has not answered yet. */
  | { phase: "waiting" }
  | { phase: "syncing"; course: string | null; index: number; total: number }
  | ({ phase: "done" } & SyncSummary)
  /** The helper answered but could read nothing this way; `why` is the step it stopped at and what HuskyCT said. */
  | { phase: "nodata"; why?: NoDataWhy }
  /** `signedout`: HuskyCT told the helper the student is signed out. `signin`: a tab behind this one never answered, most likely at sign-in. */
  | { phase: "failed"; reason: "noanswer" | "stalled" | "closed" | "signin" | "signedout" };

/** Where a sync that read nothing stopped: the course list, every course's data, no current course, or an error in the helper. */
export type NoDataStep = "courses" | "read" | "nocourses" | "error";
export type NoDataWhy = { step: NoDataStep; detail: string | null };

export type SyncMessage =
  | { kind: "ack"; state: "started" | "busy" }
  | { kind: "progress"; course: string | null; index: number; total: number }
  | ({ kind: "done"; ok: boolean; reason?: NoDataStep | "signedout"; detail?: string | null } & SyncSummary);

const NO_DATA_STEPS = new Set<string>(["courses", "read", "nocourses", "error", "signedout"]);

/** What HuskyCT said, as the helper put it, cut to something short and plain enough to show. */
function detailOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const plain = value.replace(/[^\w .:/-]/g, "").trim().slice(0, 90);
  return plain || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
}

/** A message from the helper, or null if it is not one this understands. */
export function parseSyncMessage(data: unknown): SyncMessage | null {
  if (!isRecord(data) || data.protocol !== HELPER_SYNC_PROTOCOL) return null;
  if (data.kind === "ack") {
    return data.state === "started" || data.state === "busy" ? { kind: "ack", state: data.state } : null;
  }
  if (data.kind === "progress") {
    const index = count(data.index);
    const total = count(data.total);
    if (index === null || total === null) return null;
    return { kind: "progress", course: typeof data.course === "string" ? data.course.slice(0, 80) : null, index, total };
  }
  if (data.kind === "done") {
    const courses = count(data.courses);
    const announcements = count(data.announcements);
    const gradeItems = count(data.gradeItems);
    if (typeof data.ok !== "boolean" || courses === null || announcements === null || gradeItems === null) return null;
    const skipped = Array.isArray(data.skipped) ? data.skipped.filter((code): code is string => typeof code === "string").slice(0, 20).map((code) => code.slice(0, 40)) : [];
    const done: SyncMessage = { kind: "done", ok: data.ok, courses, announcements, gradeItems, skipped, sent: data.sent === true };
    if (!data.ok && typeof data.reason === "string" && NO_DATA_STEPS.has(data.reason)) {
      done.reason = data.reason as NoDataStep | "signedout";
      done.detail = detailOf(data.detail);
    }
    return done;
  }
  return null;
}

/**
 * What this needs of the HuskyCT tab: somewhere to post to, whether it has been closed, and
 * whether it is a tab behind this one that the helper's bridge reaches.
 */
export type HuskyctTab = { postMessage: (message: unknown, targetOrigin: string) => void; closed?: boolean; background?: boolean };

export type SyncDeps = {
  /** Opens the HuskyCT tab, or finds the one already open. Null if the browser refuses. */
  open: () => HuskyctTab | null;
  /** Calls `run` after `ms`; the result cancels it. */
  schedule: (run: () => void, ms: number) => () => void;
  now: () => number;
  onChange: (state: HelperSyncState) => void;
};

export function createHelperSync(deps: SyncDeps) {
  let state: HelperSyncState = { phase: "idle" };
  let tab: HuskyctTab | null = null;
  let cancel: (() => void) | null = null;
  let startedAt = 0;

  const set = (next: HelperSyncState) => {
    state = next;
    deps.onChange(state);
  };
  const stopTimer = () => {
    cancel?.();
    cancel = null;
  };
  const busy = () => state.phase === "waiting" || state.phase === "syncing";

  /** After the helper has answered: a sync that goes quiet for too long is called stalled. */
  function watch() {
    stopTimer();
    cancel = deps.schedule(() => {
      cancel = null;
      if (state.phase === "syncing") set({ phase: "failed", reason: "stalled" });
    }, STALL_AFTER_MS);
  }

  /** Until the helper answers: ask again, and give up if the tab is shut or it never does. */
  function ask() {
    if (state.phase !== "waiting" || !tab) return;
    if (tab.closed) {
      set({ phase: "failed", reason: "closed" });
      return;
    }
    if (deps.now() - startedAt > (tab.background ? BACKGROUND_GIVE_UP_MS : GIVE_UP_AFTER_MS)) {
      set({ phase: "failed", reason: tab.background ? "signin" : "noanswer" });
      return;
    }
    try {
      tab.postMessage({ protocol: HELPER_SYNC_PROTOCOL, kind: "request" }, HUSKYCT_TARGET_ORIGIN);
    } catch {
      /* the tab is not ready to be written to yet */
    }
    cancel = deps.schedule(ask, RETRY_EVERY_MS);
  }

  return {
    get state() {
      return state;
    },
    /** From a press. A sync already going is left alone. */
    start() {
      if (busy()) return;
      stopTimer();
      tab = deps.open();
      if (!tab) {
        set({ phase: "blocked" });
        return;
      }
      startedAt = deps.now();
      set({ phase: "waiting" });
      ask();
    },
    /** From the window's message events. */
    receive(event: { origin: string; data: unknown; source: unknown }) {
      if (!HUSKYCT_ORIGINS.has(event.origin) || !busy()) return;
      // Only the tab this opened: another HuskyCT window cannot speak for it.
      if (tab && event.source && event.source !== tab) return;
      const message = parseSyncMessage(event.data);
      if (!message) return;

      if (message.kind === "ack") {
        // Busy: the helper is in the middle of a sync of its own, which will not report to this tab.
        // Keep asking, and it will take this request once it is free.
        if (message.state === "busy") return;
        set({ phase: "syncing", course: null, index: 0, total: 0 });
        watch();
      } else if (message.kind === "progress") {
        set({ phase: "syncing", course: message.course, index: message.index, total: message.total });
        watch();
      } else {
        stopTimer();
        if (message.ok) {
          set({ phase: "done", courses: message.courses, announcements: message.announcements, gradeItems: message.gradeItems, skipped: message.skipped, sent: message.sent });
        } else if (message.reason === "signedout") {
          set({ phase: "failed", reason: "signedout" });
        } else {
          set(message.reason ? { phase: "nodata", why: { step: message.reason, detail: message.detail ?? null } } : { phase: "nodata" });
        }
      }
    },
    /** Puts the button back to rest, for a result that has been read. */
    dismiss() {
      if (busy()) return;
      set({ phase: "idle" });
    },
  };
}
