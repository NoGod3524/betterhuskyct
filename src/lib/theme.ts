/**
 * Light, dark, or whatever the device uses.
 *
 * The choice is kept in this browser and applied as `data-theme` on <html>:
 * "light" or "dark" when chosen, absent when following the device, in which
 * case the stylesheet's `prefers-color-scheme` block decides. The colours
 * themselves are all CSS variables in globals.css; this only picks the set.
 */
export type Theme = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "huskypilot.theme.v1";
const THEMES: readonly Theme[] = ["system", "light", "dark"];

export function readTheme(storage: Pick<Storage, "getItem"> | null | undefined): Theme {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** The one after this, round the three: system → light → dark → system. */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}

export function applyTheme(theme: Theme, root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }) {
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function saveTheme(theme: Theme, storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined) {
  try {
    if (theme === "system") storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* the choice holds for this visit; the next starts from the device */
  }
}

/**
 * Run in <head> before anything is drawn, so a dark choice never flashes the
 * light page first. Plain ES5 on purpose: it runs before the app's code loads.
 */
export const THEME_BOOT_SCRIPT =
  "(function(){try{var t=localStorage.getItem(" +
  JSON.stringify(THEME_STORAGE_KEY) +
  ");if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();";
