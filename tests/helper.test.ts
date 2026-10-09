import assert from "node:assert/strict";
import test from "node:test";

import {
  HELPER_SCRIPT_URL,
  HELPER_SOURCE_URL,
  MANAGER_FALLBACK,
  bookmarkHref,
  managerFor,
} from "../src/lib/helper.ts";

// Copied from real browsers rather than invented, because the whole point of
// the chooser is the tokens that distinguish them.
const UA = {
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0",
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
};

/**
 * Edge says "Chrome" too. Checking Chrome first would send every Edge user to
 * the Chrome Web Store, which refuses to install into Edge — a dead end at the
 * exact moment someone has decided to trust the thing.
 */
test("Edge is recognised before Chrome", () => {
  assert.equal(managerFor(UA.edge).id, "edge");
  assert.match(managerFor(UA.edge).url, /microsoftedge\.microsoft\.com/);
});

test("Chrome is recognised on its own", () => {
  assert.equal(managerFor(UA.chrome).id, "chrome");
  assert.match(managerFor(UA.chrome).url, /chromewebstore\.google\.com/);
});

test("Firefox is recognised", () => {
  assert.equal(managerFor(UA.firefox).id, "firefox");
  assert.match(managerFor(UA.firefox).url, /addons\.mozilla\.org/);
});

/** Safari cannot run either extension, so the honest answer is Tampermonkey's
 * own page, which offers whatever build does exist. */
test("anything unrecognised falls back to the manager's own site", () => {
  assert.equal(managerFor(UA.safari).id, "other");
  assert.equal(managerFor(UA.safari).url, MANAGER_FALLBACK.url);
  assert.equal(managerFor("").id, "other");
});

test("every listing is an https link", () => {
  for (const ua of Object.values(UA)) {
    assert.ok(managerFor(ua).url.startsWith("https://"), managerFor(ua).url);
  }
});

/**
 * These two addresses are what the page hands out, so a typo here is an install
 * that 404s. They are asserted rather than inlined for that reason.
 */
test("the script and source links point at main", () => {
  assert.equal(
    HELPER_SCRIPT_URL,
    "https://raw.githubusercontent.com/NoGod3524/betterhuskyct/main/tools/huskyct-helper/huskyct-helper.user.js",
  );
  assert.equal(
    HELPER_SOURCE_URL,
    "https://github.com/NoGod3524/betterhuskyct/tree/main/tools/huskyct-helper",
  );
  assert.ok(HELPER_SCRIPT_URL.endsWith(".user.js"), "a manager only intercepts .user.js");
});

// --- the bookmark ------------------------------------------------------------------------------

test("the bookmark is one line of script a browser will run, and it names the site it loads from", () => {
  const href = bookmarkHref();

  assert.ok(href.startsWith("javascript:"));
  assert.ok(!/[\r\n]/.test(href), "a bookmark's address cannot hold a line break");
  const code = href.slice("javascript:".length);
  assert.doesNotThrow(() => new Function(code), "the bookmark does not parse");
  // Opens BetterHuskyCT first (while the press still counts) with the mark that makes it ask for a sync.
  assert.match(code, /window\.open\('https:\/\/betterhuskyct\.vercel\.app\/\?sync=bookmark','betterhuskyct'\)/);
  assert.match(code, /s\.src='https:\/\/betterhuskyct\.vercel\.app\/huskyct-helper\.js\?t='/);
  assert.ok(code.indexOf("window.open") < code.indexOf("createElement"), "the tab must open before anything slow, or the browser blocks it");
  // Only HuskyCT's own site; anywhere else it says so and does nothing.
  assert.match(code, /uconn\\\.edu\$/);
  // A helper already there (the userscript, or an earlier press) is not loaded twice.
  assert.match(code, /if\(window\.__huskyctHelper\)return;/);
});

test("the bookmark follows the script's address, so a copy served elsewhere points at itself", () => {
  const code = bookmarkHref("https://preview.example.vercel.app/huskyct-helper.js").slice("javascript:".length);
  assert.match(code, /https:\/\/preview\.example\.vercel\.app\/\?sync=bookmark/);
  assert.match(code, /https:\/\/preview\.example\.vercel\.app\/huskyct-helper\.js\?t=/);
  assert.ok(!code.includes("betterhuskyct.vercel.app"));
});
