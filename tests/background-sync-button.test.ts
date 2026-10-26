import assert from "node:assert/strict";
import { after, test } from "node:test";

import { BACKGROUND_PROTOCOL, type BackgroundStatus } from "../src/lib/background-sync.ts";
import { EDGE_ADDONS_URL, EXTENSION_INSTALL_URL } from "../src/lib/helper.ts";
import { HUSKYCT_URL } from "../src/lib/helper-sync.ts";
import { BRIDGE_CONTROL } from "../src/lib/helper-bridge.ts";
import { LOCALE_STORAGE_KEY, t, type Locale } from "../src/lib/i18n.ts";
import { installDom } from "./support/dom.ts";

const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BackgroundSyncButton } = await import("../src/components/background-sync-button.tsx");
const { CalendarProvider } = await import("../src/components/calendar-provider.tsx");
const { window } = dom;
after(() => dom.uninstall());

const status = (fields: Partial<BackgroundStatus> = {}): BackgroundStatus => ({
  ok: true, settings: { enabled: true, notifications: false, locale: null, kinds: {} },
  lastAttempt: null, lastSuccess: "2026-10-18T12:00:00.000Z", needsLogin: false,
  lastError: null, running: false, pending: 0, cachedAt: null, ...fields,
});

async function render(initial: unknown, { browser = "edge", locale = "en", refuse = false, pageHelper = false }: { browser?: "edge" | "chrome" | "mobile"; locale?: Locale; refuse?: boolean; pageHelper?: boolean } = {}) {
  window.localStorage.clear();
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: browser === "mobile" ? "Mozilla/5.0 (iPhone; Mobile)" : `Mozilla/5.0 (Windows NT 10.0) Chrome/155.0${browser === "edge" ? " Edg/155.0" : ""}` });
  const originalPost = window.postMessage;
  const originalOpen = window.open;
  let current = initial;
  let available = true;
  let opened = 0;
  const requests: string[] = [];
  const unanswered: string[] = [];
  window.open = (() => { opened++; return null; }) as typeof window.open;
  window.postMessage = ((message: { protocol?: string; target?: string; kind?: string; requestId?: string }) => {
    if (pageHelper && message.protocol === BRIDGE_CONTROL && message.kind === "ping") {
      window.dispatchEvent(new window.MessageEvent("message", { origin: window.location.origin, source: window as never,
        data: { protocol: BRIDGE_CONTROL, kind: "pong", version: "2.2.1" } }));
    }
    if (message.protocol !== BACKGROUND_PROTOCOL || message.target !== "relay") return;
    requests.push(message.kind!);
    if (!available) { unanswered.push(message.requestId!); return; }
    if (message.kind === "run-now" && !refuse && current) current = { ...current as BackgroundStatus, running: true };
    const response = message.kind === "status" ? current : { ok: !refuse };
    window.dispatchEvent(new window.MessageEvent("message", { origin: window.location.origin, source: window as never,
      data: { protocol: BACKGROUND_PROTOCOL, target: "app", kind: "response", requestId: message.requestId, response } }));
  }) as typeof window.postMessage;
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(createElement(CalendarProvider, {
    initialNow: "2026-10-18T15:00:00.000Z", children: createElement(BackgroundSyncButton),
  })));
  return {
    requests,
    container,
    text: () => container.textContent ?? "",
    button: () => container.querySelector("button") as unknown as HTMLButtonElement,
    opened: () => opened,
    click: () => act(async () => (container.querySelector("button") as unknown as HTMLButtonElement).click()),
    finish: async (next: unknown) => {
      current = next;
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 2200)); });
    },
    disconnect: async () => {
      available = false;
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 7300)); });
    },
    reconnect: (next: unknown) => { current = next; available = true; },
    focus: () => act(async () => { window.dispatchEvent(new window.Event("focus")); }),
    unmount: async () => {
      await act(async () => root.unmount());
      // Release deliberately dropped fake requests before removing the DOM globals.
      for (const requestId of unanswered) window.dispatchEvent(new window.MessageEvent("message", {
        origin: window.location.origin, source: window as never,
        data: { protocol: BACKGROUND_PROTOCOL, target: "app", kind: "response", requestId, response: null },
      }));
      container.remove();
      window.postMessage = originalPost;
      window.open = originalOpen;
    },
  };
}

test("the home check uses the background relay, polls to completion and never opens a HuskyCT tab", async () => {
  const view = await render(status());
  try {
    assert.ok(view.text().includes(t("en", "background.on")));
    await view.click();
    assert.deepEqual(view.requests, ["status", "run-now", "status"]);
    assert.equal(view.button().disabled, true);
    assert.ok(view.text().includes(t("en", "background.running")));
    await view.finish(status({ lastSuccess: "2026-10-18T15:01:00.000Z" }));
    assert.equal(view.button().disabled, false);
    const at = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date("2026-10-18T15:01:00.000Z"));
    assert.ok(view.text().includes(t("en", "background.lastSuccess", { at })));
    assert.equal(view.opened(), 0);
  } finally { await view.unmount(); }
});

