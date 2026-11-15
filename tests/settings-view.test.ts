import assert from "node:assert/strict";
import { after, test } from "node:test";

import { BACKGROUND_PROTOCOL, NO_ANSWER_MS, type BackgroundStatus } from "../src/lib/background-sync.ts";
import { LOCALE_STORAGE_KEY, t } from "../src/lib/i18n.ts";
import { installDom } from "./support/dom.ts";

/**
 * The Settings page changes the extension's own settings through its relay, the way its toolbar
 * popup does: these stand in for the extension and record what the page asks of it.
 */
const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SettingsSection } = await import("../src/components/settings-section.tsx");
const { CalendarProvider } = await import("../src/components/calendar-provider.tsx");
const { window } = dom;
after(() => dom.uninstall());

const status = (fields: Partial<BackgroundStatus["settings"]> = {}): BackgroundStatus => ({
  ok: true, settings: { enabled: true, notifications: false, locale: null, kinds: {}, ...fields },
  lastAttempt: null, lastSuccess: null, needsLogin: false, lastError: null, running: false, pending: 0, cachedAt: null,
});

async function render(initial: BackgroundStatus | null, { permission = true, delay = 0 } = {}) {
  window.localStorage.clear();
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
  const originalPost = window.postMessage;
  let current = initial;
  const sent: Array<{ kind: string; settings?: Record<string, unknown> }> = [];
  window.postMessage = ((message: { protocol?: string; target?: string; kind?: string; requestId?: string; settings?: Record<string, unknown> }) => {
    if (message.protocol !== BACKGROUND_PROTOCOL || message.target !== "relay") return;
    sent.push({ kind: message.kind!, settings: message.settings });
    let response: unknown = current;
    if (message.kind === "settings" && current) {
      const patch = message.settings ?? {};
      if (patch.notifications === true && !permission) response = { ok: false, reason: "permission" };
      else {
        const kinds = { ...current.settings.kinds, ...(patch.kinds as Record<string, boolean> | undefined) };
        current = { ...current, settings: { ...current.settings, ...patch, kinds } as BackgroundStatus["settings"] };
        response = current;
      }
    }
    if (message.kind === "open-settings") response = { ok: true };
    if (!current) return; // no extension: nobody answers
    const answer = () => window.dispatchEvent(new window.MessageEvent("message", { origin: window.location.origin, source: window as never,
      data: { protocol: BACKGROUND_PROTOCOL, target: "app", kind: "response", requestId: message.requestId, response } }));
    if (delay > 0) setTimeout(answer, delay);
    else answer();
  }) as typeof window.postMessage;
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(createElement(CalendarProvider, { initialNow: "2026-11-14T15:00:00.000Z", children: createElement(SettingsSection) })));
  const switchFor = (label: string) => container.querySelector(`[role=switch][aria-label="${label}"]`) as unknown as HTMLButtonElement | null;
  return {
    sent,
    text: () => container.textContent ?? "",
    switchFor,
    click: (el: unknown) => act(async () => (el as HTMLElement).click()),
    button: (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text) as unknown as HTMLButtonElement | undefined,
    wait: (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
      window.postMessage = originalPost;
    },
  };
}

test("automatic checks and the kinds of notification are switched from Settings, through the extension", async () => {
  const view = await render(status({ notifications: true }));
  try {
    const auto = view.switchFor(t("en", "settings.autoCheck"))!;
    assert.equal(auto.getAttribute("aria-checked"), "true");
    await view.click(auto);
    assert.deepEqual(view.sent.at(-1), { kind: "settings", settings: { enabled: false } });
    assert.equal(view.switchFor(t("en", "settings.autoCheck"))!.getAttribute("aria-checked"), "false");

    const grades = view.button(t("en", "changes.kind.grade"))!;
    assert.equal(grades.getAttribute("aria-pressed"), "true");
    await view.click(grades);
    assert.deepEqual(view.sent.at(-1), { kind: "settings", settings: { kinds: { grade: false } } });
    assert.equal(view.button(t("en", "changes.kind.grade"))!.getAttribute("aria-pressed"), "false");
  } finally { await view.unmount(); }
});

test("notifications the browser has not allowed point to the extension, which alone can ask", async () => {
  const view = await render(status(), { permission: false });
  try {
    assert.equal(view.button(t("en", "changes.kind.grade")), undefined, "kinds shown while notifications are off");
    await view.click(view.switchFor(t("en", "settings.notifications")));
    assert.ok(view.text().includes(t("en", "settings.notificationsPermission")));
    assert.equal(view.switchFor(t("en", "settings.notifications"))!.getAttribute("aria-checked"), "false");
    await view.click(view.button(t("en", "settings.openExtension")));
    assert.equal(view.sent.at(-1)?.kind, "open-settings");
  } finally { await view.unmount(); }
});

test("choosing a language also tells the extension, so its notifications match", async () => {
  const view = await render(status());
  try {
    await view.click(view.button(t("en", "language.chinese")));
    assert.ok(view.sent.some((entry) => entry.kind === "settings" && entry.settings?.locale === "zh-CN"));
    assert.ok(view.text().includes(t("zh-CN", "nav.settings")));
  } finally { await view.unmount(); }
});

test("with no extension answering, Settings says so and offers the installation steps", async () => {
  const view = await render(null);
  try {
    await view.wait(NO_ANSWER_MS + 100);
    assert.ok(view.text().includes(t("en", "settings.noExtension")), "it waited for the full timeout to say so");
    assert.equal(view.switchFor(t("en", "settings.autoCheck")), null);
    assert.ok(view.switchFor(t("en", "settings.reminders")), "the page's own reminders stay available");
    await view.wait(5000 - NO_ANSWER_MS); // the request it gave up on, ending inside the test
  } finally { await view.unmount(); }
});

test("a helper that wakes slowly replaces the early \"not connected\" as soon as it answers", async () => {
  const view = await render(status(), { delay: NO_ANSWER_MS + 500 });
  try {
    await view.wait(NO_ANSWER_MS + 100);
    assert.ok(view.text().includes(t("en", "settings.noExtension")));
    await view.wait(600);
    assert.ok(!view.text().includes(t("en", "settings.noExtension")));
    assert.equal(view.switchFor(t("en", "settings.autoCheck"))!.getAttribute("aria-checked"), "true");
  } finally { await view.unmount(); }
});
