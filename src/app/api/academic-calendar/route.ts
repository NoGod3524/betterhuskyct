import { parseAcademicCalendar, parseAcademicEvents, REGISTRAR_CALENDAR_URL, type AcademicEvent } from "@/lib/academic-calendar";
import snapshot from "@/lib/academic-calendar-snapshot.json" with { type: "json" };

// The calendar changes a few times a year; once a day is plenty.
export const revalidate = 86400;

/** Fewer rows than this means the page changed shape, not that the term has no dates. */
const MIN_EVENTS = 8;

/**
 * UConn's academic calendar, read from the Registrar's page and shared by
 * everyone who asks, so the page is fetched about once a day, not once per
 * student. When it cannot be read, or reads as far fewer dates than a year
 * has, the copy taken when this was written is served instead and said to be.
 */
export async function GET() {
  let events: AcademicEvent[] = [];
  try {
    const response = await fetch(REGISTRAR_CALENDAR_URL, {
      headers: { "User-Agent": "BetterHuskyCT (+https://github.com/NoGod3524/betterhuskyct)" },
      next: { revalidate },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) events = parseAcademicCalendar(await response.text());
  } catch {
    events = [];
  }

  const live = events.length >= MIN_EVENTS;
  return Response.json(
    { source: live ? "registrar" : "snapshot", events: live ? events : parseAcademicEvents(snapshot.events) },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
