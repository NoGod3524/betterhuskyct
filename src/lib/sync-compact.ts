/**
 * The sync link's own, compact shape (version 2).
 *
 * The same data as `SyncPayload`, written so that very little of it is spent on
 * repetition: events are rows rather than objects, a start is a number of minutes
 * when it can be, and every reference to an event (a tick, a done state, an
 * effort mark, a course pick) is that event's row number rather than its id. Only
 * what a phone needs is written at all — see the limits below.
 *
 * `compactLink` writes it and `expandLink` puts it back into the full shape, so
 * everything that reads a payload after this sees one form.
 */
import type { CalendarTask } from "./calendar-types.ts";
import type { Course } from "./courses.ts";
import type { DoneReason } from "./task-status.ts";
import type { SyncPayload } from "./sync.ts";

export const LINK_VERSION = 2;

/** How many announcements a link carries: the newest, the rest stay on the computer. */
export const LINK_ANNOUNCEMENTS = 25;
/** How much of each announcement's body a link carries: a preview, not the whole page. */
export const LINK_BODY_CHARS = 120;
/** How far back a link reaches for events. Older ones are not what a phone is for. */
export const LINK_PAST_DAYS = 30;
/** And how far ahead: a term is months long, and the far end of it stays on the computer. */
export const LINK_AHEAD_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const REASONS: readonly DoneReason[] = ["submitted", "graded"];

/** `null` for no kind, then the two kinds a feed names. */
const KIND_CODES = [null, "class", "assignment"] as const;

/** A row's id key: its UID when the id is the UID and start, else the whole id, marked. */
const WHOLE_ID = "!";

/** A time as minutes since the epoch when it is a whole minute, else as the text it was. */
function timeOut(value: string | null): number | string | null {
  if (value === null) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) && at % MINUTE_MS === 0 && new Date(at).toISOString() === value ? at / MINUTE_MS : value;
}

function timeIn(value: unknown): string | null {
  if (typeof value === "number") return new Date(value * MINUTE_MS).toISOString();
  return typeof value === "string" ? value : null;
}

/**
 * The payload as a version 2 link carries it, with the window, the caps and the
 * references to the events it keeps all applied here.
 */
export function compactLink(payload: SyncPayload): Record<string, unknown> {
  const now = Date.parse(payload.exportedAt);
  const from = now - LINK_PAST_DAYS * DAY_MS;
  const to = now + LINK_AHEAD_DAYS * DAY_MS;

  const courses = payload.courses.courses;
  const courseIndex = new Map(courses.map((course, index) => [course.id, index]));
  const courseRow = (id: string | null | undefined) => (id === null || id === undefined ? -1 : (courseIndex.get(id) ?? -1));

  // Events from every feed, in one run of rows. Each feed remembers how many it had.
  const kept: CalendarTask[] = [];
  const feeds = payload.feeds.map((feed) => {
    const inWindow = feed.events.filter((event) => {
      const at = Date.parse(event.start);
      return at >= from && at <= to;
    });
    kept.push(...inWindow);
    return { feed, count: inWindow.length };
  });
  const rowOf = new Map<string, number>();
  kept.forEach((event, row) => {
    if (!rowOf.has(event.id)) rowOf.set(event.id, row);
  });

  const events = kept.map((event) => {
    const suffix = `:${event.start}`;
    const fromUid = event.id.endsWith(suffix) && event.id.length > suffix.length;
    const key = fromUid ? event.id.slice(0, -suffix.length) : WHOLE_ID + event.id;
    const picked = payload.courses.assignments[event.id];
    // undefined: no pick of its own; null: "this row shows no course"; else the course.
    const pick = picked === undefined || (picked !== null && !courseIndex.has(picked)) ? null : courseRow(picked);
    return [
      key,
      event.title,
      timeOut(event.start),
      event.course,
      timeOut(event.end),
      event.dateKey,
      event.location,
      event.allDay ? 1 : 0,
      Math.max(0, KIND_CODES.indexOf(event.kind ?? null)),
      pick,
    ];
  });

  const rowsOf = (ids: Iterable<string>) => [...ids].map((id) => rowOf.get(id)).filter((row): row is number => row !== undefined);

  return {
    version: LINK_VERSION,
    exportedAt: payload.exportedAt,
    courses: courses.map((course) => [course.code, course.component, course.isDefault ? 1 : 0]),
    feeds: feeds.map(({ feed, count }) => [feed.name, courseRow(feed.courseId), feed.importedAt, count]),
    events,
    completed: rowsOf(payload.completedIds),
    done: Object.entries(payload.doneByHuskyct).flatMap(([id, reason]) => {
      const row = rowOf.get(id);
      return row === undefined ? [] : [row, REASONS.indexOf(reason)];
    }),
    reopened: rowsOf(payload.reopened),
    efforts: Object.entries(payload.efforts).flatMap(([id, level]) => {
      const row = rowOf.get(id);
      return row === undefined ? [] : [[row, level]];
    }),
    announcements: payload.announcements
      .slice(0, LINK_ANNOUNCEMENTS)
      .map((announcement) => [
        announcement.courseCode,
        announcement.title,
        announcement.body.slice(0, LINK_BODY_CHARS),
        announcement.posted,
      ]),
  };
}

