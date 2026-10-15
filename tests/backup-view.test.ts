import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createBackup } from "../src/lib/backup.ts";
import { t } from "../src/lib/i18n.ts";
import { installDom } from "./support/dom.ts";

const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CalendarProvider } = await import("../src/components/calendar-provider.tsx");
const { BackupSection } = await import("../src/components/backup-section.tsx");
const { window } = dom;
after(() => dom.uninstall());

async function mount() {
  window.localStorage.clear();
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => {
    root.render(createElement(CalendarProvider, {
      initialNow: "2026-10-15T12:00:00.000Z",
      children: createElement(BackupSection, { version: "1.37.1" }),
    }));
  });
  return {
    text: () => container.textContent ?? "",
    click: async (label: string) => {
      const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
      assert.ok(button, `missing button: ${label}`);
      await act(async () => { button.click(); });
    },
    choose: async (file: Pick<File, "name" | "size" | "text">) => {
      const input = container.querySelector('input[type="file"]')!;
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await act(async () => { input.dispatchEvent(new window.Event("change", { bubbles: true })); });
    },
    unmount: async () => { await act(async () => root.unmount()); container.remove(); },
  };
}

const backupText = JSON.stringify(createBackup({ getItem: (key) => key === "huskypilot.theme.v1" ? "dark" : null }, new Date("2026-10-15T12:00:00Z"), "1.37.1"));

function override(object: object, key: string, descriptor: PropertyDescriptor) {
  const before = Object.getOwnPropertyDescriptor(object, key);
  Object.defineProperty(object, key, { configurable: true, ...descriptor });
  return () => {
    if (before) Object.defineProperty(object, key, before);
    else Reflect.deleteProperty(object, key);
  };
}

const EXPORT_FAILED = "The backup could not be saved. Check this browser's storage and download settings, then try again.";

test("blocked browser storage shows a restore failure instead of success", async () => {
  const view = await mount();
  await view.choose({ name: "working.json", size: backupText.length, text: async () => backupText });
  const restore = override(window, "localStorage", { get: () => { throw new Error("SecurityError"); } });
  try {
    await view.click(t("en", "backup.apply"));
    assert.ok(view.text().includes(t("en", "backup.failed")));
    assert.ok(!view.text().includes(t("en", "backup.done")));
  } finally { restore(); await view.unmount(); }
});

test("download and phone sharing report an error when browser storage cannot be read", async () => {
  const view = await mount();
  const restore = override(window, "localStorage", { get: () => { throw new Error("SecurityError"); } });
  try {
    for (const label of ["backup.exportButton", "backup.shareButton"] as const) {
      await view.click(t("en", label));
      assert.ok(view.text().includes(EXPORT_FAILED));
    }
  } finally { restore(); await view.unmount(); }
});

test("cancelling the phone share sheet stays silent", async () => {
  const view = await mount();
  let calls = 0;
  const restoreCanShare = override(window.navigator, "canShare", { value: () => true });
  const restoreShare = override(window.navigator, "share", { value: async () => {
    calls++;
    throw new DOMException("Cancelled", "AbortError");
  } });
  try {
    await view.click(t("en", "backup.shareButton"));
    assert.equal(calls, 1);
    assert.ok(!view.text().includes(EXPORT_FAILED));
    assert.ok(!view.text().includes(t("en", "backup.shareFailed")));
    assert.ok(!view.text().includes(t("en", "backup.shared")));
  } finally { restoreCanShare(); restoreShare(); await view.unmount(); }
});

test("an unreadable backup file shows an error and can be followed by a working file", async () => {
  const view = await mount();
  try {
    await view.choose({ name: "unavailable.json", size: 100, text: async () => { throw new Error("NotReadableError"); } });
    assert.ok(view.text().includes(t("en", "backup.reason.unreadable")));
    await view.choose({ name: "working.json", size: backupText.length, text: async () => backupText });
    assert.ok(view.text().includes("working.json contains:"));
    assert.ok(!view.text().includes(t("en", "backup.reason.unreadable")));
  } finally { await view.unmount(); }
});

test("a slow earlier file cannot replace the latest backup selection", async () => {
  const view = await mount();
  let finish!: (text: string) => void;
  const slow = new Promise<string>((resolve) => { finish = resolve; });
  try {
    await view.choose({ name: "old.json", size: backupText.length, text: () => slow });
    await view.choose({ name: "latest.json", size: backupText.length, text: async () => backupText });
    await act(async () => { finish(backupText); });
    assert.ok(view.text().includes("latest.json contains:"));
    assert.ok(!view.text().includes("old.json contains:"));
  } finally { await view.unmount(); }
});
