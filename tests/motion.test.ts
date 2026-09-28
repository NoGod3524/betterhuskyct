import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

/**
 * The page's motion is CSS, so what can be pinned is its rules: that each
 * animation has its keyframes, that only compositor-cheap properties move, and
 * that anyone who asked their device for less motion gets none of it.
 */
const CSS = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const COMPONENTS = new URL("../src/components/", import.meta.url);

const ANIMATED_CLASSES = ["page-enter", "rise-in", "skeleton"];

/** The body of the `@media (prefers-reduced-motion: reduce)` block. */
function reducedMotionBlock(): string {
  const start = CSS.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(start !== -1, "no reduced-motion block");
  let depth = 0;
  for (let i = CSS.indexOf("{", start); i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    if (CSS[i] === "}" && --depth === 0) return CSS.slice(start, i + 1);
  }
  throw new Error("unterminated reduced-motion block");
}

test("every animation names keyframes that exist", () => {
  // `animation: none` is how they are switched off, not an animation.
  const used = [...CSS.matchAll(/animation:\s*([a-z-]+)\s/g)].map((match) => match[1]).filter((name) => name !== "none");
  assert.ok(used.length >= ANIMATED_CLASSES.length, "the animations are gone");
  for (const name of used) assert.match(CSS, new RegExp(`@keyframes ${name}\\b`), `no keyframes for "${name}"`);
});

test("only opacity and transform are animated, so nothing re-lays-out the page", () => {
  const blocks = [...CSS.matchAll(/@keyframes\s+([a-z-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)];
  assert.ok(blocks.length >= 3);
  for (const [, name, body] of blocks) {
    const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
    for (const property of properties) {
      assert.ok(["opacity", "transform"].includes(property), `"${name}" animates ${property}`);
    }
  }
});

test("a page fade must not use a transform, which would trap anything fixed inside the page", () => {
  const fade = /@keyframes fade-in\s*\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(CSS);
  assert.ok(fade, "no fade-in keyframes");
  assert.ok(!/transform/.test(fade[1]));
  assert.match(CSS, /\.page-enter\s*\{[^}]*fade-in/);
});

test("a device that asks for less motion gets none of these animations", () => {
  const block = reducedMotionBlock();
  for (const name of ANIMATED_CLASSES) assert.match(block, new RegExp(`\\.${name}\\b`), `${name} still moves`);
  assert.match(block, /animation:\s*none\s*!important/);
  // The transitions were already covered; that must stay true.
  assert.match(block, /transition-duration:\s*0\.01ms\s*!important/);
});

test("the skeleton is drawn in the theme's own colour, so dark mode keeps it", () => {
  const skeleton = /\.skeleton\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(skeleton, "no .skeleton rule");
  assert.match(skeleton[1], /background:\s*var\(--c-[0-9a-f]{6}\)/);
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(skeleton[1]), "the skeleton hard-codes a colour");
});

test("the animation classes the components use are the ones defined", () => {
  const used = new Set<string>();
  for (const file of readdirSync(COMPONENTS)) {
    if (!file.endsWith(".tsx")) continue;
    const source = readFileSync(new URL(file, COMPONENTS), "utf8");
    for (const name of ANIMATED_CLASSES) {
      if (new RegExp(`["'\` ]${name}[ "'\`]`).test(source)) used.add(name);
    }
  }
  assert.deepEqual([...used].sort(), [...ANIMATED_CLASSES].sort(), "a defined animation is used nowhere, or the reverse");
  for (const name of used) assert.match(CSS, new RegExp(`\\.${name}\\s*\\{`));
});
