"use client";

import { useSyncExternalStore } from "react";

import { applyTheme, readTheme, saveTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

/**
 * The theme choice, read from this browser's storage. The server has no
 * storage and renders "system"; the browser then reads the real choice, so
 * the first paint never disagrees with the server's markup.
 */
const themeListeners = new Set<() => void>();
function subscribeTheme(listener: () => void) {
  themeListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    themeListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(
    subscribeTheme,
    () => readTheme(window.localStorage),
    () => "system" as Theme,
  );
  const choose = (next: Theme) => {
    saveTheme(next, window.localStorage);
    applyTheme(next, document.documentElement);
    for (const listener of themeListeners) listener();
  };
  return [theme, choose];
}
