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
  "https://raw.githubusercontent.com/NoGod3524/huskypilot/main/tools/huskyct-helper/huskyct-helper.user.js";

/** Its source and documentation, for anyone who wants to read it first. */
export const HELPER_SOURCE_URL =
  "https://github.com/NoGod3524/huskypilot/tree/main/tools/huskyct-helper";

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
