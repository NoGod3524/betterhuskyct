"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useCalendar } from "@/components/calendar-provider";

import { CHANGES_CHANGED, CHANGES_KEY, markChangesRead, parseChanges, saveChanges, withChangesLock } from "@/lib/changes";

const UNAVAILABLE = Symbol("unavailable");

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGES_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGES_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(): string | null | typeof UNAVAILABLE {
  try {
    return window.localStorage.getItem(CHANGES_KEY);
  } catch {
    return UNAVAILABLE;
  }
}

/** The server and first browser render agree; saved entries arrive after hydration. */
export function useChanges() {
  const { now } = useCalendar();
  const raw = useSyncExternalStore(subscribe, read, () => undefined);
  const store = useMemo(() => parseChanges(typeof raw === "string" ? raw : null, now), [raw, now]);
  return { store, ready: raw !== undefined, unavailable: raw === UNAVAILABLE };
}

/** Read from storage at the click, so another tab's new entries survive. */
export async function markChangesAsRead(ids?: readonly string[]): Promise<boolean> {
  try {
    return await withChangesLock(() => {
      const current = parseChanges(window.localStorage.getItem(CHANGES_KEY));
      const next = markChangesRead(current, ids);
      if (next !== current) {
        saveChanges(window.localStorage, next);
        window.dispatchEvent(new window.Event(CHANGES_CHANGED));
      }
      return true;
    });
  } catch {
    return false;
  }
}
