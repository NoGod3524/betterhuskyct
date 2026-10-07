import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY, applyTheme, nextTheme, readTheme, saveTheme } from "../src/lib/theme.ts";

/**
 * Dark mode is a second set of CSS variables. It only works if every colour a
 * component uses is one of them — a single hard-coded colour is a white box on
 * a dark page — so these checks read the source rather than trust it.
 */
const CSS = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx$/.test(name) ? [path] : [];
  });
}

function variables(block: string): Map<string, string> {
  return new Map([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function blockAfter(marker: string): string {
  const start = CSS.indexOf(marker);
  assert.ok(start !== -1, `no ${marker} block`);
  const open = CSS.indexOf("{", start + marker.length - 1);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
}

const LIGHT = variables(blockAfter(":root {"));
const DARK_MEDIA = variables(blockAfter(':root:not([data-theme="light"]) {'));
const DARK_CHOSEN = variables(blockAfter(':root[data-theme="dark"] {'));

test("no component hard-codes a colour the dark theme cannot reach", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/-\[#[0-9a-fA-F]{3,8}\]|(?<![\w[-])bg-white(?![\w/-])/g)) {
      offenders.push(`${file.slice(SRC.length)}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], "use a variable from globals.css instead");
});

test("every colour variable a component uses exists in light and in dark", () => {
  const used = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    for (const match of readFileSync(file, "utf8").matchAll(/var\(--([\w-]+)\)/g)) used.add(match[1]);
  }
  for (const name of used) {
    assert.ok(LIGHT.has(name), `--${name} is not defined for light`);
    assert.ok(DARK_CHOSEN.has(name), `--${name} is not defined for dark`);
  }
});

test("the two dark blocks are the same set, and cover everything light defines", () => {
  assert.deepEqual([...DARK_MEDIA], [...DARK_CHOSEN]);
  for (const name of LIGHT.keys()) assert.ok(DARK_CHOSEN.has(name), `--${name} has no dark value`);
});

test("the few palette colours left keep their own name in light mode", () => {
  for (const [name, value] of LIGHT) {
    const hex = /^c-([0-9a-f]{6})$/.exec(name)?.[1];
    if (hex) assert.equal(value.toLowerCase(), `#${hex}`, `--${name} changed in light mode`);
  }
});

// WCAG relative luminance and contrast.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test("dark text is readable on dark backgrounds", () => {
  const dark = (name: string) => DARK_CHOSEN.get(name)!;
  const pairs: Array<[string, string, string]> = [
    ["ink", "surface", "body text on a card"],
    ["ink", "canvas", "body text on the page"],
    ["muted", "surface", "secondary text on a card"],
    ["link", "surface", "a link on a card"],
    ["muted", "canvas", "secondary text on the page"],
    ["c-1851a5", "c-dbe8ff", "a course chip (blue)"],
    ["c-23724b", "c-e0f0e8", "a course chip (green)"],
    ["c-7c3e9d", "c-f2e4fa", "a course chip (purple)"],
    ["c-9b5a05", "c-fff0d9", "a course chip (amber)"],
    ["c-a34235", "c-ffe4e1", "a course chip (red)"],
    ["danger", "danger-soft", "a danger badge"],
    ["success", "success-soft", "a success badge"],
    ["warning", "warning-soft", "a warning notice"],
    ["accent-ink", "accent-soft", "an accent notice"],
  ];
  for (const [text, background, what] of pairs) {
    const ratio = contrast(dark(text), dark(background));
    assert.ok(ratio >= 4.5, `${what}: ${ratio.toFixed(2)}:1 is under 4.5:1`);
  }
  // White text on the filled buttons.
  for (const fill of ["navy", "blue"]) {
    const ratio = contrast("#ffffff", dark(fill));
    assert.ok(ratio >= 4.5, `white on --${fill}: ${ratio.toFixed(2)}:1`);
  }
});

test("light text is readable too", () => {
  const light = (name: string) => LIGHT.get(name)!;
  const pairs: Array<[string, string]> = [
    ["ink", "surface"],
    ["ink", "canvas"],
    ["muted", "surface"],
    ["muted", "canvas"],
    ["link", "surface"],
    ["danger", "danger-soft"],
    ["success", "success-soft"],
    ["warning", "warning-soft"],
    ["accent-ink", "accent-soft"],
  ];
  for (const [text, background] of pairs) {
    const ratio = contrast(light(text), light(background));
    assert.ok(ratio >= 4.5, `--${text} on --${background}: ${ratio.toFixed(2)}:1 is under 4.5:1`);
  }
  for (const fill of ["navy", "blue"]) {
    const ratio = contrast("#ffffff", light(fill));
    assert.ok(ratio >= 4.5, `white on --${fill}: ${ratio.toFixed(2)}:1`);
  }
});

// --- the switch ------------------------------------------------------------------------

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

test("the switch goes round system, light, dark", () => {
  assert.equal(nextTheme("system"), "light");
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "system");
});

test("a choice is kept, and following the device keeps nothing", () => {
  const storage = memoryStorage();
  saveTheme("dark", storage);
  assert.equal(readTheme(storage), "dark");
  saveTheme("system", storage);
  assert.equal(storage.data.has(THEME_STORAGE_KEY), false);
  assert.equal(readTheme(memoryStorage({ [THEME_STORAGE_KEY]: "purple" })), "system");
  assert.equal(readTheme(null), "system");
});

test("the theme is set as an attribute, and removed to follow the device", () => {
  const attrs = new Map<string, string>();
  const root = { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) };
  applyTheme("dark", root);
  assert.equal(attrs.get("data-theme"), "dark");
  applyTheme("system", root);
  assert.equal(attrs.has("data-theme"), false);
});

test("the boot script applies a stored choice before anything is drawn, and survives blocked storage", () => {
  const run = (storage: unknown) => {
    const attrs = new Map<string, string>();
    vm.runInNewContext(THEME_BOOT_SCRIPT, {
      localStorage: storage,
      document: { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) } },
    });
    return attrs.get("data-theme");
  };
  assert.equal(run(memoryStorage({ [THEME_STORAGE_KEY]: "dark" })), "dark");
  assert.equal(run(memoryStorage()), undefined);
  assert.equal(run({ getItem: () => { throw new Error("blocked"); } }), undefined);
});
