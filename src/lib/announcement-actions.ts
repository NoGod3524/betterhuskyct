import type { Announcement } from "./announcements.ts";
import { postedTime } from "./announcements.ts";
import { dayKey, findDates, type Basis, type DateOption, type DayParts, type FoundDate } from "./announcement-dates.ts";
import { sentencesOf } from "./announcement-sentences.ts";

export { sentencesOf };

/**
 * Things an announcement may ask a student to do, found by rules and nothing else.
 *
 * Every candidate carries the sentence it came from, the part of it that is the date, and the
 * reasons it was picked, and none of them goes to the to-do list until the student says so. Where
 * the text does not settle something (a year, the order of "3/4", which Friday), the candidate is
 * marked to be checked and the day is left for the student rather than guessed. What is shown is
 * always the announcement's own words: nothing here writes a summary.
 */

export type ActionKind = "deadline" | "exam" | "quiz" | "no-class" | "change" | "mention";

export type Candidate = {
  /** The same on every read of the same text, so a sync never makes it twice. */
  id: string;
  announcementId: string;
  kind: ActionKind;
  /** A suggested name for the to-do, in the announcement's words. The student may change it. */
  title: string;
  /** The sentence as written, and where in it the date is, for showing it marked. */
  sentence: string;
  /** Where the sentence is from. */
  from: "title" | "text";
  match: { start: number; end: number } | null;
  /** The day, when settled; null when the student has to choose or there is none. */
  date: DayParts | null;
  options: DateOption[];
  /** `HH:MM` only when the text wrote a time; with none the item is for the day. */
  time: string | null;
  /** The words that made it a candidate, as the text wrote them. */
  keywords: string[];
  basis: Basis[];
  /** Whether the student should look at it twice: something was not settled. */
  check: boolean;
  /** The sentence also speaks of a change ("moved", "postponed"). */
  changed: boolean;
};

const CANCEL = /\bcancel+ed\b|\bcancell?ation\b|\bno (?:class|lecture|lab|recitation|discussion|section|meeting)s?\b|\bwill not meet\b|\bwon'?t meet\b|\bcalled off\b/i;
const EXAM = /\b(?:exams?|midterms?|final exams?|tests?)\b|\bfinals?\b(?!\s+(?:project|paper|presentation|draft|report|essay|assignment|portfolio|submission))/i;
const QUIZ = /\bquiz(?:zes)?\b/i;
const DEADLINE = /\b(?:due|deadline|submit(?:ted)?|submission|turn(?:ed)? in|hand(?:ed)? in|upload(?:ed)?|closes?|complete(?:d)? by|must be (?:completed|submitted))\b/i;
const WORK = /\b(?:assignments?|homework|hw|problem sets?|psets?|projects?|papers?|essays?|reports?|labs?|discussion posts?|reading responses?|presentations?|worksheets?|modules?|exercises?)\b/i;
const CHANGE = /\b(?:postponed|moved|rescheduled|pushed (?:back|to)|extended|extension|changed to|now (?:due|on|will be))\b/i;
const NAMED_WORK = /\b(quiz|exam|midterm|final exam|homework|hw|assignment|project|paper|essay|report|lab|problem set|presentation|worksheet|module|exercise|reading response)s?\s*#?\s*(\d{1,2}|[ivx]{1,4})?\b/i;

const CHECK_BASIS: ReadonlySet<Basis> = new Set(["year-unknown", "order-ambiguous", "weekday-mismatch", "relative-unresolved", "range", "posting-unknown"]);

/** FNV-1a, as hex: stable and cheap, as the announcements' own ids are. */
function hash(value: string): string {
  let accumulator = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    accumulator ^= value.charCodeAt(index);
    accumulator = Math.imul(accumulator, 0x01000193);
  }
  return (accumulator >>> 0).toString(16).padStart(8, "0");
}

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

function titleFor(sentence: string, announcementTitle: string): string {
  const named = NAMED_WORK.exec(sentence) ?? NAMED_WORK.exec(announcementTitle);
  if (named) {
    const noun = named[1].toLowerCase() === "hw" ? "HW" : named[1].replace(/^./, (letter) => letter.toUpperCase());
    return named[2] ? `${noun} ${named[2].toUpperCase()}` : noun;
  }
  return announcementTitle.slice(0, 80);
}