/**
 * The full shape a version 2 link stands for, ready for the reader that takes a
 * version 1 payload. `null` when the link is not shaped as one of ours.
 */
export function expandLink(link: Record<string, unknown>): Record<string, unknown> | null {
  try {
    const rows = (value: unknown): unknown[][] => (Array.isArray(value) ? (value as unknown[][]) : []);
    const courses: Course[] = rows(link.courses).map(([code, component, isDefault], index) => ({
      id: `c${index}`,
      code: String(code),
      component: (component as Course["component"]) ?? null,
      isDefault: isDefault === 1,
    }));
    const courseAt = (row: unknown): string | null => (typeof row === "number" && row >= 0 && row < courses.length ? courses[row].id : null);

    const eventRows = rows(link.events);
    const ids = eventRows.map(([key, , start]) => {
      const startText = timeIn(start) ?? "";
      return typeof key === "string" && key.startsWith(WHOLE_ID) ? key.slice(WHOLE_ID.length) : `${key}:${startText}`;
    });
    const picks = new Map<string, string | null>();
    const eventsOf = eventRows.map(([, title, start, course, end, dateKey, location, allDay, kind, pick], row) => {
      const id = ids[row];
      if (pick !== null && pick !== undefined) picks.set(id, pick === -1 ? null : courseAt(pick));
      const kindText = KIND_CODES[Number(kind)] ?? null;
      return {
        id,
        title,
        course: course ?? null,
        start: timeIn(start),
        dateKey: dateKey ?? null,
        end: timeIn(end),
        allDay: allDay === 1,
        location: location ?? null,
        ...(kindText ? { kind: kindText } : {}),
      };
    });

    let offset = 0;
    const feeds = rows(link.feeds).map(([name, courseRowValue, importedAt, count]) => {
      const size = Number(count) || 0;
      const events = eventsOf.slice(offset, offset + size);
      offset += size;
      return { name: name ?? null, courseId: courseAt(courseRowValue), importedAt, events };
    });

    const idOf = (row: unknown) => (typeof row === "number" ? ids[row] : undefined);
    const completedIds = ((link.completed as unknown[] | undefined) ?? []).map(idOf).filter((id): id is string => id !== undefined);
    const doneByHuskyct: Record<string, DoneReason> = {};
    const doneFlat = (link.done as unknown[]) ?? [];
    for (let at = 0; at + 1 < doneFlat.length; at += 2) {
      const id = idOf(doneFlat[at]);
      const reason = REASONS[Number(doneFlat[at + 1])];
      if (id !== undefined && reason) doneByHuskyct[id] = reason;
    }
    const efforts: Record<string, string> = {};
    for (const [row, level] of rows(link.efforts)) {
      const id = idOf(row);
      if (id !== undefined && typeof level === "string") efforts[id] = level;
    }

    const assignments: Record<string, string | null> = {};
    for (const [id, pick] of picks) assignments[id] = pick;

    return {
      version: 1,
      exportedAt: link.exportedAt,
      feeds,
      completedIds,
      efforts,
      courses: { version: 1, courses, assignments },
      announcements: rows(link.announcements).map(([courseCode, title, body, posted]) => ({ courseCode, title, body, posted })),
      doneByHuskyct,
      reopened: (link.reopened as unknown[]).map(idOf).filter((id): id is string => id !== undefined),
    };
  } catch {
    return null;
  }
}
