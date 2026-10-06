"use client";

import { useEffect, useState } from "react";

import {
  ACADEMIC_CALENDAR_ENDPOINT,
  ACADEMIC_CALENDAR_STORAGE_KEY,
  parseAcademicEvents,
  type AcademicEvent,
} from "@/lib/academic-calendar";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;


function readStored(): AcademicEvent[] {
  try {
    return parseAcademicEvents(JSON.parse(window.localStorage.getItem(ACADEMIC_CALENDAR_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

/**
 * UConn's academic calendar for the calendar page: the last copy kept in this
 * browser at once, so it shows offline, then the app's endpoint's, kept for
 * next time. Nothing personal is sent: it is the same for every student.
 *
 * `fetchImpl` has no default on purpose. The effect depends on it, and a
 * default function — even one declared once at the top of this file — is
 * inlined by the production minifier into a new function on every call, which
 * re-ran the effect on every render: hundreds of requests a second. Absent, it
 * stays `undefined`, and the browser's `fetch` is chosen inside the effect.
 */
export function useAcademicCalendar(fetchImpl?: FetchLike): AcademicEvent[] {
  const [events, setEvents] = useState<AcademicEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    // After the first paint, as the rest of what this browser keeps is.
    const timer = setTimeout(() => {
      if (!cancelled) setEvents(readStored());
    }, 0);

    (fetchImpl ?? ((input: string) => fetch(input)))(ACADEMIC_CALENDAR_ENDPOINT)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { events?: unknown } | null) => {
        const fresh = parseAcademicEvents(body?.events);
        if (cancelled || fresh.length === 0) return;
        setEvents(fresh);
        try {
          window.localStorage.setItem(ACADEMIC_CALENDAR_STORAGE_KEY, JSON.stringify(fresh));
        } catch {
          /* shown for this visit */
        }
      })
      .catch(() => undefined); // offline: the kept copy stands

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchImpl]);

  return events;
}
