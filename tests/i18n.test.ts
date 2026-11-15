import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { isLocaleLoaded, loadLocale, t } from "../src/lib/i18n.ts";
import { zhCN } from "../src/lib/i18n-zh.ts";

/**
 * English ships with every page; the Chinese strings are a file of their own, fetched only for a
 * reader who chose Chinese. (The test run loads them up front, through tests/support/locales.ts.)
 */
test("the Chinese strings are not part of the module every page loads", () => {
  const source = readFileSync(new URL("../src/lib/i18n.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import .*i18n-zh/m, "i18n.ts imports the Chinese strings eagerly");
  assert.match(source, /await import\("\.\/i18n-zh\.ts"\)/);
});

test("once loaded, Chinese is spoken, and loading again changes nothing", async () => {
  await loadLocale("zh-CN");
  assert.ok(isLocaleLoaded("zh-CN"));
  assert.equal(t("zh-CN", "nav.settings"), zhCN["nav.settings"]);
  assert.notEqual(t("zh-CN", "nav.settings"), t("en", "nav.settings"));
  await loadLocale("zh-CN");
  await loadLocale("en");
  assert.ok(isLocaleLoaded("en"));
});
