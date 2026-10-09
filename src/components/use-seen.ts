"use client";

import { useSyncExternalStore } from "react";

import { SEEN_ANNOUNCEMENTS_KEY, SEEN_CHANGED, SEEN_FILES_KEY } from "@/lib/seen";

function subscribe(onChange: () => void) {
  window.addEventListener(SEEN_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SEEN_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** When the student last left the Announcements page, or null. The server knows nothing of it. */
export function useAnnouncementsSeenAt(): string | null {
  return useSyncExternalStore(subscribe, () => read(SEEN_ANNOUNCEMENTS_KEY), () => null);
}

/** The stored list of file keys as text (parse it with `parseSeenFiles`), or null. */
export function useSeenFilesRaw(): string | null {
  return useSyncExternalStore(subscribe, () => read(SEEN_FILES_KEY), () => null);
}

/** Tells the parts of the page that read the above that they changed. */
export function announceSeenChanged() {
  window.dispatchEvent(new window.Event(SEEN_CHANGED));
}
