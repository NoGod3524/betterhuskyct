/**
 * UConn's academic calendar, from the Registrar's page: when terms start and
 * end, breaks, the add/drop and withdrawal deadlines, finals. It is the same
 * for every student, so it is read on the server and offered to everyone,
 * with no helper and no HuskyCT.
 *
 * The page is a table per term under a heading such as "Fall 2026", with a
 * date ("Mon, Aug 31", "Sun, Nov 22-Sun, Nov 29") and what happens. A date
 * cell can span two rows, one per event on that day. Rows carry no year: the
 * heading's year is used, and the weekday written beside the date decides
 * between it and the next or previous year, so January in a fall table lands
 * in the right one.
 */

export const REGISTRAR_CALENDAR_URL = "https://registrar.uconn.edu/academic-calendar/";
export const ACADEMIC_CALENDAR_ENDPOINT = "/api/academic-calendar";
export const ACADEMIC_CALENDAR_STORAGE_KEY = "huskypilot.academicCalendar.v1";

export type AcademicImportance = "major" | "minor";

export type AcademicEvent = {
  id: string;
  /** Short, as shown on the calendar. */
  title: string;
  /** The Registrar's own words, in full. */
  detail: string;
  /** `YYYY-MM-DD`, first and last day (the same for one day). */
  start: string;
  end: string;
  /** "Fall 2026". */
  term: string;
  importance: AcademicImportance;
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function plain(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function iso(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * One "Mon, Aug 31" as a day, using the weekday to pick the year: the term's
 * year first, then the year after, then the one before. Null when no year fits,
 * which means the page is not what this expects and the row is left out.
 */
export function resolveDay(text: string, year: number): string | null {
  const match = /^\s*([A-Za-z]{3})[a-z]*\.?,?\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*$/.exec(text);
  if (!match) return null;
  const weekday = WEEKDAYS[match[1].toLowerCase()];
  const month = MONTHS[match[2].toLowerCase()];
  const day = Number(match[3]);
  if (weekday === undefined || month === undefined) return null;
  for (const candidate of [year, year + 1, year - 1]) {
    const date = new Date(Date.UTC(candidate, month, day));
    if (date.getUTCMonth() === month && date.getUTCDay() === weekday) return iso(date);
  }
  return null;
}

/** "Sun, Nov 22-Sun, Nov 29" or "Mon, Aug 31" as first and last day. */
export function resolveRange(text: string, year: number): { start: string; end: string } | null {
  const parts = text.split(/\s*[-–—]\s*(?=[A-Za-z]{3})/);
  if (parts.length > 2) return null;
  const start = resolveDay(parts[0], year);
  const end = parts[1] ? resolveDay(parts[1], year) : start;
  if (!start || !end || end < start) return null;
  return { start, end };
}

/** Dates for degree candidates, staff and graduate students, not for an undergraduate's calendar. */
const LEFT_OUT =
  /thesis|dissertation|degree audit|plan b|master.?s|doctoral|grades due|conferral|plan of study|credit by examination|incomplete or absence|dean.?s signature|semester grades/i;

/** What a student plans a term around, shown loudly. */
const MAJOR =
  /semester begins|last day of .*classes|recess|no classes|reading days?|final examinations?|add or drop|adding and dropping|withdraw|pass.fail|mid-semester grading|commencement ceremon|emergency closing|spring break|thanksgiving/i;

export function importanceOf(text: string): AcademicImportance | null {
  if (LEFT_OUT.test(text)) return null;
  return MAJOR.test(text) ? "major" : "minor";
}

/**
 * A title short enough for a calendar cell: the first sentence, without the
 * page's "(see …)" asides. The add/drop deadline opens with "Tenth day of
 * classes.", which says nothing on its own, so it is named for what it is.
 */
export function shortTitle(text: string): string {
  if (/add or drop|adding and dropping/i.test(text) && /^tenth day/i.test(text)) return "Last day to add or drop courses";
  const first = text
    .replace(/ via (the )?Student Administration System/i, "")
    .split(/(?<=[a-z)])\.\s/)[0].replace(/\s*\((see|for) [^)]*\)/gi, "").replace(/\.$/, "").trim();
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
}

function idFor(term: string, start: string, title: string): string {
  return `academic-${start}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
}

/**
 * The Registrar's page as events. Anything that does not read as expected — a
 * row without a usable date, a table without a term heading — is left out
 * rather than guessed at.
 */
export function parseAcademicCalendar(html: string): AcademicEvent[] {
  const events: AcademicEvent[] = [];
  const headings = [...html.matchAll(/<h[2-4][^>]*>\s*((Fall|Winter|Spring|Summer)\s+(\d{4}))\s*<\/h[2-4]>/gi)];
  headings.forEach((heading, index) => {
    const term = heading[1].replace(/\s+/g, " ");
    const year = Number(heading[3]);
    const from = heading.index! + heading[0].length;
    const to = index + 1 < headings.length ? headings[index + 1].index! : html.length;
    const tableMatch = /<table[\s\S]*?<\/table>/i.exec(html.slice(from, to));
    if (!tableMatch) return;

    let carried: string | null = null;
    let carriedRows = 0;
    for (const row of tableMatch[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)];
      if (cells.length === 0) continue; // the header row
      let dateText: string;
      let eventHtml: string;
      if (cells.length >= 2) {
        dateText = plain(cells[0][2]);
        eventHtml = cells[1][2];
        const span = /rowspan="?(\d+)/i.exec(cells[0][1]);
        carried = span ? dateText : null;
        carriedRows = span ? Number(span[1]) - 1 : 0;
      } else if (carried && carriedRows > 0) {
        // The date cell above spans this row too.
        dateText = carried;
        eventHtml = cells[0][2];
        carriedRows -= 1;
      } else {
        continue;
      }

      const range = resolveRange(dateText, year);
      const detail = plain(eventHtml);
      if (!range || !detail) continue;
      const importance = importanceOf(detail);
      if (!importance) continue;
      const title = shortTitle(detail);
      events.push({ id: idFor(term, range.start, title), title, detail, start: range.start, end: range.end, term, importance });
    }
  });
  return events;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Events as the endpoint or storage hands them over, checked; anything malformed is dropped. */
export function parseAcademicEvents(value: unknown): AcademicEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const { id, title, detail, start, end, term, importance } = entry;
    if (typeof id !== "string" || typeof title !== "string" || !title || typeof detail !== "string") return [];
    if (typeof start !== "string" || !DAY.test(start) || typeof end !== "string" || !DAY.test(end) || end < start) return [];
    if (typeof term !== "string" || (importance !== "major" && importance !== "minor")) return [];
    return [{ id, title, detail, start, end, term, importance }];
  });
}

/** Each day an event covers, `YYYY-MM-DD`, for laying it over the month. */
export function academicByDay(events: AcademicEvent[]): Map<string, AcademicEvent[]> {
  const byDay = new Map<string, AcademicEvent[]>();
  for (const event of events) {
    const [year, month, day] = event.start.split("-").map(Number);
    const cursor = new Date(Date.UTC(year, month - 1, day));
    // A range is a few days to a few weeks; the cap keeps a bad row from filling the year.
    for (let step = 0; step < 60; step += 1) {
      const key = iso(cursor);
      if (key > event.end) break;
      byDay.set(key, [...(byDay.get(key) ?? []), event]);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.importance === b.importance ? 0 : a.importance === "major" ? -1 : 1));
  return byDay;
}
