"use client";

import { useMemo, useSyncExternalStore } from "react";

import { DECISIONS_CHANGED, DECISIONS_KEY, parseDecisions, type Decisions } from "@/lib/announcement-decisions";
import { parseVersions, recordVersions, VERSIONS_CHANGED, VERSIONS_KEY, type VersionStore } from "@/lib/announcement-versions";
import type { Announcement } from "@/lib/announcements";

function subscribe(onChange: () => void) {
  window.addEventListener(VERSIONS_CHANGED, onChange);
  window.addEventListener(DECISIONS_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(VERSIONS_CHANGED, onChange);
    window.removeEventListener(DECISIONS_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** What each announcement said each time it was saved. Empty on the server. */
export function useVersionStore(): VersionStore {
  const raw = useSyncExternalStore(subscribe, () => read(VERSIONS_KEY), () => null);
  return useMemo(() => parseVersions(raw), [raw]);
}

/** What the student has decided about the candidates. */
export function useDecisions(): Decisions {
  const raw = useSyncExternalStore(subscribe, () => read(DECISIONS_KEY), () => null);
  return useMemo(() => parseDecisions(raw), [raw]);
}

/** Changes the decisions, from what they are now in storage (not from what a render last saw). */
export function updateDecisions(change: (current: Decisions) => Decisions): void {
  try {
    const next = change(parseDecisions(window.localStorage.getItem(DECISIONS_KEY)));
    window.localStorage.setItem(DECISIONS_KEY, JSON.stringify(next));
    window.dispatchEvent(new window.Event(DECISIONS_CHANGED));
  } catch {
    // Blocked or full storage: nothing is kept.
  }
}

/** Saves what the announcements say now as new versions where they differ from the last. */
export function recordAnnouncementVersions(announcements: readonly Announcement[]): void {
  if (announcements.length === 0) return;
  try {
    const current = parseVersions(window.localStorage.getItem(VERSIONS_KEY));
    const next = recordVersions(current, announcements, new Date());
    if (next === current) return;
    window.localStorage.setItem(VERSIONS_KEY, JSON.stringify(next));
    window.dispatchEvent(new window.Event(VERSIONS_CHANGED));
  } catch {
    // As above.
  }
}
