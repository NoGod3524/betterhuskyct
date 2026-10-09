/**
 * Where to send someone to get the HuskyCT Helper.
 *
 * The helper is a userscript, which is a script that needs a manager to run it.
 * So there are two hops, and both are store links rather than instructions: the
 * manager from the browser's own store, then the script itself, which the
 * manager intercepts and offers to install.
 *
 * This is a module rather than constants inside the page because the part worth
 * testing is the chooser: Edge puts "Chrome" in its user agent as well, and
 * getting that order wrong sends an Edge user to a Chrome store page that will
 * refuse to install anything.
 */

/** The script. A manager intercepts this URL; a browser without one shows it. */
export const HELPER_SCRIPT_URL =
  "https://raw.githubusercontent.com/NoGod3524/betterhuskyct/main/tools/huskyct-helper/huskyct-helper.user.js";

/** Its source and documentation, for anyone who wants to read it first. */
export const HELPER_SOURCE_URL =
  "https://github.com/NoGod3524/betterhuskyct/tree/main/tools/huskyct-helper";

/** Where the helper is served from, for the bookmark: a script a browser will run (see scripts/copy-helper.mjs). */
export const HELPER_BOOKMARK_SCRIPT_URL = "https://betterhuskyct.vercel.app/huskyct-helper.js";

/**
 * The bookmark: a link whose address is a few lines of script, kept in the bookmarks bar and
 * pressed on HuskyCT. It needs no extension and no browser switch.
 *
 * What it does, in order: on a page that is not HuskyCT's it says so and stops; it opens
 * BetterHuskyCT in a tab of its own (while the press still counts, or the browser would block the
 * tab), which asks this page for a sync as soon as it has loaded; and it loads the helper into the
 * page, unless one is already there (an installed userscript, or an earlier press). HuskyCT sends no
 * rule against scripts from other sites (measured on 2026-10-08: its only policy is `frame-ancestors`).
 *
 * The helper it loads is the one on the site, so the bookmark never goes out of date, and it is
 * the same file the userscript is made from.
 */
export function bookmarkHref(scriptUrl: string = HELPER_BOOKMARK_SCRIPT_URL): string {
  const site = scriptUrl.replace(/\/[^/]*$/, "");
  const code =
    "(function(){" +
    "if(!/(^|\\.)uconn\\.edu$/.test(location.hostname)){" +
    "alert('请先打开 HuskyCT（lms.uconn.edu）并登录，再点这个书签。\\nOpen HuskyCT (lms.uconn.edu) and sign in first, then press this bookmark.');return}" +
    `var w=window.open('${site}/?sync=bookmark','betterhuskyct');` +
    "if(!w){alert('浏览器拦截了新标签页，请允许弹出窗口后再点一次。\\nThe browser blocked the new tab. Allow pop-ups for this page and press the bookmark again.');return}" +
    "if(window.__huskyctHelper)return;" +
    "window.__bhcBookmarklet=1;" +
    "var s=document.createElement('script');" +
    `s.src='${scriptUrl}?t='+Date.now();` +
    "document.head.appendChild(s)" +
    "})()";
  return "javascript:" + code;
}

export type UserscriptManager = {
  id: "edge" | "chrome" | "firefox" | "other";
  /** Which store the link goes to, for the button's label. */
  store: string;
  url: string;
};

const EDGE: UserscriptManager = {
  id: "edge",
  store: "Microsoft Edge Add-ons",
  url: "https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd",
};

const CHROME: UserscriptManager = {
  id: "chrome",
  store: "Chrome Web Store",
  url: "https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo",
};

const FIREFOX: UserscriptManager = {
  id: "firefox",
  store: "addons.mozilla.org",
  url: "https://addons.mozilla.org/firefox/addon/tampermonkey/",
};

/**
 * Tampermonkey's own site, for anything not recognised.
 *
 * It detects the browser itself and offers the right build, which is why this
 * is a safe answer rather than a guess at another store listing.
 */
export const MANAGER_FALLBACK: UserscriptManager = {
  id: "other",
  store: "tampermonkey.net",
  url: "https://www.tampermonkey.net/",
};

/**
 * The listing for whichever browser is asking.
 *
 * Order matters. Edge's user agent contains "Chrome/" as well as "Edg/", and
 * Firefox's contains neither, so the specific tokens are checked first and
 * everything else falls through to Tampermonkey's own chooser.
 */
export function managerFor(userAgent: string): UserscriptManager {
  if (/Edg[A-Za-z]*\//.test(userAgent)) return EDGE;
  if (/Firefox\//.test(userAgent)) return FIREFOX;
  if (/Chrome\//.test(userAgent)) return CHROME;
  return MANAGER_FALLBACK;
}