export function kindOf(sentence: string): { kind: ActionKind | null; keywords: string[]; changed: boolean } {
  const keywords: string[] = [];
  const note = (pattern: RegExp) => {
    const match = pattern.exec(sentence);
    if (match) keywords.push(match[0].toLowerCase());
    return Boolean(match);
  };
  const cancel = note(CANCEL);
  const exam = note(EXAM);
  const quiz = note(QUIZ);
  const deadline = note(DEADLINE);
  const work = note(WORK);
  const change = note(CHANGE);
  const changed = change;
  if (cancel) return { kind: "no-class", keywords, changed };
  if (exam) return { kind: "exam", keywords, changed };
  if (quiz) return { kind: "quiz", keywords, changed };
  if (deadline) return { kind: "deadline", keywords, changed };
  if (change && work) return { kind: "change", keywords, changed };
  return { kind: null, keywords: [], changed: false };
}

type Source = { text: string; from: "title" | "text" };

const MAX_UNDATED_PER_ANNOUNCEMENT = 4;
const MAX_CANDIDATES_PER_ANNOUNCEMENT = 24;

/**
 * The candidates in one announcement. Dates are found with `postedAt` as the posting time when the
 * page stated it, and with none otherwise.
 */
export function extractCandidates(announcement: Pick<Announcement, "id" | "title" | "body" | "posted">): Candidate[] {
  const postedAt = postedTime(announcement.posted);
  const sources: Source[] = [{ text: oneLine(announcement.title), from: "title" }, ...sentencesOf(announcement.body).map((text) => ({ text, from: "text" as const }))];
  const out: Candidate[] = [];
  const seen = new Set<string>();
  let undated = 0;

  for (const { text, from } of sources) {
    const { kind, keywords, changed } = kindOf(text);
    const dates = findDates(text, postedAt);

    if (kind === null) {
      // A date with no word to say what it is for: shown, not suggested. A month named, or a year
      // written, is what makes it a date; "1/2" with nothing else could be a fraction.
      for (const date of dates) {
        const named = date.basis.includes("month-day") || date.basis.includes("iso") || (date.basis.includes("numeric") && date.basis.includes("year-stated"));
        if (named) push(out, seen, announcement, text, from, "mention", [], false, date);
      }
      continue;
    }

    if (dates.length === 0) {
      // No date in the sentence: it may still be something to do, so the student can give the day.
      if (kind !== "no-class" && kind !== "change" && /\b(?:due|deadline|submit|turn in|hand in|exam|midterm|quiz)\b/i.test(text) && undated < MAX_UNDATED_PER_ANNOUNCEMENT) {
        undated += push(out, seen, announcement, text, from, kind, keywords, changed, null) ? 1 : 0;
      }
      continue;
    }
    for (const date of dates) push(out, seen, announcement, text, from, kind, keywords, changed, date);
  }
  // A sentence with no day for something that another sentence gives a day is the same thing said twice.
  const dated = new Set(out.filter((candidate) => candidate.match !== null).map((candidate) => `${candidate.kind}|${candidate.title.toLowerCase()}`));
  return out
    .filter((candidate) => candidate.match !== null || !dated.has(`${candidate.kind}|${candidate.title.toLowerCase()}`))
    .slice(0, MAX_CANDIDATES_PER_ANNOUNCEMENT);
}

function push(
  out: Candidate[],
  seen: Set<string>,
  announcement: Pick<Announcement, "id" | "title">,
  sentence: string,
  from: "title" | "text",
  kind: ActionKind,
  keywords: string[],
  changed: boolean,
  found: FoundDate | null,
): boolean {
  const date = found?.date ?? null;
  const basis: Basis[] = found ? found.basis : ["no-date"];
  const title = titleFor(sentence, announcement.title);
  const key = `${kind}|${found && date ? dayKey(date) : found ? found.text.toLowerCase() : "none"}|${title.toLowerCase()}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const check = !found || date === null || kind === "mention" || basis.some((code) => CHECK_BASIS.has(code));
  out.push({
    id: hash(`${announcement.id}|${kind}|${oneLine(sentence).toLowerCase()}|${found?.start ?? "x"}|${found && date ? dayKey(date) : ""}`),
    announcementId: announcement.id,
    kind,
    title,
    sentence,
    from,
    match: found ? { start: found.start, end: found.end } : null,
    date,
    options: found?.options ?? [],
    time: found?.time ?? null,
    keywords,
    basis,
    check,
    changed,
  });
  return true;
}

/** Candidates that can go to the to-do: a class that is cancelled has nothing to hand in. */
export function isAddable(candidate: Candidate): boolean {
  return candidate.kind !== "no-class";
}

/** Whether a text speaks of a class or meeting being cancelled. */
export function mentionsCancellation(text: string): boolean {
  return CANCEL.test(text);
}
