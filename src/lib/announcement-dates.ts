/**
 * Dates in an announcement's text, found by rules, with what is known and not known about each.
 *
 * The aim is not to understand every sentence but never to mislead: a date is given only when the
 * text writes it out; a relative one ("tomorrow") is worked out only from a posting time the page
 * stated, and one that cannot be ("next class", a bare "Friday") is kept as the text's own words
 * with options for the student to pick. A date with no time is a date: no time is made up for it.
 */

export type DayParts = { year: number; month: number; day: number };

/** What was understood and why, so the page can say so. Each is a code the page words in its own language. */
export type Basis =
  | "month-day" // "October 14", month named
  | "numeric" // "10/14"
  | "iso" // "2026-10-14"
  | "relative" // "tomorrow", worked out from the posting time
  | "year-stated"
  | "year-from-posting" // no year written; taken from the posting time
  | "year-unknown" // no year written and no posting time to take it from
  | "order-ambiguous" // "3/4" could be March 4 or April 3
  | "weekday-mismatch" // the weekday written is not that date's weekday
  | "relative-unresolved" // "next Friday", "next class": left for the student
  | "range" // "Oct 14-16"
  | "posting-unknown" // a relative expression, but the posting time was not given
  | "no-date"; // the sentence says what is to be done but writes no day

export type DateOption = { date: DayParts; note: "later" | "earlier" | "us" | "day-first" | "start" | "end" | "next" | "following" | "year" };

export type FoundDate = {
  /** The text it was found in: `start` and `end` are positions in the sentence. */
  start: number;
  end: number;
  text: string;
  /** The day, when the text and what is known settle it; null when the student has to choose. */
  date: DayParts | null;
  /** Days the student may choose between when `date` is null (or to correct it). */
  options: DateOption[];
  /** `HH:MM`, 24-hour, only when the text writes a time next to this date; otherwise null. */
  time: string | null;
  basis: Basis[];
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_RE = "(sunday|monday|tuesday|wednesday|thursday|friday|saturday|mon|tues?|wed|thu(?:rs?)?|fri)";
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };

const weekdayIndex = (word: string) => WEEKDAYS.findIndex((name) => name.startsWith(word.toLowerCase().slice(0, 3)));

export function isRealDay({ year, month, day }: DayParts): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const weekdayOf = ({ year, month, day }: DayParts) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();

export function addDaysTo(day: DayParts, days: number): DayParts {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

const daysBetween = (from: DayParts, to: DayParts) =>
  Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000);

