import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Touch targets, keyboard focus and press feedback are CSS, so what can be
 * pinned is the rules, and that the components carry the classes they hang on.
 * Measured on a 375 px phone before this: the completion checkbox was 16 px,
 * buttons 28 to 38, text links 16 to 20; a finger needs about 44.
 */
const CSS = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const read = (path: string) => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

/** The text of the first `@media (query)` or `@layer name` block containing `marker`. */
function block(opener: string): string {
  const start = CSS.indexOf(opener);
  assert.ok(start !== -1, `no ${opener} block`);
  let depth = 0;
  for (let i = CSS.indexOf("{", start); i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    if (CSS[i] === "}" && --depth === 0) return CSS.slice(start, i + 1);
  }
  throw new Error(`unterminated ${opener}`);
}

const COARSE = block("@media (pointer: coarse)");

test("on a finger, every button and field is at least 44 px tall", () => {
  assert.match(COARSE, /button,\s*select,\s*input:not\(\[type="checkbox"\]\)[^{]*\{\s*min-height:\s*44px/);
  // Checkboxes, radios and file pickers keep their own shapes.
  assert.match(COARSE, /:not\(\[type="radio"\]\):not\(\[type="file"\]\)/);
});

test("on a finger, icon buttons are 44 px squares and text links are 44 px lines", () => {
  assert.match(COARSE, /\.tap-icon\s*\{\s*min-width:\s*44px/);
  assert.match(COARSE, /\.tap-link\s*\{[^}]*min-height:\s*44px/);
});

test("the checkbox keeps its small box in a 44 px hit area that takes no more room than the box", () => {
  assert.match(COARSE, /\.tap-check\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
  // The area is 44 wide and the box 16, so the margins give back 14 on each side;
  // the top also follows the box's own offset, which a component may set.
  assert.match(COARSE, /\.tap-check\s*\{[^}]*margin:\s*calc\(var\(--tap-top, 4px\) - 14px\) -14px -14px/);
  // On a mouse the wrapper draws nothing, so the desktop card is as it was.
  const outside = CSS.replace(COARSE, "");
  assert.match(outside, /\.tap-check\s*\{\s*display:\s*contents/);
});

test("none of the touch rules apply to a mouse", () => {
  const outside = CSS.replace(COARSE, "");
  assert.ok(!/min-height:\s*44px/.test(outside.replace(/\.mobile-tab[^}]*\}/, "")), "a 44 px minimum applies outside the coarse-pointer block");
});

test("buttons and links share one keyboard focus ring in the theme's link colour", () => {
  const base = block("@layer base");
  assert.match(base, /:focus-visible\s*\{\s*outline:\s*2px solid var\(--link\)/);
  for (const element of ["a[href]", "button", "select", '[role="button"]']) assert.ok(base.includes(element), `${element} has no focus ring`);
  // Zero specificity and in the base layer, so a component's own ring still wins.
  assert.match(base, /:where\(/);
});

test("a pressed button shrinks a little, and not for people who asked for less motion", () => {
  const base = block("@layer base");
  const motion = block("@media (prefers-reduced-motion: no-preference)");
  assert.ok(base.includes("@media (prefers-reduced-motion: no-preference)"));
  assert.match(motion, /:active\s*\{\s*transform:\s*scale\(0\.98\)/);
});

test("the components carry the classes the touch rules hang on", () => {
  const card = read("components/task-card.tsx");
  assert.match(card, /<label htmlFor=\{checkboxId\} className="tap-check[^"]*">\s*<input/, "the checkbox is not inside its hit area");

  assert.match(read("components/connect-section.tsx"), /<label htmlFor="remember-calendar" className="tap-check[^"]*">\s*<input/, "the remember checkbox is not inside its hit area");
  assert.equal((read("components/helper-section.tsx").match(/tap-link inline-flex h-9/g) ?? []).length, 2, "an install button is under a finger's height");

  const shell = read("components/app-shell.tsx");
  assert.match(shell, /const iconButton =\s*"tap-icon /, "the header's icon buttons are not finger-sized");
  assert.equal((shell.match(/\{iconButton\}|\$\{iconButton\}/g) ?? []).length, 2, "the theme and reminder buttons do not both use it");

  for (const file of ["materials-section", "grades-section", "announcements-section", "helper-section"]) {
    assert.match(read(`components/${file}.tsx`), /tap-link/, `${file} has a text link a finger could miss`);
  }
});

test("the header fits a phone: one language button below the pill's breakpoint, and no wrapping", () => {
  const shell = read("components/app-shell.tsx");
  // The pill of two is for wider screens only; a phone gets one button.
  assert.match(shell, /className="ml-1 hidden items-center[^"]*sm:flex"/);
  assert.match(shell, /whitespace-nowrap[^"]*sm:hidden/);
  // The name gives way to the controls.
  assert.match(shell, /hidden text-sm font-semibold sm:inline/);
});

test("the page leaves room under it for the bottom bar", () => {
  assert.match(read("components/app-shell.tsx"), /pb-\[calc\(5\.5rem\+env\(safe-area-inset-bottom\)\)\][^"]*lg:pb-8/);
});