test("a manual check preserves an existing disabled automatic-check setting", async () => {
  const view = await render(status({ settings: { enabled: false, notifications: false, locale: null, kinds: {} } }));
  try {
    assert.ok(view.text().includes(t("en", "background.off")));
    assert.equal(view.button().disabled, false);
    await view.click();
    assert.ok(view.requests.includes("run-now"));
    assert.ok(!view.requests.includes("settings"), "a manual check silently changed the saved automatic setting");
    assert.ok(view.text().includes(t("en", "background.off")));
  } finally { await view.unmount(); }
});

test("a missing extension offers the real Edge listing without claiming automatic checks are on", async () => {
  const view = await render(null);
  try {
    assert.equal(view.container.querySelector("a")?.getAttribute("href"), EDGE_ADDONS_URL);
    assert.ok(view.container.querySelector(`a[href="${EXTENSION_INSTALL_URL}"]`));
    assert.ok(view.container.querySelector('a[href="/materials#manual-sync"]'));
    assert.ok(!view.text().includes(t("en", "background.on")));
    assert.equal(view.opened(), 0);
  } finally { await view.unmount(); }
});

test("Chrome gets the downloadable extension and installation steps", async () => {
  const view = await render(null, { browser: "chrome" });
  try {
    assert.ok(view.container.querySelector('a[href="/betterhuskyct-extension.zip"][download]'));
    assert.ok(view.container.querySelector(`a[href="${EXTENSION_INSTALL_URL}"]`));
  } finally { await view.unmount(); }
});

test("a 2.2.1 page helper is distinguished from the background extension and can reconnect", async () => {
  const view = await render(null, { pageHelper: true, locale: "zh-CN" });
  try {
    assert.ok(view.text().includes(t("zh-CN", "background.pageHelperOnly")));
    assert.ok(!view.text().includes("需要 2.2.1"));
    assert.equal(view.button().textContent, t("zh-CN", "background.reconnect"));
    view.reconnect(status());
    await view.click();
    assert.ok(view.text().includes(t("zh-CN", "background.on")));
    assert.ok(!view.text().includes(t("zh-CN", "background.pageHelperOnly")));
    assert.ok(!view.requests.includes("run-now"), "reconnecting must not start a sync");
  } finally { await view.unmount(); }
});

test("phones keep a working manual sync entry instead of a desktop ZIP", async () => {
  const view = await render(null, { browser: "mobile", locale: "zh-CN" });
  try {
    assert.equal(view.container.querySelector("a")?.getAttribute("href"), "/materials#manual-sync");
    assert.ok(view.text().includes(t("zh-CN", "background.manual")));
    assert.equal(view.container.querySelector('a[href="/betterhuskyct-extension.zip"]'), null);
    assert.ok(view.text().includes(t("zh-CN", "background.manualOnly")));
    assert.ok(!view.text().includes(t("zh-CN", "background.unavailable")));
    assert.ok(!view.text().includes(t("zh-CN", "background.on")));
  } finally { await view.unmount(); }
});

test("an expired login is explained in both languages with a user-controlled sign-in link", async () => {
  for (const locale of ["en", "zh-CN"] as const) {
    const view = await render(status({ needsLogin: true, lastError: "signedout" }), { locale });
    try {
      assert.ok(view.text().includes(t(locale, "background.needsLogin")));
      assert.ok(view.container.querySelector(`a[href="${HUSKYCT_URL}"][target="_blank"]`));
      assert.equal(view.opened(), 0, "the page opened HuskyCT without a user action");
    } finally { await view.unmount(); }
  }
});

test("a failed previous check and a refused new check remain visible", async () => {
  const view = await render(status({ lastError: "failed" }), { refuse: true });
  try {
    assert.ok(view.container.querySelector('[role="alert"]')?.textContent?.includes(t("en", "background.failed")));
    await view.click();
    assert.equal(view.button().disabled, false);
    assert.ok(view.text().includes(t("en", "background.failed")));
  } finally { await view.unmount(); }
});

test("a lost polling response clears stale running state and a recovered status clears its error", async () => {
  const view = await render(status({ running: true }));
  try {
    assert.equal(view.button().disabled, true);
    await view.disconnect();
    assert.ok(view.container.querySelector('[role="alert"]'));
    assert.equal(view.button().disabled, false, "the vanished extension left the check button stuck");
    assert.ok(!view.text().includes(t("en", "background.on")), "the lost bridge still claims automatic checks are on");
    view.reconnect(status({ lastSuccess: "2026-10-18T15:02:00.000Z" }));
    await view.focus();
    assert.equal(view.container.querySelector('[role="alert"]'), null, "a successful status response kept the transport error");
    assert.equal(view.button().disabled, false);
    assert.ok(view.text().includes(t("en", "background.on")));
  } finally { await view.unmount(); }
});

test("after the bridge disappears during a check the button can retry when it returns", async () => {
  const view = await render(status({ running: true }));
  try {
    await view.disconnect();
    assert.equal(view.button().disabled, false);
    view.reconnect(status());
    await view.click();
    assert.ok(view.requests.includes("run-now"));
    assert.equal(view.container.querySelector('[role="alert"]'), null);
    assert.equal(view.button().disabled, true, "the recovered request did not enter its working state");
    assert.equal(view.opened(), 0);
  } finally { await view.unmount(); }
});