export function dayKey({ year, month, day }: DayParts): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The local calendar day of a moment. */
export function dayOfInstant(at: number): DayParts {
  const date = new Date(at);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

type Raw = {
  start: number;
  end: number;
  text: string;
  month?: number;
  day?: number;
  year?: number | null;
  weekday?: number | null;
  numeric?: boolean;
  ambiguousWith?: { month: number; day: number };
  range?: { endDay: number };
  iso?: boolean;
  relative?: { kind: "today" | "tomorrow" | "yesterday" | "in-days" | "weekday" | "next-weekday" | "this-weekday" | "next-week"; days?: number; weekday?: number };
};

/** Whether `start..end` overlaps a span already taken. */
const overlaps = (taken: Array<[number, number]>, start: number, end: number) => taken.some(([a, b]) => start < b && end > a);

function findRaw(sentence: string): Raw[] {
  const found: Raw[] = [];
  const taken: Array<[number, number]> = [];
  const take = (raw: Raw) => {
    if (overlaps(taken, raw.start, raw.end)) return;
    taken.push([raw.start, raw.end]);
    found.push(raw);
  };

  // 2026-10-14
  for (const match of sentence.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    take({ start: match.index!, end: match.index! + match[0].length, text: match[0], year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), iso: true });
  }

  // Friday, October 17th, 2026 / Oct. 14 / October 14-16
  const named = new RegExp(`(?:\\b${WEEKDAY_RE}\\.?,?\\s+)?\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d|:\\d)(?:,?\\s+(\\d{4})\\b)?`, "gi");
  for (const match of sentence.matchAll(named)) {
    const month = MONTHS[match[2].toLowerCase()];
    let end = match.index! + match[0].length;
    let text = match[0];
    let range: Raw["range"];
    if (match[4] === undefined) {
      const rest = /^\s*(?:-|–|—|to|through|thru)\s*(\d{1,2})(?:st|nd|rd|th)?(?!\d|:|\s*[ap]\.?m)/i.exec(sentence.slice(end));
      if (rest) {
        range = { endDay: Number(rest[1]) };
        end += rest[0].length;
        text = sentence.slice(match.index!, end);
      }
    }
    take({ start: match.index!, end, text, month, day: Number(match[3]), year: match[4] ? Number(match[4]) : null, weekday: match[1] ? weekdayIndex(match[1]) : null, range });
  }

  // 14 October / 14th of October 2026
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b\\.?(?:,?\\s+(\\d{4})\\b)?`, "gi");
  for (const match of sentence.matchAll(dayFirst)) {
    take({ start: match.index!, end: match.index! + match[0].length, text: match[0], month: MONTHS[match[2].toLowerCase()], day: Number(match[1]), year: match[3] ? Number(match[3]) : null });
  }

  // 10/14, 10/14/26, 10/14/2026
  for (const match of sentence.matchAll(/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?![\d/])/g)) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = match[3] ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])) : null;
    let month = first;
    let day = second;
    let ambiguousWith: Raw["ambiguousWith"];
    if (first > 12 && second <= 12) {
      month = second;
      day = first;
    } else if (first <= 12 && second <= 12 && first !== second) {
      ambiguousWith = { month: second, day: first };
    }
    const lead = new RegExp(`\\b${WEEKDAY_RE}\\.?,?\\s+$`, "i").exec(sentence.slice(0, match.index!));
    take({ start: match.index! - (lead ? lead[0].length : 0), end: match.index! + match[0].length, text: sentence.slice(match.index! - (lead ? lead[0].length : 0), match.index! + match[0].length), month, day, year, weekday: lead ? weekdayIndex(lead[1]) : null, numeric: true, ambiguousWith });
  }

  // tomorrow, tonight, in 3 days, next Friday, this Friday, Friday
  for (const match of sentence.matchAll(/\b(today|tonight|tomorrow|yesterday)\b/gi)) {
    const word = match[1].toLowerCase();
    take({ start: match.index!, end: match.index! + match[0].length, text: match[0], relative: { kind: word === "tomorrow" ? "tomorrow" : word === "yesterday" ? "yesterday" : "today" } });
  }
  for (const match of sentence.matchAll(/\bin\s+(\d{1,2}|one|two|three|four|five|six|seven|ten)\s+(day|days|week|weeks)\b/gi)) {
    const n = /^\d/.test(match[1]) ? Number(match[1]) : NUMBER_WORDS[match[1].toLowerCase()];
    take({ start: match.index!, end: match.index! + match[0].length, text: match[0], relative: { kind: "in-days", days: /week/i.test(match[2]) ? n * 7 : n } });
  }
  for (const match of sentence.matchAll(new RegExp(`\\b(next|this)\\s+${WEEKDAY_RE}\\b`, "gi"))) {
    take({ start: match.index!, end: match.index! + match[0].length, text: match[0], relative: { kind: match[1].toLowerCase() === "next" ? "next-weekday" : "this-weekday", weekday: weekdayIndex(match[2]) } });
  }
  for (const match of sentence.matchAll(/\bnext\s+week\b/gi)) {
    take({ start: match.index!, end: match.index! + match[0].length, text: match[0], relative: { kind: "next-week" } });
  }
  for (const match of sentence.matchAll(new RegExp(`\\b${WEEKDAY_RE}\\b(?!\\s*,?\\s*${MONTH_RE})`, "gi"))) {
    take({ start: match.index!, end: match.index! + match[0].length, text: match[0], relative: { kind: "weekday", weekday: weekdayIndex(match[1]) } });
  }

  return found.sort((left, right) => left.start - right.start);
}

/** A time written next to a date: "11:59 PM", "2pm", "noon". Midnight is not taken: it is the end or the start of a day. */
function findTimes(sentence: string): Array<{ start: number; end: number; time: string }> {
  const out: Array<{ start: number; end: number; time: string }> = [];
  for (const match of sentence.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b\.?/gi)) {
    const hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    if (hour < 1 || hour > 12 || minute > 59) continue;
    const h24 = (hour % 12) + (/p/i.test(match[3]) ? 12 : 0);
    out.push({ start: match.index!, end: match.index! + match[0].length, time: `${String(h24).padStart(2, "0")}:${String(minute).padStart(2, "0")}` });
  }
  for (const match of sentence.matchAll(/\bnoon\b/gi)) out.push({ start: match.index!, end: match.index! + 4, time: "12:00" });
  for (const match of sentence.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*[ap]\.?m)/gi)) {
    out.push({ start: match.index!, end: match.index! + match[0].length, time: `${match[1].padStart(2, "0")}:${match[2]}` });
  }
  return out.sort((left, right) => left.start - right.start);
}

/**
 * Every date in one sentence.
 *
 * `postedAt` is when the announcement was posted, as a moment in the reader's zone, only when the
 * page stated it; with none, nothing relative is worked out and no year is taken from it. It is
 * never the day the announcement was read.
 */
export function findDates(sentence: string, postedAt: number | null): FoundDate[] {
  const posted = postedAt === null ? null : dayOfInstant(postedAt);
  const times = findTimes(sentence);
  const result: FoundDate[] = [];

  for (const raw of findRaw(sentence)) {
    const basis: Basis[] = [];
    let date: DayParts | null = null;
    let options: DateOption[] = [];

    if (raw.relative) {
      const rel = raw.relative;
      if (!posted) {
        // "tomorrow" only needs the posting time; a weekday needs the student's choice as well.
        if (rel.kind === "today" || rel.kind === "tomorrow" || rel.kind === "yesterday" || rel.kind === "in-days") basis.push("posting-unknown");
        else basis.push("relative-unresolved", "posting-unknown");
      } else if (rel.kind === "today") {
        date = posted;
        basis.push("relative");
      } else if (rel.kind === "tomorrow") {
        date = addDaysTo(posted, 1);
        basis.push("relative");
      } else if (rel.kind === "yesterday") {
        date = addDaysTo(posted, -1);
        basis.push("relative");
      } else if (rel.kind === "in-days" && rel.days !== undefined) {
        date = addDaysTo(posted, rel.days);
        basis.push("relative");
      } else if (rel.kind === "weekday" || rel.kind === "this-weekday" || rel.kind === "next-weekday") {
        // Which Friday is not said. The next one after posting, and the one after, are offered.
        const ahead = (((rel.weekday ?? 0) - weekdayOf(posted) + 7) % 7) || 7;
        const first = addDaysTo(posted, ahead);
        options = [{ date: first, note: "next" }, { date: addDaysTo(first, 7), note: "following" }];
        // "Friday" and "this Friday" are the next one after the posting. "Next Friday" is the one in the
        // week after this one (weeks start on Sunday). Either way it stays marked to be checked.
        const weekAfter = addDaysTo(posted, 7 - weekdayOf(posted) + (rel.weekday ?? 0));
        date = rel.kind === "next-weekday" ? weekAfter : first;
        basis.push("relative-unresolved");
      } else {
        basis.push("relative-unresolved");
      }
      result.push({ start: raw.start, end: raw.end, text: raw.text, date, options, time: null, basis });
      continue;
    }

    let year = raw.year ?? null;
    const month = raw.month!;
    const day = raw.day!;
    if (raw.iso || (raw.year !== null && raw.year !== undefined)) {
      basis.push(raw.iso ? "iso" : raw.numeric ? "numeric" : "month-day", "year-stated");
    } else {
      basis.push(raw.numeric ? "numeric" : "month-day");
      if (posted) {
        year = posted.year;
        // A date well before the posting is next year's (a December post that names January).
        if (isRealDay({ year, month, day }) && daysBetween(posted, { year, month, day }) < -30) year += 1;
        basis.push("year-from-posting");
      } else {
        basis.push("year-unknown");
      }
    }

    if (raw.range) {
      basis.push("range");
      const startDay = year !== null ? { year, month, day } : null;
      const endDay = year !== null ? { year, month, day: raw.range.endDay } : null;
      if (startDay && endDay && isRealDay(startDay) && isRealDay(endDay)) options = [{ date: startDay, note: "start" }, { date: endDay, note: "end" }];
      result.push({ start: raw.start, end: raw.end, text: raw.text, date: null, options, time: null, basis });
      continue;
    }

    if (year === null) {
      // The student chooses the year; the next two on which that day falls after today are no reason to pick one for them.
      result.push({ start: raw.start, end: raw.end, text: raw.text, date: null, options: [], time: null, basis: [...basis] });
      continue;
    }

    const candidate = { year, month, day };
    if (!isRealDay(candidate)) continue;
    if (raw.ambiguousWith) {
      basis.push("order-ambiguous");
      const other = { year, month: raw.ambiguousWith.month, day: raw.ambiguousWith.day };
      options = [{ date: candidate, note: "us" }];
      if (isRealDay(other)) options.push({ date: other, note: "day-first" });
      // Both readings are offered. One is taken only when the other lies far from the posting (10/4
      // posted on October 1 is not April 10), and it is still marked to be checked.
      let chosen: DayParts | null = null;
      if (posted && options.length === 2) {
        const near = options.filter((option) => {
          const gap = daysBetween(posted, option.date);
          return gap >= -14 && gap <= 120;
        });
        if (near.length === 1) chosen = near[0].date;
      }
      // "Sunday 10/11": the weekday that was written belongs to one reading only.
      if (!chosen && raw.weekday !== null && raw.weekday !== undefined) {
        const fits = options.filter((option) => weekdayOf(option.date) === raw.weekday);
        if (fits.length === 1) chosen = fits[0].date;
      }
      result.push({ start: raw.start, end: raw.end, text: raw.text, date: chosen, options, time: null, basis });
      continue;
    }
    if (raw.weekday !== null && raw.weekday !== undefined && weekdayOf(candidate) !== raw.weekday) basis.push("weekday-mismatch");
    result.push({ start: raw.start, end: raw.end, text: raw.text, date: candidate, options: [], time: null, basis });
  }

  // "Posted it today, due Thursday, Oct 8": the posting day is not the event's day. "Open from Oct 10
  // till Oct 16": the event is at the window's end.
  const kept = result.filter((found, index) => {
    if (found.basis.includes("relative") && /^(?:today|tonight|yesterday)$/i.test(found.text) && result.some((other) => other !== found)) return false;
    const next = result[index + 1];
    if (next && /^[\s,]*(?:\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)?[\s,]*(?:until|till|through|thru|to)\s*$/i.test(sentence.slice(found.end, next.start))) return false;
    return true;
  });
  result.length = 0;
  result.push(...kept);

  // A time goes to the date it is written next to, within a short way, and each time to one date only.
  for (const time of times) {
    let nearest: FoundDate | null = null;
    let best = 41;
    for (const date of result) {
      if (date.time) continue;
      const gap = time.start >= date.end ? time.start - date.end : date.start >= time.end ? date.start - time.end : 0;
      if (gap < best) {
        best = gap;
        nearest = date;
      }
    }
    if (nearest) nearest.time = time.time;
  }
  return result;
}
