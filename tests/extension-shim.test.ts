import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";

/** Runs the shipped shim in a bare context with a window that records what it posts. */
const HERE = dirname(fileURLToPath(import.meta.url));
const SHIM = readFileSync(join(HERE, "..", "tools", "extension", "shim.js"), "utf8");

function load(boot: Record<string, unknown>) {
  const posted: Array<Record<string, unknown>> = [];
  const handlers: Array<(event: unknown) => void> = [];
  const window: Record<string, unknown> = {
    location: { origin: "https://lms.uconn.edu" },
    postMessage: (message: Record<string, unknown>) => posted.push(message),
    addEventListener: (_name: string, run: (event: unknown) => void) => handlers.push(run),
  };
  const context: Record<string, unknown> = { window, __bhcExtBoot: boot, JSON, Date, Math };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SHIM, context);
  const fromExtension = (key: string, value: unknown) =>
    handlers.forEach((run) => run({ source: window, data: { protocol: "betterhuskyct/ext@1", from: "ext", kind: "changed", key, value } }));
  return { context, posted, fromExtension, window } as const;
}

test("reads come from the snapshot, and the boot value is not left behind", () => {
  const { context } = load({ a: { n: 1 } });
  const get = context.GM_getValue as (k: string, f: unknown) => unknown;
  assert.deepEqual(get("a", null), { n: 1 });
  assert.equal(get("missing", "fallback"), "fallback");
  assert.equal(context.__bhcExtBoot, undefined);
});

test("a write is readable at once and handed to the relay", () => {
  const { context, posted } = load({});
  (context.GM_setValue as (k: string, v: unknown) => void)("k", { x: [1] });
  assert.deepEqual((context.GM_getValue as (k: string, f: unknown) => unknown)("k", null), { x: [1] });
  assert.equal(posted[0].kind, "set");
  assert.equal(posted[0].key, "k");
});

test("a change from another tab reaches the listener once, and an echo of our own write does not", () => {
  const { context, fromExtension } = load({});
  const seen: unknown[][] = [];
  (context.GM_addValueChangeListener as (k: string, run: (...a: unknown[]) => void) => void)("q", (...a) => seen.push(a));
  fromExtension("q", { items: [1] });
  fromExtension("q", { items: [1] });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].slice(0, 3), ["q", undefined, { items: [1] }]);
  (context.GM_setValue as (k: string, v: unknown) => void)("own", 5);
  fromExtension("own", 5);
  assert.equal(seen.length, 1);
});

test("opening a tab asks the background, and closing names the same tab", () => {
  const { context, posted } = load({});
  const tab = (context.GM_openInTab as (u: string, o: unknown) => { close: () => void })("https://lms.uconn.edu/ultra/course", { active: false });
  tab.close();
  assert.equal(posted[0].kind, "open");
  assert.equal((posted[0].options as { active: boolean }).active, false);
  assert.equal(posted[1].kind, "close");
  assert.equal(posted[1].id, posted[0].id);
});
