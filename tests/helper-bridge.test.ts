import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

import { BRIDGE_IN, bridgeTab, helperMessage, isBridgeHello, openThroughBridge, pingBridge } from "../src/lib/helper-bridge.ts";
import { BACKGROUND_GIVE_UP_MS, createHelperSync, GIVE_UP_AFTER_MS, type HelperSyncState } from "../src/lib/helper-sync.ts";
import { onlyAtHuskyct } from "./support/huskyct-fetch.ts";

/**
 * BetterHuskyCT's side of the helper's bridge, against the real helper: one copy on a
 * BetterHuskyCT page and one on a HuskyCT page, sharing a stand-in for the userscript manager.
 * The sync controller and the unwrapping are the app's own; only the receivers are stand-ins.
 */
const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");
const BHC = "https://betterhuskyct.vercel.app";

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

function userscriptManager() {
  const values = new Map<string, unknown>();
  const listeners: Array<{ key: string; run: (...args: unknown[]) => void }> = [];
  const tabs: Array<{ url: string; options: Record<string, unknown>; closed: boolean }> = [];
  const clone = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  return {
    tabs,
    values,
    gm: {
      GM_getValue: (key: string, fallback: unknown) => (values.has(key) ? clone(values.get(key)) : fallback),
      GM_setValue: (key: string, value: unknown) => {
        const old = values.get(key);
        values.set(key, clone(value));
        for (const listener of listeners) if (listener.key === key) setTimeout(() => listener.run(key, clone(old), clone(value), true), 0);
      },
      GM_addValueChangeListener: (key: string, run: (...args: unknown[]) => void) => listeners.push({ key, run }),
      GM_openInTab: (url: string, options: Record<string, unknown>) => {
        const tab = { url, options, closed: false, close: () => (tab.closed = true) };
        tabs.push(tab);
        return tab;
      },
    },
  };
}

