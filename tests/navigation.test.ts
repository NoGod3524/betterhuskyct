import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { t } from "../src/lib/i18n.ts";
import { installDom } from "./support/dom.ts";

/**
 * The app has four sections — Today, To-do, Courses, Settings — shown in the sidebar on a wide
 * screen and in a bar along the bottom of a phone. Every page belongs to exactly one section and
 * is a tab at the top of it, so every page can be reached from either navigation.
 */
const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MobileNav } = await import("../src/components/mobile-nav.tsx");
const { NAV_SECTIONS, sectionFor } = await import("../src/components/nav-items.ts");
const { SubNav } = await import("../src/components/sub-nav.tsx");

const { window } = dom;
after(() => dom.uninstall());

const APP = fileURLToPath(new URL("../src/app/", import.meta.url));

/** The routes that are pages: a folder under src/app holding a page.tsx, plus the home page. */
function pageRoutes(): string[] {
  const routes = existsSync(join(APP, "page.tsx")) ? ["/"] : [];
  for (const name of readdirSync(APP)) {
    const dir = join(APP, name);
    if (statSync(dir).isDirectory() && !name.startsWith("_") && existsSync(join(dir, "page.tsx"))) routes.push("/" + name);
  }
  return routes;
}

const ALL_PAGES = NAV_SECTIONS.flatMap((section) => section.pages.map((page) => page.href));

test("the retired helper page redirects to the dashboard and is absent from navigation", async () => {
  const { default: config } = await import("../next.config.ts");
  assert.deepEqual(await config.redirects?.(), [{ source: "/helper", destination: "/", permanent: true }]);
  assert.ok(!ALL_PAGES.includes("/helper"));
  assert.ok(!existsSync(join(APP, "helper/page.tsx")));
});

test("every page belongs to exactly one section, and nothing in the navigation goes nowhere", () => {
  const routes = pageRoutes();
  assert.ok(routes.length >= 11, "found too few pages: " + routes.join(", "));
  for (const route of routes) assert.ok(ALL_PAGES.includes(route), `${route} is a page no section holds`);
  for (const href of ALL_PAGES) assert.ok(routes.includes(href), `${href} is in the navigation but is not a page`);
  assert.equal(new Set(ALL_PAGES).size, ALL_PAGES.length, "a page is in two sections");
  assert.equal(NAV_SECTIONS.length, 4);
  for (const section of NAV_SECTIONS) assert.equal(section.pages[0].href, section.href, `${section.href} does not open on its first tab`);
});

test("a route finds its section; an unknown one finds none", () => {
  assert.equal(sectionFor("/calendar")?.href, "/tasks");
  assert.equal(sectionFor("/grades")?.href, "/courses");
  assert.equal(sectionFor("/courses/cse-2050")?.href, "/courses", "a course's own page is in Courses");
  assert.equal(sectionFor("/backup")?.href, "/settings");
  assert.equal(sectionFor("/changes")?.href, "/");
  assert.equal(sectionFor("/nowhere"), null);
});

test("the sidebar is not the phone's only navigation: the bar is mounted by the shell and shown below it", () => {
  const shell = readFileSync(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<MobileNav\b/, "the shell does not mount the bottom bar");
  assert.match(shell, /<SubNav\b/, "the shell does not mount the section tabs");
  assert.match(shell, /<aside className="[^"]*\bhidden\b[^"]*lg:flex/, "the sidebar changed; check the bar still covers what it hides");
  const bar = readFileSync(new URL("../src/components/mobile-nav.tsx", import.meta.url), "utf8");
  assert.match(bar, /fixed inset-x-0 bottom-0[^"]*lg:hidden/, "the bar is not hidden on wide screens, where the sidebar is");
});

async function mount(element: (path: string, locale: "en" | "zh-CN", count: number) => unknown, pathname: string) {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const show = (path: string, locale: "en" | "zh-CN" = "en", count = 0) =>
    act(async () => root.render(element(path, locale, count) as never));
  await show(pathname);
  return {
    show,
    q: (selector: string) => container.querySelector(selector) as unknown as HTMLElement | null,
    text: () => container.textContent ?? "",
    links: () => [...container.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    unmount: () => act(async () => root.unmount()),
  };
}

const bar = (pathname: string) =>
  mount((path, locale, unreadChanges) => createElement(MobileNav, { pathname: path, locale, unreadChanges }), pathname);
const tabs = (pathname: string) =>
  mount((path, locale, count) => createElement(SubNav, { pathname: path, locale, badges: { "/changes": count } }), pathname);

test("the bar shows the four sections, with the current one marked on any of its pages", async () => {
  const view = await bar("/calendar");
  assert.deepEqual(view.links(), ["/", "/tasks", "/courses", "/settings"]);
  assert.equal(view.q('a[href="/tasks"]')!.getAttribute("aria-current"), "true");
  assert.equal(view.q('a[href="/"]')!.getAttribute("aria-current"), null);
  await view.show("/tasks");
  assert.equal(view.q('a[href="/tasks"]')!.getAttribute("aria-current"), "page");
  await view.show("/grades");
  assert.ok(view.q('a[href="/courses"]')!.className.includes("mobile-tab-active"));
  await view.show("/courses/cse-2050");
  assert.ok(view.q('a[href="/courses"]')!.className.includes("mobile-tab-active"));
  assert.equal(view.q("nav")!.getAttribute("aria-label"), t("en", "nav.main"));
  await view.unmount();
});

test("unread changes show on Today, in both languages", async () => {
  const view = await bar("/");
  assert.equal(view.q('[aria-label="3 unread changes"]'), null);
  await view.show("/", "en", 3);
  assert.ok(view.q('a[href="/"] [aria-label="3 unread changes"]'));
  await view.show("/", "zh-CN", 0);
  assert.ok(view.text().includes(t("zh-CN", "nav.today")));
  assert.ok(view.text().includes(t("zh-CN", "nav.courses")));
  await view.unmount();
});

test("a section's pages are tabs at its top; a page outside any section has none", async () => {
  const view = await tabs("/materials");
  assert.deepEqual(view.links(), ["/courses", "/announcements", "/materials", "/grades"]);
  assert.equal(view.q('a[href="/materials"]')!.getAttribute("aria-current"), "page");
  await view.show("/settings");
  assert.deepEqual(view.links(), ["/settings", "/backup", "/privacy", "/about"]);
  await view.show("/", "en", 4);
  assert.ok(view.q('a[href="/changes"]')!.textContent!.includes("4"));
  await view.show("/nowhere");
  assert.deepEqual(view.links(), []);
  await view.unmount();
});
