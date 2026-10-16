import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
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

test("the manifest names icons that exist, at the sizes the stores ask for", () => {
  const manifest = JSON.parse(readFileSync(join(HERE, "..", "tools", "extension", "manifest.json"), "utf8")) as { icons: Record<string, string> };
  assert.deepEqual(Object.keys(manifest.icons).sort(), ["128", "16", "48"]);
  for (const [size, path] of Object.entries(manifest.icons)) {
    const png = readFileSync(join(HERE, "..", "tools", "extension", path));
    assert.equal(png.readUInt32BE(16), Number(size), `${path} is not ${size} wide`);
    assert.equal(png.readUInt32BE(20), Number(size), `${path} is not ${size} tall`);
  }
});

test("the manifest's description fits the stores' 132 characters", () => {
  const manifest = JSON.parse(readFileSync(join(HERE, "..", "tools", "extension", "manifest.json"), "utf8")) as { description: string };
  assert.ok(manifest.description.length <= 132, `${manifest.description.length} characters`);
});

test("the extension package is the same bytes whenever and wherever it is built", () => {
  const build = (zone: string, name: string) => {
    const out = join(tmpdir(), `betterhuskyct-ext-${process.pid}-${name}.zip`);
    execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/build-extension.mjs", import.meta.url)), out], { env: { ...process.env, TZ: zone }, stdio: "pipe" });
    const bytes = readFileSync(out);
    rmSync(out);
    return createHash("sha256").update(bytes).digest("hex");
  };
  const a = build("UTC", "a");
  assert.equal(build("Pacific/Auckland", "b"), a, "another time zone gave another package");
  assert.equal(build("America/New_York", "c"), a, "another time zone gave another package");
});

test("the package holds LF text only, so a Windows checkout builds the same package as GitHub", async () => {
  const { unzipSync } = await import("fflate");
  const out = join(tmpdir(), `betterhuskyct-ext-${process.pid}-lf.zip`);
  execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/build-extension.mjs", import.meta.url)), out], { stdio: "pipe" });
  const entries = unzipSync(new Uint8Array(readFileSync(out)));
  rmSync(out);
  const text = Object.entries(entries).filter(([name]) => /\.(js|json)$/.test(name));
  assert.ok(text.length >= 5, "the package lost its scripts");
  for (const [name, bytes] of text) assert.ok(!bytes.includes(13), `${name} has a carriage return`);
});

test("the packaged background modules load with native imports and include the offscreen and optional notification UI", async () => {
  const { unzipSync } = await import("fflate");
  const folder = mkdtempSync(join(tmpdir(), "betterhuskyct-modules-"));
  try {
    const out = join(folder, "extension.zip");
    execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/build-extension.mjs", import.meta.url)), out], { stdio: "pipe" });
    const files = unzipSync(new Uint8Array(readFileSync(out)));
    for (const name of ["background.js", "background-sync.js", "background-diff.js", "changes.js", "announcements.js", "content-hash.js", "is-record.js", "offscreen.html", "offscreen.js", "popup.html", "popup.js", "popup.css"]) assert.ok(files[name], "missing " + name);
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    assert.equal(manifest.background.type, "module");
    assert.ok(manifest.permissions.includes("alarms") && manifest.permissions.includes("offscreen"));
    assert.ok(!manifest.permissions.includes("notifications"));
    assert.deepEqual(manifest.optional_permissions, ["notifications"]);
    for (const [name, bytes] of Object.entries(files)) if (/^[\w-]+\.js$/.test(name)) writeFileSync(join(folder, name), bytes);
    writeFileSync(join(folder, "package.json"), '{"type":"module"}');
    const packaged = await import(pathToFileURL(join(folder, "background-sync.js")).href);
    assert.equal(typeof packaged.createBackgroundSync, "function");
  } finally {
    assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + sep));
    rmSync(folder, { recursive: true, force: true });
  }
});