function load(url: string, gm?: Record<string, unknown>, fetchImpl?: (path: string) => Promise<Response>, into?: Window) {
  const window = into ?? new Window({ url });
  if (!into) onlyAtHuskyct(window);
  if (!into) windows.push(window);
  window.document.body.innerHTML = "<main></main>";
  (window as unknown as { fetch: unknown }).fetch = fetchImpl ?? (() => Promise.reject(new Error("no network in tests")));
  // The sync that starts on its own as HuskyCT opens would run in the middle of these.
  window.localStorage.setItem("huskypilot.helper.sync.v1", JSON.stringify({ auto: false }));
  const sandbox = {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    Blob,
    CompressionStream,
    Response,
    TextEncoder,
    btoa,
    URL,
    console,
    setTimeout,
    clearTimeout,
    ...(gm ?? {}),
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return window;
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** HuskyCT's own data for one course with one announcement and one graded item. */
function huskyctData(path: string): Promise<Response> {
  if (/\/users\/me\/memberships/.test(path)) {
    return Promise.resolve(
      json({
        paging: { count: 1, nextPage: "" },
        results: [
          {
            courseId: "_203765_1",
            isAvailable: true,
            userHasHidden: false,
            course: { id: "_203765_1", courseId: "1268-MATH-1070Q-SEC010-6521", displayName: "MATH 1070Q", isOrganization: false, isAvailable: true, effectiveAvailability: true },
          },
        ],
      }),
    );
  }
  if (/\/users\/me$/.test(path) || /\/users\/me\?/.test(path)) return Promise.resolve(json({ id: "_99_1" }));
  if (/\/announcements/.test(path)) {
    return Promise.resolve(json({ paging: { count: 1, nextPage: "" }, results: [{ id: "_1_1", title: "Exam 1 is next week", body: { displayText: "<p>Room 101</p>" }, startDateRestriction: "2026-10-01T14:00:00.000Z", isDraft: false }] }));
  }
  if (/\/gradebook\/grades/.test(path)) {
    return Promise.resolve(json({ paging: { count: 1, nextPage: "" }, results: [{ columnId: "_7_1", column: { id: "_7_1", effectiveColumnName: "Quiz 1" }, status: "GRADED", pointsPossible: 10, displayGrade: { score: 9 }, lastAttempt: { status: "COMPLETED" } }] }));
  }
  return Promise.resolve(new Response("{}", { status: 404 }));
}

/** The app's receivers as stand-ins: they answer through whatever window the message came from. */
function receivers(bhc: Window) {
  const delivered: string[] = [];
  bhc.addEventListener("message", ((event: MessageEvent) => {
    const { origin, data, source } = helperMessage(event, bhc as unknown as Window & typeof globalThis);
    if (origin !== "https://lms.uconn.edu" || !data || typeof data !== "object") return;
    const message = data as { protocol: string; kind: string };
    // Course files have a receiver of their own in the tests that send them.
    if (message.protocol === "betterhuskyct/materials@1") return;
    const answer = message.kind === "hello" ? { protocol: message.protocol, kind: "ready" } : ["sync", "grades"].includes(message.kind) ? { protocol: message.protocol, kind: "stored", ok: true } : null;
    if (["sync", "grades"].includes(message.kind)) delivered.push(message.protocol);
    if (answer) (source as { postMessage: (message: unknown, origin: string) => void }).postMessage(answer, origin);
  }) as never);
  return delivered;
}

async function until(check: () => boolean, ms = 8000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function controller(bhc: Window, open = () => openThroughBridge(bhc as unknown as Window & typeof globalThis)) {
  const states: HelperSyncState[] = [];
  const sync = createHelperSync({
    open,
    schedule: (run, ms) => {
      const id = setTimeout(run, ms);
      return () => clearTimeout(id);
    },
    now: () => Date.now(),
    onChange: (state) => states.push(state),
  });
  bhc.addEventListener("message", ((event: MessageEvent) => sync.receive(helperMessage(event, bhc as unknown as Window & typeof globalThis))) as never);
  return { sync, states };
}

test("the page finds the helper's bridge, and a sync through it ends in done, with the reading delivered here", async () => {
  const manager = userscriptManager();
  load("https://lms.uconn.edu/ultra/course", manager.gm, huskyctData);
  const bhc = load(`${BHC}/`, manager.gm);
  const win = bhc as unknown as Window & typeof globalThis;

  assert.equal(await pingBridge(win, 500), true, "the helper on this page was not found");
  const delivered = receivers(bhc);
  const { sync, states } = controller(bhc);

  sync.start();
  await until(() => sync.state.phase === "done");

  assert.equal(manager.tabs.length, 0, "a HuskyCT tab was opened although one was open");
  assert.deepEqual(states.map((state) => state.phase).filter((phase, index, all) => phase !== all[index - 1]), ["waiting", "syncing", "done"]);
  const done = sync.state as Extract<HelperSyncState, { phase: "done" }>;
  assert.equal(done.courses, 1);
  assert.equal(done.sent, true, "what was read did not all arrive");
  assert.deepEqual(delivered, ["betterhuskyct/tasks@1", "betterhuskyct/grades@1"]);
});

test("with no helper on the page there is no bridge, and the page falls back to opening HuskyCT", async () => {
  const bhc = load(`${BHC}/`);
  assert.equal(await pingBridge(bhc as unknown as Window & typeof globalThis, 300), false);
});

test("a tab behind this one that never answers is given up on sooner, and says to sign in", () => {
  let now = 0;
  const timers: Array<{ at: number; run: () => void }> = [];
  const states: HelperSyncState[] = [];
  const make = (background: boolean) =>
    createHelperSync({
      open: () => ({ postMessage: () => undefined, background }),
      schedule: (run, ms) => {
        timers.push({ at: now + ms, run });
        return () => undefined;
      },
      now: () => now,
      onChange: (state) => states.push(state),
    });
  const runUntil = (end: number) => {
    while (timers.length) {
      timers.sort((a, b) => a.at - b.at);
      if (timers[0].at > end) break;
      const timer = timers.shift()!;
      now = timer.at;
      timer.run();
    }
  };

  make(true).start();
  runUntil(BACKGROUND_GIVE_UP_MS + 2000);
  assert.deepEqual(states[states.length - 1], { phase: "failed", reason: "signin" });

  timers.length = 0;
  now = 0;
  make(false).start();
  runUntil(BACKGROUND_GIVE_UP_MS + 2000);
  assert.equal(states[states.length - 1].phase, "waiting", "a tab in front was given up on as soon as one behind");
  runUntil(GIVE_UP_AFTER_MS + 2000);
  assert.deepEqual(states[states.length - 1], { phase: "failed", reason: "noanswer" });
});

test("only a message this window posted, wrapped by the bridge and naming HuskyCT, is taken as HuskyCT's", () => {
  const bhc = load(`${BHC}/`);
  const win = bhc as unknown as Window & typeof globalThis;
  const wrapped = { protocol: BRIDGE_IN, origin: "https://lms.uconn.edu", data: { protocol: "x", kind: "ready" } };

  const own = helperMessage({ origin: BHC, data: wrapped, source: win }, win);
  assert.equal(own.origin, "https://lms.uconn.edu");
  assert.deepEqual(own.data, { protocol: "x", kind: "ready" });
  assert.equal(own.source, bridgeTab(win), "answers would not go back through the bridge");
  assert.equal(bridgeTab(win), bridgeTab(win), "the bridge is not one tab to the sync");

  const elsewhere = { origin: BHC, data: wrapped, source: {} as Window };
  assert.equal(helperMessage(elsewhere, win).origin, BHC, "another window's message was unwrapped");
  assert.equal(helperMessage({ origin: "https://evil.example", data: wrapped, source: win }, win).origin, "https://evil.example");
  assert.equal(helperMessage({ origin: BHC, data: { ...wrapped, origin: "https://evil.example" }, source: win }, win).origin, BHC, "a non-HuskyCT origin was accepted");
});

/** The page's own timers, run this many times faster, so a wait of seconds takes a test a moment. */
function hurry(window: Window, by = 20) {
  const target = window as unknown as { setTimeout: (run: () => void, ms?: number) => unknown };
  const real = target.setTimeout.bind(window);
  target.setTimeout = (run, ms = 0) => real(run, ms / by);
}

test("a helper that starts after the page has asked says it is here unasked", async () => {
  const manager = userscriptManager();
  const bhc = new Window({ url: `${BHC}/` });
  windows.push(bhc);
  const win = bhc as unknown as Window & typeof globalThis;
  hurry(bhc);

  // The page asks before the userscript manager has started the helper: nobody answers.
  assert.equal(await pingBridge(win, 100), false);

  const hellos: unknown[] = [];
  bhc.addEventListener("message", ((event: MessageEvent) => {
    if (isBridgeHello(event, win)) hellos.push(event.data);
  }) as never);
  load(`${BHC}/`, manager.gm, undefined, bhc);
  await until(() => hellos.length >= 1, 2000);
  // Said again once the page has loaded, for a page whose own code was not yet listening.
  (bhc as unknown as { dispatchEvent: (event: unknown) => void }).dispatchEvent(new bhc.Event("load"));
  await until(() => hellos.length >= 2, 2000);
  assert.deepEqual(JSON.parse(JSON.stringify(hellos[0])), { protocol: "betterhuskyct/bridge@1", kind: "pong", version: SOURCE.match(/const VERSION = "([^"]+)"/)?.[1] });

  // Only this window's own pong counts, not one from elsewhere or of another kind.
  const pong = { protocol: "betterhuskyct/bridge@1", kind: "pong" };
  assert.equal(isBridgeHello({ origin: BHC, data: pong, source: win }, win), true);
  assert.equal(isBridgeHello({ origin: "https://evil.example", data: pong, source: win }, win), false);
  assert.equal(isBridgeHello({ origin: BHC, data: pong, source: {} }, win), false);
  assert.equal(isBridgeHello({ origin: BHC, data: { ...pong, kind: "ping" }, source: win }, win), false);
});

test("a HuskyCT tab that closed without saying so is forgotten when it does not answer, and one is opened", async () => {
  const manager = userscriptManager();
  // A tab that was closed but whose last heartbeat is still recent.
  manager.gm.GM_setValue("bridge.huskyctAlive", { "00000000a0-dead00-1": Date.now() });
  const bhc = load(`${BHC}/`, manager.gm, undefined, (() => {
    const window = new Window({ url: `${BHC}/` });
    windows.push(window);
    hurry(window);
    return window;
  })());
  const { sync } = controller(bhc);
  receivers(bhc);

  sync.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(manager.tabs.length, 0, "it did not give the tab that looks alive a moment to answer");

  await until(() => manager.tabs.length === 1, 2000);
  assert.deepEqual(manager.gm.GM_getValue("bridge.huskyctAlive", null), {}, "the closed tab is still taken for alive");

  // The tab it opened loads, and answers.
  load(manager.tabs[0].url, manager.gm, huskyctData);
  await until(() => sync.state.phase === "done");
  assert.equal((sync.state as Extract<HelperSyncState, { phase: "done" }>).courses, 1);
});

test("a HuskyCT tab that is alive and answers is used, and no other is opened", async () => {
  const manager = userscriptManager();
  load("https://lms.uconn.edu/ultra/course", manager.gm, huskyctData);
  const bhcWindow = new Window({ url: `${BHC}/` });
  windows.push(bhcWindow);
  hurry(bhcWindow);
  const bhc = load(`${BHC}/`, manager.gm, undefined, bhcWindow);
  const { sync } = controller(bhc);
  receivers(bhc);

  sync.start();
  await until(() => sync.state.phase === "done");
  // Past the time it waits before opening one anyway.
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(manager.tabs.length, 0, "a second HuskyCT tab was opened beside one that answered");
});

test("a sync carries the course files BetterHuskyCT does not have across the bridge, whole, and leaves no pieces behind", async () => {
  const manager = userscriptManager();
  const file = (n: number) => `/bbcswebdav/pid-${n}-dt-content-rid-${n}_1/xid-${n}_1`;
  // Big enough to go in several pieces, and every byte value, so nothing is lost in the base64.
  const bytes = new Uint8Array(1_300_000).map((_, index) => (index * 7) % 256);
  const huskyct = async (path: string) => {
    if (path.includes("/contents/ROOT/children")) {
      return json({
        paging: { nextPage: "" },
        results: [1, 2].map((n) => ({
          id: `_${n}_9`,
          title: `Notes ${n}.pdf`,
          contentHandler: "resource/x-bb-file",
          visibility: "VISIBLE",
          contentDetail: { "resource/x-bb-file": { file: { permanentUrl: file(n) } } },
        })),
      });
    }
    if (path === file(2)) return new Response(bytes, { status: 200, headers: { "content-type": "application/pdf" } });
    if (path.startsWith("/bbcswebdav/")) throw new Error("a file BetterHuskyCT already had was fetched: " + path);
    return huskyctData(path);
  };
  load("https://lms.uconn.edu/ultra/course", manager.gm, huskyct);
  const bhc = load(`${BHC}/`, manager.gm);
  const win = bhc as unknown as Window & typeof globalThis;
  assert.equal(await pingBridge(win, 500), true);
  receivers(bhc);

  // BetterHuskyCT's Materials receiver as a stand-in: it already has the first file.
  const stored: Array<{ key: string; name: string; type: string; blob: Blob }> = [];
  bhc.addEventListener("message", ((event: MessageEvent) => {
    const { origin, data, source } = helperMessage(event, win);
    const message = data as { protocol?: string; kind?: string; key?: string; name?: string; type?: string; blob?: Blob };
    if (origin !== "https://lms.uconn.edu" || !message || message.protocol !== "betterhuskyct/materials@1") return;
    const reply = (answer: Record<string, unknown>) => (source as { postMessage: (m: unknown, o: string) => void }).postMessage({ protocol: message.protocol, ...answer }, origin);
    if (message.kind === "hello") reply({ kind: "ready", have: [`https://lms.uconn.edu${file(1)}`] });
    if (message.kind === "file") {
      stored.push({ key: message.key!, name: message.name!, type: message.type!, blob: message.blob! });
      reply({ kind: "stored", key: message.key, ok: true });
    }
  }) as never);
  const { sync } = controller(bhc);

  sync.start();
  await until(() => sync.state.phase === "done", 20000);

  const done = sync.state as Extract<HelperSyncState, { phase: "done" }>;
  assert.equal(done.files, 1, "the new file was not counted");
  assert.equal(done.sent, true);
  assert.deepEqual(stored.map((entry) => [entry.key, entry.name, entry.type]), [[`https://lms.uconn.edu${file(2)}`, "Notes 2.pdf", "application/pdf"]]);
  const arrived = new Uint8Array(await stored[0].blob.arrayBuffer());
  assert.equal(arrived.length, bytes.length);
  assert.ok(arrived.every((value, index) => value === bytes[index]), "the file did not arrive as it was sent");
  const pieces = [...manager.values.entries()].filter(([key]) => key.startsWith("bridge.blob."));
  assert.ok(pieces.length >= 3, "the file did not go in pieces");
  assert.deepEqual(pieces.filter(([, value]) => value !== ""), [], "pieces were left in the manager's storage");
});
