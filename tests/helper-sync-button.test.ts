import assert from "node:assert/strict";
import { after, test } from "node:test";

import { HELPER_SYNC_PROTOCOL, type HelperSyncState, type HuskyctTab } from "../src/lib/helper-sync.ts";
import { t } from "../src/lib/i18n.ts";
import { installDom } from "./support/dom.ts";

/**
 * BetterHuskyCT's Sync buttons, rendered with the real provider around them, a stand-in HuskyCT tab,
 * and a clock the test holds.
 */
const dom = installDom();
const { createElement, act, Fragment } = await import("react");
const { createRoot } = await import("react-dom/client");
const { HelperSyncButton, HelperSyncProvider, syncStatusText } = await import("../src/components/helper-sync-button.tsx");
const { CalendarProvider } = await import("../src/components/calendar-provider.tsx");

const { window } = dom;
after(() => dom.uninstall());

type Deps = { open?: () => HuskyctTab | null; now?: () => number; schedule?: (run: () => void, ms: number) => () => void };

function fakeTab() {
  const posted: Array<{ message: unknown; origin: string }> = [];
  const tab: HuskyctTab = { closed: false, postMessage: (message, origin) => void posted.push({ message, origin }) };
  return { tab, posted };
}

async function render(deps: Deps, variants: Array<"big" | "compact"> = ["big"]) {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () =>
    root.render(
      createElement(CalendarProvider, {
        initialNow: new Date().toISOString(),
        children: createElement(HelperSyncProvider, {
          deps,
          children: createElement(Fragment, null, ...variants.map((variant) => createElement(HelperSyncButton, { key: variant, variant }))),
        }),
      }),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return {
    text: () => container.textContent ?? "",
    buttons: () => [...container.querySelectorAll("button")] as unknown as HTMLButtonElement[],
    click: (button: HTMLButtonElement) =>
      act(async () => {
        button.click();
      }),
    /** The helper speaking, from the tab. */
    hear: (tab: HuskyctTab, data: unknown, origin = "https://lms.uconn.edu") =>
      act(async () => {
        window.dispatchEvent(new window.MessageEvent("message", { data, origin, source: tab as never }));
      }),
    unmount: () => act(async () => root.unmount()),
  };
}

const say = (fields: Record<string, unknown>) => ({ protocol: HELPER_SYNC_PROTOCOL, ...fields });
const noTimers = () => () => undefined;

test("at rest the button says what it does and asks nothing", async () => {
  const view = await render({ open: () => fakeTab().tab, schedule: noTimers });

  assert.ok(view.text().includes(t("en", "helpersync.button")));
  assert.ok(view.text().includes(t("en", "helpersync.hint")));
  assert.equal(view.buttons()[0].disabled, false);
  await view.unmount();
});

test("a press opens HuskyCT, asks the helper, and follows it through to the result", async () => {
  const { tab, posted } = fakeTab();
  const view = await render({ open: () => tab, schedule: noTimers });

  await view.click(view.buttons()[0]);
  assert.deepEqual(posted, [{ message: { protocol: HELPER_SYNC_PROTOCOL, kind: "request" }, origin: "https://lms.uconn.edu" }]);
  assert.ok(view.text().includes(t("en", "helpersync.waiting")));
  assert.equal(view.buttons()[0].disabled, true, "a second press was allowed while waiting");

  await view.hear(tab, say({ kind: "ack", state: "started" }));
  assert.ok(view.text().includes(t("en", "helpersync.syncing")));

  await view.hear(tab, say({ kind: "progress", course: "MATH 1070Q", index: 2, total: 6 }));
  assert.ok(view.text().includes(t("en", "helpersync.syncingCourse", { course: "MATH 1070Q", index: 2, total: 6 })));

  await view.hear(tab, say({ kind: "done", ok: true, courses: 6, announcements: 12, gradeItems: 80, skipped: ["ECON 1201"], sent: true }));
  assert.ok(view.text().includes(t("en", "helpersync.done", { courses: 6, announcements: 12, items: 80 })));
  assert.ok(view.text().includes(t("en", "helpersync.skipped", { courses: "ECON 1201" })));
  assert.equal(view.buttons()[0].disabled, false, "the button did not come back");
  await view.unmount();
});

test("the header's button and the overview's are one sync: pressing either shows it on both", async () => {
  const { tab, posted } = fakeTab();
  const view = await render({ open: () => tab, schedule: noTimers }, ["big", "compact"]);
  assert.equal(view.buttons().length, 2);

  await view.click(view.buttons()[1]);

  assert.equal(posted.length, 1);
  assert.ok(view.text().includes(t("en", "helpersync.waiting")));
  assert.deepEqual(view.buttons().map((button) => button.disabled), [true, true]);
  await view.unmount();
});

test("a message from anywhere but HuskyCT's tab is not taken as an answer", async () => {
  const { tab } = fakeTab();
  const view = await render({ open: () => tab, schedule: noTimers });
  await view.click(view.buttons()[0]);

  await view.hear(tab, say({ kind: "done", ok: true, courses: 1, announcements: 1, gradeItems: 1, skipped: [], sent: true }), "https://evil.example");
  await view.hear({ postMessage() {} }, say({ kind: "done", ok: true, courses: 1, announcements: 1, gradeItems: 1, skipped: [], sent: true }));

  assert.ok(view.text().includes(t("en", "helpersync.waiting")));
  await view.unmount();
});

test("a browser that blocks the tab is told so", async () => {
  const view = await render({ open: () => null, schedule: noTimers });

  await view.click(view.buttons()[0]);

  assert.ok(view.text().includes(t("en", "helpersync.blocked")));
  assert.equal(view.buttons()[0].disabled, false, "the button stayed stuck after a refusal");
  await view.unmount();
});

test("a helper that never answers ends in a message that names what to check, with a way to the helper's page", async () => {
  const { tab } = fakeTab();
  let calls = 0;
  const view = await render({
    open: () => tab,
    // Each look at the clock is a minute later, so the wait runs out within a few asks.
    now: () => calls++ * 60_000,
    schedule: (run) => {
      const id = setTimeout(run, 0);
      return () => clearTimeout(id);
    },
  });

  await view.click(view.buttons()[0]);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  assert.ok(view.text().includes(t("en", "helpersync.noanswer")));
  assert.ok(view.text().includes(t("en", "helpersync.helperLink")));
  await view.unmount();
});

test("every state has words in both languages, and a result that arrived in part says so", () => {
  const states: HelperSyncState[] = [
    { phase: "blocked" },
    { phase: "waiting" },
    { phase: "syncing", course: null, index: 0, total: 0 },
    { phase: "syncing", course: "MATH 1070Q", index: 1, total: 2 },
    { phase: "done", courses: 1, announcements: 1, gradeItems: 1, skipped: [], sent: true },
    { phase: "nodata" },
    { phase: "failed", reason: "noanswer" },
    { phase: "failed", reason: "stalled" },
    { phase: "failed", reason: "closed" },
  ];
  for (const state of states) {
    for (const locale of ["en", "zh-CN"] as const) {
      const words = syncStatusText(locale, state);
      assert.ok(words.length > 0, `${state.phase} has no words in ${locale}`);
      assert.ok(!/\{\w+\}/.test(words), `${state.phase} left a placeholder in ${locale}: ${words}`);
    }
  }
  assert.equal(syncStatusText("en", { phase: "idle" }), "");
  const partial = syncStatusText("en", { phase: "done", courses: 1, announcements: 1, gradeItems: 1, skipped: [], sent: false });
  assert.ok(partial.includes(t("en", "helpersync.partial")));
});
