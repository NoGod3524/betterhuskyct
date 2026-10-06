import type { HuskyctTab } from "./helper-sync.ts";
import { HUSKYCT_ORIGINS } from "./materials.ts";

/**
 * The helper's bridge, as BetterHuskyCT sees it.
 *
 * From 1.11.0 the helper also runs on BetterHuskyCT. There it can open HuskyCT in a background
 * tab and carry messages to and from it through the userscript manager, so a sync runs with the
 * student never leaving this page. To this page the bridge is one more window to post to: what
 * it posts goes to HuskyCT, and what HuskyCT says comes back here as a message from this window
 * itself, wrapped so it cannot be mistaken for anything else.
 *
 * Without the bridge (an older helper, or none) the page opens HuskyCT in front, as it did.
 */
export const BRIDGE_CONTROL = "betterhuskyct/bridge@1";
export const BRIDGE_OUT = "betterhuskyct/bridge-out@1";
export const BRIDGE_IN = "betterhuskyct/bridge-in@1";

/** How long the helper on this page has to answer a ping before the bridge is taken to be absent. */
export const PING_TIMEOUT_MS = 1500;

type BridgeWindow = Pick<Window, "postMessage" | "addEventListener" | "removeEventListener"> & { location: { origin: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const tabs = new WeakMap<object, HuskyctTab>();

/**
 * The HuskyCT tab behind the bridge: the same object every time for a window, since the sync
 * accepts messages only from the tab it asked.
 */
export function bridgeTab(win: BridgeWindow): HuskyctTab {
  let tab = tabs.get(win);
  if (!tab) {
    tab = {
      background: true,
      postMessage: (data: unknown) => win.postMessage({ protocol: BRIDGE_OUT, data }, win.location.origin),
    };
    tabs.set(win, tab);
  }
  return tab;
}

export type HelperMessage = { origin: string; data: unknown; source: unknown };

/**
 * A message event as the helper's receivers take it. One the bridge brought back from HuskyCT is
 * unwrapped: it counts as HuskyCT's, answered through the bridge. Only this window can have posted
 * it, so only this page's own code — or the helper running on it — could have.
 */
export function helperMessage(event: { origin: string; data: unknown; source: unknown }, win: BridgeWindow): HelperMessage {
  const data = event.data;
  if (
    event.source === (win as unknown) &&
    event.origin === win.location.origin &&
    isRecord(data) &&
    data.protocol === BRIDGE_IN &&
    typeof data.origin === "string" &&
    HUSKYCT_ORIGINS.has(data.origin)
  ) {
    return { origin: data.origin, data: data.data, source: bridgeTab(win) };
  }
  return { origin: event.origin, data: event.data, source: event.source };
}

/**
 * Whether a message is the helper on this page saying it is there: its answer to a ping, or what
 * it says on its own as it starts, for a page that pinged before the helper was listening.
 */
export function isBridgeHello(event: { origin: string; data: unknown; source: unknown }, win: BridgeWindow): boolean {
  if (event.source !== (win as unknown) || event.origin !== win.location.origin) return false;
  return isRecord(event.data) && event.data.protocol === BRIDGE_CONTROL && event.data.kind === "pong";
}

/** Whether the helper on this page can reach HuskyCT behind it. */
export function pingBridge(win: BridgeWindow, timeoutMs = PING_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const listen = (event: Event) => {
      if (isBridgeHello(event as MessageEvent, win)) finish(true);
    };
    const finish = (found: boolean) => {
      win.removeEventListener("message", listen);
      clearTimeout(timer);
      resolve(found);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    win.addEventListener("message", listen);
    win.postMessage({ protocol: BRIDGE_CONTROL, kind: "ping" }, win.location.origin);
  });
}

/** Asks the helper to make sure a HuskyCT tab is open, behind this one, and returns the tab to post to. */
export function openThroughBridge(win: BridgeWindow): HuskyctTab {
  win.postMessage({ protocol: BRIDGE_CONTROL, kind: "open" }, win.location.origin);
  return bridgeTab(win);
}
