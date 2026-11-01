import assert from "node:assert/strict";
import { after, test } from "node:test";
import { installDom } from "./support/dom.ts";
import { saveSubscriptions } from "../src/lib/subscriptions.ts";
import { createBackup } from "../src/lib/backup.ts";

const dom = installDom("https://bhc.invalid/");
const { window } = dom;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CalendarProvider } = await import("../src/components/calendar-provider.tsx");
const { TaskSharingSection } = await import("../src/components/task-sharing-section.tsx");
after(() => dom.uninstall());

test("opening and consent alone never upload; publication metadata, failed revoke and deletion preserve authority correctly", async () => {
  window.localStorage.clear();
  saveSubscriptions(window.localStorage as unknown as Storage, [{ id: "synthetic-feed", name: "Test feed", courseId: null, importedAt: "2026-11-01T10:00:00Z", events: [{ id: "private-id", title: "Synthetic exercise", course: "TEST 1000", start: "2026-11-06T12:00:00Z", dateKey: null, end: null, allDay: false, location: "Private location" }] }]);
  const requests: { input: string; init?: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  let revokeFails = true;
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    if (init?.method === "DELETE") return Response.json({}, { status: revokeFails ? 503 : 200 });
    return Response.json({ id: "a".repeat(32), readToken: "b".repeat(64), writeToken: "c".repeat(64), expiresAt: "2026-11-08T12:00:00Z" }, { status: 201 });
  };
  const container = window.document.createElement("div"); window.document.body.append(container);
  const root = createRoot(container as unknown as Element);
  const button = (label: string) => { const found = [...container.querySelectorAll("button")].find(b => b.textContent === label); assert.ok(found, label); return found; };
  try {
    await act(async () => root.render(createElement(CalendarProvider, { initialNow: "2026-11-01T12:00:00Z", children: createElement(TaskSharingSection) })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    assert.equal(requests.length, 0); assert.equal(button("Publish snapshot").disabled, true);
    await act(async () => (container.querySelector('input[type="checkbox"]') as unknown as HTMLInputElement).click());
    assert.equal(requests.length, 0); assert.equal(button("Publish snapshot").disabled, false);
    await act(async () => button("Publish snapshot").click());
    assert.equal(requests.length, 1); assert.equal(requests[0].init?.method, "POST");
    const body = String(requests[0].init?.body); assert.ok(!body.includes("private-id")); assert.ok(!body.includes("Private location"));
    assert.ok(container.textContent?.includes("Last published: 2026-11-01T12:00:00.000Z"));
    const saved = window.localStorage.getItem("betterhuskyct.privateTaskShare.v1"); assert.ok(saved?.includes("c".repeat(64)));
    const backup = JSON.stringify(createBackup(window.localStorage as unknown as Storage, new Date(), "test"));
    assert.ok(!backup.includes("c".repeat(64))); assert.ok(!backup.includes("b".repeat(64)));
    await act(async () => button("Revoke and delete").click());
    assert.equal(window.localStorage.getItem("betterhuskyct.privateTaskShare.v1"), saved);
    assert.ok(container.textContent?.includes("Deletion failed"));
    revokeFails = false; await act(async () => button("Revoke and delete").click());
    assert.equal(window.localStorage.getItem("betterhuskyct.privateTaskShare.v1"), null);
    assert.ok(container.textContent?.includes("Share deleted"));
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; }
});
