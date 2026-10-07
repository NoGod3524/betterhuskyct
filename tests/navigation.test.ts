import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { t } from "../src/lib/i18n.ts";
import { installDom } from "./support/dom.ts";

/**
 * Below 1024 px the sidebar is hidden, and it was the only navigation there was:
 * on a phone the site had no way to reach any page but the one opened. The
 * bottom bar is the way, so these keep it true — every page can be reached from
 * it — and check the bar itself as it is used.
 */
const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MobileNav } = await import("../src/components/mobile-nav.tsx");
const { MORE_NAV, NAV_ITEMS, PRIMARY_NAV } = await import("../src/components/nav-items.ts");

const { window } = dom;
after(() => dom.uninstall());

const APP = new URL("../src/app/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** The routes that are pages: a folder under src/app holding a page.tsx, plus the home page. */
function pageRoutes(): string[] {
  const routes = existsSync(join(APP, "page.tsx")) ? ["/"] : [];
  for (const name of readdirSync(APP)) {
    const dir = join(APP, name);
    if (statSync(dir).isDirectory() && !name.startsWith("_") && existsSync(join(dir, "page.tsx"))) routes.push("/" + name);
  }
  return routes;
}

test("every page can be reached from the navigation, and nothing in it goes nowhere", () => {
  const routes = pageRoutes();
  assert.ok(routes.length >= 7, "found too few pages: " + routes.join(", "));
  const listed = NAV_ITEMS.map((item) => item.href);
  for (const route of routes) assert.ok(listed.includes(route), `${route} is a page no navigation links to`);
  for (const href of listed) assert.ok(routes.includes(href), `${href} is in the navigation but is not a page`);
  assert.equal(new Set(listed).size, listed.length, "a page is listed twice");
});

test("the bottom bar and its More sheet between them hold every page exactly once", () => {
  const all = [...PRIMARY_NAV, ...MORE_NAV].map((item) => item.href);
  assert.deepEqual(all, NAV_ITEMS.map((item) => item.href));
  // Four slots and More make five equal columns.
  assert.equal(PRIMARY_NAV.length, 4);
  assert.ok(MORE_NAV.length > 0);
});

test("the sidebar is not the phone's only navigation: the bar is mounted by the shell and shown below it", () => {
  const shell = readFileSync(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<MobileNav\b/, "the shell does not mount the bottom bar");
  assert.match(shell, /<aside className="[^"]*\bhidden\b[^"]*lg:flex/, "the sidebar changed; check the bar still covers what it hides");
  const bar = readFileSync(new URL("../src/components/mobile-nav.tsx", import.meta.url), "utf8");
  assert.match(bar, /fixed inset-x-0 bottom-0[^"]*lg:hidden/, "the bar is not hidden on wide screens, where the sidebar is");
});

// --- the bar, as it is used ---------------------------------------------------------------

async function mountBar(pathname: string) {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const show = (path: string, locale: "en" | "zh-CN" = "en") =>
    act(async () => root.render(createElement(MobileNav, { pathname: path, locale })));
  await show(pathname);
  const q = (selector: string) => container.querySelector(selector) as unknown as HTMLElement | null;
  return {
    show,
    container,
    q,
    text: () => container.textContent ?? "",
    links: () => [...container.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    more: () => [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(t("en", "nav.more"))) as unknown as HTMLButtonElement,
    click: (el: unknown) => act(async () => (el as HTMLElement).click()),
    key: (key: string, options: Record<string, unknown> = {}) =>
      act(async () => {
        window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, ...options }));
      }),
    unmount: () => act(async () => root.unmount()),
  };
}

test("the bar shows the four main pages and a More, with the current page marked", async () => {
  const bar = await mountBar("/tasks");

  assert.deepEqual(bar.links(), ["/", "/tasks", "/calendar", "/announcements"]);
  assert.ok(bar.more(), "no More button");
  assert.equal(bar.q('a[href="/tasks"]')!.getAttribute("aria-current"), "page");
  assert.equal(bar.q('a[href="/calendar"]')!.getAttribute("aria-current"), null);
  assert.equal(bar.q("nav")!.getAttribute("aria-label"), t("en", "nav.main"));
  assert.equal(bar.q("[role=dialog]"), null, "the sheet was open from the start");
  await bar.unmount();
});

test("More opens a sheet of the other pages, and picking one closes it by changing the route", async () => {
  const bar = await mountBar("/");

  await bar.click(bar.more());
  const dialog = bar.q("[role=dialog]");
  assert.ok(dialog, "More did not open the sheet");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(bar.more().getAttribute("aria-expanded"), "true");
  const inSheet = [...dialog.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  assert.deepEqual(inSheet, MORE_NAV.map((item) => item.href));
  assert.ok(bar.text().includes(t("en", "nav.grades")));

  // Following a link changes the route; the sheet was open on the old one.
  await bar.show("/grades");
  assert.equal(bar.q("[role=dialog]"), null, "the sheet stayed open after the route changed");
  assert.equal(bar.more().getAttribute("aria-expanded"), "false");
  await bar.unmount();
});

test("on a page behind More, the More button is the one marked current", async () => {
  const bar = await mountBar("/materials");

  assert.ok(bar.more().className.includes("mobile-tab-active"));
  await bar.click(bar.more());
  assert.equal(bar.q('[role=dialog] a[href="/materials"]')!.getAttribute("aria-current"), "page");
  await bar.unmount();
});

test("Escape closes the sheet and puts focus back on More", async () => {
  const bar = await mountBar("/");
  await bar.click(bar.more());
  assert.ok(bar.q("[role=dialog]"));
  assert.ok(window.document.body.style.overflow === "hidden", "the page behind still scrolls");

  await bar.key("Escape");

  assert.equal(bar.q("[role=dialog]"), null);
  assert.equal(window.document.body.style.overflow, "", "the page stayed locked after the sheet closed");
  assert.equal(window.document.activeElement, bar.more());
  await bar.unmount();
});

test("the backdrop closes the sheet", async () => {
  const bar = await mountBar("/");
  await bar.click(bar.more());

  await bar.click(bar.q(`button[aria-label="${t("en", "nav.close")}"]`));

  assert.equal(bar.q("[role=dialog]"), null);
  await bar.unmount();
});

test("Tab stays inside the open sheet", async () => {
  const bar = await mountBar("/");
  await bar.click(bar.more());
  const links = [...bar.container.querySelectorAll("[role=dialog] a")] as unknown as HTMLElement[];
  assert.equal(window.document.activeElement, links[0], "focus did not move into the sheet");

  links[links.length - 1].focus();
  await bar.key("Tab");
  assert.equal(window.document.activeElement, links[0], "Tab left the sheet from its last link");

  await bar.key("Tab", { shiftKey: true });
  assert.equal(window.document.activeElement, links[links.length - 1], "Shift+Tab left the sheet from its first link");
  await bar.unmount();
});

test("the bar is in Chinese when the page is", async () => {
  const bar = await mountBar("/");
  await bar.show("/", "zh-CN");

  assert.ok(bar.text().includes(t("zh-CN", "nav.dashboard")));
  assert.ok(bar.text().includes(t("zh-CN", "nav.more")));
  await bar.unmount();
});
