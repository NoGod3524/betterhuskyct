import { SummaryError, type SummaryProblem } from "./announcement-summary.ts";
import type { Announcement } from "./announcements.ts";
import { isDeadline, type CalendarTask } from "./calendar-types.ts";
import type { CustomEventInput } from "./custom-events.ts";
import { localDay, taskDate } from "./date-utils.ts";
import { contentHash } from "./content-hash.ts";
import { cleanSummary, isNotAToDo, MAX_PLAN_TEXT, parsePlanResult, PLAN_ITEM_KINDS, type PlanAnnouncement, type PlanItem, type PlanRequest } from "./plan-models.ts";
import type { SummaryChoice } from "./summary-choice.ts";
import type { ProviderId, SummaryLocale } from "./summary-models.ts";
import type { UndatedTodo } from "./undated-todos.ts";

/**
 * The page's side of finding dates with a model: what has been read, what was
 * found, and what the student has said about it.
 *
 * A model reads each syllabus once and each announcement once; what it finds
 * waits in a list until the student adds it or lets it go. Nothing goes into
 * the calendar without that, and something let go is not offered again.
 */

export const PLAN_ENDPOINT = "/api/plan/extract";
export const PLAN_STORAGE_KEY = "huskypilot.aiPlan.v1";

/** On turning this on, announcements older than this are history, not news to plan around. */
export const ANNOUNCEMENT_LOOKBACK_DAYS = 30;
const MAX_BATCH_ANNOUNCEMENTS = 20;
const MAX_BATCH_CHARACTERS = 20_000;
/** A source that fails this often is left until it changes, so a broken file does not spend quota every visit. */
export const MAX_FAILURES = 2;
const MAX_DECIDED = 3000;
const MAX_PENDING = 400;

export type SuggestionSource = "syllabus" | "announcement";

export type Suggestion = PlanItem & {
  id: string;
  course: string | null;
  from: SuggestionSource;
  /** The file's name, or the announcement's title. */
  fromLabel: string;
  foundAt: string;
  /** For one found in an announcement: which, so that reading it again can replace what it said before. */
  announcementId?: string;
};

/** A course's syllabus summed up, as the model wrote it; shown on the Materials page. */
export type SyllabusSummary = {
  text: string;
  /** The files it was read from. */
  files: string;
  locale: SummaryLocale;
  provider: ProviderId | null;
  at: string;
};

export type PlanState = {
  enabled: boolean;
  enabledAt: string | null;
  /** What each source looked like when it was read, by source key. */
  read: Record<string, string>;
  /** Failed reads of a source as it looks now. */
  failed: Record<string, { signature: string; count: number }>;
  pending: Suggestion[];
  /** What the student did with each suggestion, so a later read does not offer it again. */
  decided: Record<string, "added" | "dismissed">;
  /** Each course's syllabus summary, by HuskyCT course id. */
  summaries: Record<string, SyllabusSummary>;
  /**
   * What has been offered, waiting or decided, in brief, so the same thing
   * found again in another course's syllabus is not offered a second time.
   */
  offered: OfferedItem[];
};

/** Enough of a suggestion to tell whether a later find is the same thing. */
export type OfferedItem = Pick<Suggestion, "kind" | "title" | "date" | "course">;

const MAX_OFFERED = 1000;

export const EMPTY_PLAN_STATE: PlanState = {
  enabled: false,
  enabledAt: null,
  read: {},
  failed: {},
  pending: [],
  decided: {},
  summaries: {},
  offered: [],
};

const PROVIDER_IDS: readonly string[] = ["glm", "gemini", "groq"];

function parseOffered(value: unknown): OfferedItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_OFFERED).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.title !== "string" || !entry.title) return [];
    if (!(PLAN_ITEM_KINDS as readonly unknown[]).includes(entry.kind)) return [];
    if (entry.date !== null && (typeof entry.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date))) return [];
    if (entry.course !== null && typeof entry.course !== "string") return [];
    return [{ kind: entry.kind as PlanItem["kind"], title: entry.title, date: entry.date as string | null, course: entry.course as string | null }];
  });
}

function parseSummaries(value: unknown): Record<string, SyllabusSummary> {
  if (!isRecord(value)) return {};
  const summaries: Record<string, SyllabusSummary> = {};
  for (const [courseId, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const locale = entry.locale === "zh-CN" ? "zh-CN" : entry.locale === "en" ? "en" : null;
    // Checked as the model's answer is, so storage cannot hold what the page would not show.
    const text = locale ? cleanSummary(entry.text, null) : null;
    if (!text || !locale || typeof entry.files !== "string" || typeof entry.at !== "string") continue;
    summaries[courseId] = {
      text,
      files: entry.files,
      locale,
      provider: PROVIDER_IDS.includes(entry.provider as string) ? (entry.provider as ProviderId) : null,
      at: entry.at,
    };
  }
  return summaries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function parseSuggestion(value: unknown): Suggestion | null {
  if (!isRecord(value)) return null;
  const { id, title, date, time, kind, evidence, source, course, from, fromLabel, foundAt } = value;
  if (typeof id !== "string" || typeof title !== "string" || !title) return null;
  if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))) return null;
  if (time !== null && (typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time))) return null;
  if (!(PLAN_ITEM_KINDS as readonly unknown[]).includes(kind)) return null;
  if (from !== "syllabus" && from !== "announcement") return null;
  if (course !== null && typeof course !== "string") return null;
  return {
    id,
    title,
    date: date as string | null,
    time: time as string | null,
    kind: kind as PlanItem["kind"],
    evidence: typeof evidence === "string" ? evidence : "",
    source: typeof source === "number" ? source : null,
    course: course as string | null,
    from,
    fromLabel: typeof fromLabel === "string" ? fromLabel : "",
    foundAt: typeof foundAt === "string" ? foundAt : new Date(0).toISOString(),
    ...(typeof value.announcementId === "string" ? { announcementId: value.announcementId } : {}),
  };
}

export function parsePlanState(raw: string | null): PlanState {
  if (!raw) return EMPTY_PLAN_STATE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return EMPTY_PLAN_STATE;
    const failed: PlanState["failed"] = {};
    if (isRecord(parsed.failed)) {
      for (const [key, entry] of Object.entries(parsed.failed)) {
        if (isRecord(entry) && typeof entry.signature === "string" && typeof entry.count === "number") {
          failed[key] = { signature: entry.signature, count: entry.count };
        }
      }
    }
    const decided: PlanState["decided"] = {};
    for (const [id, verdict] of Object.entries(stringMap(parsed.decided))) {
      if (verdict === "added" || verdict === "dismissed") decided[id] = verdict;
    }
    const restored: PlanState = {
      enabled: parsed.enabled === true,
      enabledAt: typeof parsed.enabledAt === "string" ? parsed.enabledAt : null,
      read: stringMap(parsed.read),
      failed,
      pending: (Array.isArray(parsed.pending) ? parsed.pending : []).flatMap((entry) => {
        const suggestion = parseSuggestion(entry);
        return suggestion ? [suggestion] : [];
      }),
      decided,
      summaries: parseSummaries(parsed.summaries),
      offered: parseOffered(parsed.offered),
    };
    // Lists made before duplicates were merged are merged on the way in.
    const pending = tidyPending(restored.pending);
    const same = (a: OfferedItem, b: OfferedItem) => a.kind === b.kind && a.title === b.title && a.date === b.date && a.course === b.course;
    const missing = pending.map(brief).filter((item) => !restored.offered.some((other) => same(item, other)));
    return { ...restored, pending, offered: [...restored.offered, ...missing].slice(-MAX_OFFERED) };
  } catch {
    return EMPTY_PLAN_STATE;
  }
}

export function restorePlanState(storage: Pick<Storage, "getItem">): PlanState {
  try {
    return parsePlanState(storage.getItem(PLAN_STORAGE_KEY));
  } catch {
    return EMPTY_PLAN_STATE;
  }
}

export function savePlanState(storage: Pick<Storage, "setItem">, state: PlanState): void {
  // The oldest verdicts go first when there are too many; they are for sources long since read.
  const decided = Object.entries(state.decided);
  const trimmed: PlanState = {
    ...state,
    offered: state.offered.slice(-MAX_OFFERED),
    pending: state.pending.slice(0, MAX_PENDING),
    decided: Object.fromEntries(decided.slice(Math.max(0, decided.length - MAX_DECIDED))),
  };
  try {
    storage.setItem(PLAN_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* kept for this visit */
  }
}

/** Letters and digits only, lower case: "Mid-term 1 " and "midterm 1" are the same thing. */
function normalTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** FNV-1a, as hex: short, stable, and only ever compared with itself. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

/**
 * The same exam found in the syllabus and again in an announcement gets the
 * same id, so it is offered once. A moved exam has a new date, and a new id.
 */
export function suggestionId(course: string | null, title: string, date: string | null): string {
  return "ai-" + hash(`${(course ?? "").toLowerCase()}|${normalTitle(title)}|${date ?? ""}`);
}

/** Words that say a day is off without saying which one: "No class", "Break", "Recess". */
const DAY_OFF_WORDS = new Set([
  "no", "class", "classes", "lecture", "lectures", "lab", "labs", "break", "recess", "holiday", "holidays",
  "day", "days", "off", "university", "campus", "closed", "closure", "cancelled", "canceled", "week",
  "observed", "the", "of", "and", "for", "on", "in",
]);

function dayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / 86_400_000;
}

function brief(suggestion: Suggestion): OfferedItem {
  return { kind: suggestion.kind, title: suggestion.title, date: suggestion.date, course: suggestion.course };
}

/**
 * Whether two days off are the same break. Every syllabus lists Thanksgiving,
 * each in its own words and some from its first day, some from the holiday
 * itself: within a week of each other and sharing a word that names the break
 * ("thanksgiving", "spring") is the same break. Two that name none, plain "No
 * class", are the same only on the same day.
 */
export function sameDayOff(left: OfferedItem, right: OfferedItem): boolean {
  if (left.kind !== "no-class" || right.kind !== "no-class" || !left.date || !right.date) return false;
  const apart = Math.abs(dayNumber(left.date) - dayNumber(right.date));
  if (apart > 7) return false;
  const named = (title: string) => new Set([...words(title)].filter((word) => !DAY_OFF_WORDS.has(word)));
  const a = named(left.title);
  const b = named(right.title);
  if (a.size === 0 || b.size === 0) return apart === 0;
  return [...a].some((word) => b.has(word));
}

/** Whether a find without a date is one the same course already has with a date. */
function datedElsewhere(undated: OfferedItem, dated: OfferedItem): boolean {
  return (
    undated.date === null &&
    dated.date !== null &&
    (undated.course ?? "") === (dated.course ?? "") &&
    similarTitles(undated.title, dated.title)
  );
}

/** A day off with no day says nothing a calendar can use. */
function dayOffWithoutDay(item: Pick<PlanItem, "kind" | "date">): boolean {
  return item.kind === "no-class" && item.date === null;
}

/**
 * A list with its duplicates merged: one entry per break across courses, which
 * then belongs to none of them, and no undated entry for what has a dated one.
 */
export function tidyPending(pending: Suggestion[]): Suggestion[] {
  const kept: Suggestion[] = [];
  for (const suggestion of pending) {
    if (dayOffWithoutDay(suggestion) || isNotAToDo(suggestion)) continue;
    if (pending.some((other) => datedElsewhere(suggestion, other))) continue;
    const twin = kept.findIndex((other) => sameDayOff(suggestion, other));
    if (twin >= 0) {
      if (kept[twin].course !== suggestion.course) kept[twin] = { ...kept[twin], course: null };
      continue;
    }
    kept.push(suggestion);
  }
  return kept;
}

/**
 * Adds what a read found, leaving out what is already waiting or was already
 * decided — by id, and as the same thing in other words: a break another
 * course already listed, or an undated item the course has a date for. A
 * dated find takes the place of an undated one still waiting.
 */
export function addFound(
  state: PlanState,
  items: PlanItem[],
  meta: {
    course: string | null;
    from: SuggestionSource;
    fromLabel: (item: PlanItem) => string;
    foundAt: string;
    /** Which announcement an item came from, when it came from one. */
    announcementId?: (item: PlanItem) => string | null;
  },
): PlanState {
  const known = new Set([...state.pending.map((suggestion) => suggestion.id), ...Object.keys(state.decided)]);
  let pending = state.pending;
  const offered = [...state.offered];
  let changed = false;
  for (const item of items) {
    if (dayOffWithoutDay(item)) continue;
    const id = suggestionId(meta.course, item.title, item.date);
    if (known.has(id)) continue;
    const candidate: OfferedItem = { kind: item.kind, title: item.title, date: item.date, course: meta.course };
    if (offered.some((other) => sameDayOff(candidate, other))) {
      // Another course's break too: the one waiting belongs to no single course.
      pending = pending.map((other) =>
        sameDayOff(candidate, other) && other.course !== meta.course ? { ...other, course: null } : other,
      );
      changed = true;
      continue;
    }
    if (offered.some((other) => datedElsewhere(candidate, other))) continue;
    known.add(id);
    if (item.date) pending = pending.filter((other) => !datedElsewhere(other, candidate));
    const announcementId = meta.announcementId?.(item) ?? null;
    pending = [
      ...pending,
      { ...item, id, course: meta.course, from: meta.from, fromLabel: meta.fromLabel(item), foundAt: meta.foundAt, ...(announcementId ? { announcementId } : {}) },
    ];
    offered.push(candidate);
    changed = true;
  }
  return changed ? { ...state, pending, offered } : state;
}

/**
 * What was waiting from announcements that have just been read again, taken away, so the new reading
 * replaces it and a date the teacher moved is not offered twice. What was already added or turned
 * down stays decided.
 */
export function supersede(state: PlanState, announcementIds: string[]): PlanState {
  if (announcementIds.length === 0) return state;
  const gone = new Set(announcementIds);
  const pending = state.pending.filter((suggestion) => !(suggestion.announcementId && gone.has(suggestion.announcementId)));
  return pending.length === state.pending.length ? state : { ...state, pending };
}

export function markRead(state: PlanState, key: string, signature: string): PlanState {
  const failed = { ...state.failed };
  delete failed[key];
  return { ...state, read: { ...state.read, [key]: signature }, failed };
}

export function markFailed(state: PlanState, key: string, signature: string): PlanState {
  const before = state.failed[key];
  const count = before && before.signature === signature ? before.count + 1 : 1;
  return { ...state, failed: { ...state.failed, [key]: { signature, count } } };
}

/** Whether a source still needs reading: never read as it is now, and not given up on. */
export function needsReading(state: PlanState, key: string, signature: string): boolean {
  if (state.read[key] === signature) return false;
  const failed = state.failed[key];
  return !(failed && failed.signature === signature && failed.count >= MAX_FAILURES);
}

export function decide(state: PlanState, verdicts: Record<string, "added" | "dismissed">): PlanState {
  return {
    ...state,
    pending: state.pending.filter((suggestion) => !(suggestion.id in verdicts)),
    decided: { ...state.decided, ...verdicts },
  };
}

export function syllabusKey(courseId: string): string {
  return `syllabus:${courseId}`;
}

/**
 * A syllabus is read again only when a different file, or a newer copy of it,
 * arrives — or when the page's language changes, since its summary is written
 * in that language. The leading "2" is what was read: dates and a summary. One
 * read before summaries existed carries no "2", so it is read once more, for
 * its summary; the dates it already offered are not offered again.
 */
export function syllabusSignature(files: Array<{ key: string; savedAt: string }>, locale: SummaryLocale): string {
  return `2|${locale}|${files.map((file) => `${file.key}@${file.savedAt}`).join("|")}`;
}

export function setSummary(state: PlanState, courseId: string, summary: SyllabusSummary | null): PlanState {
  if (!summary) return state;
  return { ...state, summaries: { ...state.summaries, [courseId]: summary } };
}

/**
 * What an announcement looked like when it was read: the title, body and posting time the model is
 * given. Its id is made from the course, title and posting time and does not change when the teacher
 * edits the text, so the id alone cannot say whether it has to be read again. The leading "2" is
 * this scheme; a read from before it carries "1" and is read once more, as a syllabus's was.
 */
export function announcementSignature(announcement: Pick<Announcement, "title" | "body" | "posted">): string {
  return "2|" + contentHash([announcement.title.slice(0, 200), announcement.body, announcement.posted?.slice(0, 120) ?? ""].join("\u0000"));
}

export function announcementKey(id: string): string {
  return `announcement:${id}`;
}

export type AnnouncementBatch = { course: string | null; ids: string[]; signatures: string[]; announcements: PlanAnnouncement[] };

/**
 * The announcements still to read, by course, newest first, in batches small
 * enough for one request. Those from before the lookback are not read: they
 * are what was already there when this was turned on.
 */
export function announcementBatches(announcements: Announcement[], state: PlanState): AnnouncementBatch[] {
  const since = state.enabledAt ? Date.parse(state.enabledAt) - ANNOUNCEMENT_LOOKBACK_DAYS * 86_400_000 : -Infinity;
  const byCourse = new Map<string | null, Announcement[]>();
  for (const announcement of announcements) {
    if (!needsReading(state, announcementKey(announcement.id), announcementSignature(announcement))) continue;
    if (Date.parse(announcement.announced) < since) continue;
    const list = byCourse.get(announcement.courseCode) ?? [];
    list.push(announcement);
    byCourse.set(announcement.courseCode, list);
  }

  const batches: AnnouncementBatch[] = [];
  for (const [course, list] of byCourse) {
    list.sort((left, right) => (left.announced < right.announced ? 1 : left.announced > right.announced ? -1 : 0));
    let batch: AnnouncementBatch = { course, ids: [], signatures: [], announcements: [] };
    let characters = 0;
    for (const announcement of list) {
      const item = { title: announcement.title.slice(0, 200), body: announcement.body, posted: announcement.posted?.slice(0, 120) ?? null };
      const size = item.title.length + item.body.length;
      if (batch.ids.length > 0 && (batch.ids.length >= MAX_BATCH_ANNOUNCEMENTS || characters + size > MAX_BATCH_CHARACTERS)) {
        batches.push(batch);
        batch = { course, ids: [], signatures: [], announcements: [] };
        characters = 0;
      }
      batch.ids.push(announcement.id);
      batch.signatures.push(announcementSignature(announcement));
      batch.announcements.push(item);
      characters += size;
    }
    if (batch.ids.length > 0) batches.push(batch);
  }
  return batches;
}

/** One file's text under its name, so the model knows where one ends; cut to fit. */
export function joinSyllabusTexts(texts: Array<{ name: string; text: string }>): string {
  return texts
    .map(({ name, text }) => `=== ${name} ===\n${text}`)
    .join("\n\n")
    .slice(0, MAX_PLAN_TEXT);
}

const WEEKDAYS: Array<[RegExp, number]> = [
  [/\bsun(day)?\b/i, 0],
  [/\bmon(day)?\b/i, 1],
  [/\btue(s|sday)?\b/i, 2],
  [/\bwed(nesday)?\b/i, 3],
  [/\bthu(r|rs|rsday)?\b/i, 4],
  [/\bfri(day)?\b/i, 5],
  [/\bsat(urday)?\b/i, 6],
];

/**
 * Whether the source names a weekday that the date does not fall on. A
 * syllabus copied from last year keeps "Tuesday, October 14" when the 14th is
 * now a Wednesday, and this is how that shows. Only checked when exactly one
 * weekday is named, since a line like "Mon/Wed" says nothing about the date.
 */
export function weekdayMismatch(item: Pick<PlanItem, "date" | "evidence">): boolean {
  if (!item.date) return false;
  const named = WEEKDAYS.filter(([pattern]) => pattern.test(item.evidence));
  if (named.length !== 1) return false;
  const [year, month, day] = item.date.split("-").map(Number);
  return new Date(year, month - 1, day).getDay() !== named[0][1];
}

function words(title: string): Set<string> {
  return new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1));
}

/** Whether two titles name the same thing: one inside the other, or most of their words shared. */
export function similarTitles(left: string, right: string): boolean {
  const a = normalTitle(left);
  const b = normalTitle(right);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const wordsA = words(left);
  const wordsB = words(right);
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
  return shared / Math.max(1, Math.min(wordsA.size, wordsB.size)) >= 0.6;
}

export type SuggestionFlags = {
  /** Something on that day with a title like it is already in the calendar. */
  inCalendar: boolean;
  weekday: boolean;
  past: boolean;
};

export function suggestionFlags(suggestion: Suggestion, tasks: CalendarTask[], today: string): SuggestionFlags {
  const date = suggestion.date;
  const inCalendar =
    !!date &&
    tasks.some((task) => isDeadline(task) && localDay(taskDate(task)) === date && similarTitles(task.title, suggestion.title));
  return { inCalendar, weekday: weekdayMismatch(suggestion), past: !!date && date < today };
}

/** Ticked to be added unless it is already there or already over. */
export function selectedByDefault(flags: SuggestionFlags): boolean {
  return !flags.inCalendar && !flags.past;
}

/** `YYYY-MM-DD` and `HH:MM` as that moment here. */
export function localInstant(day: string, time: string | null): string {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = (time ?? "00:00").split(":").map(Number);
  return new Date(year, month - 1, date, hour, minute).toISOString();
}

function noteFor(suggestion: Suggestion): string {
  const where = suggestion.fromLabel ? `${suggestion.fromLabel}` : suggestion.from;
  return suggestion.evidence ? `AI · ${where}: "${suggestion.evidence}"` : `AI · ${where}`;
}

/** A dated suggestion as a calendar event; the day may have been changed on the list. */
export function suggestionToEvent(suggestion: Suggestion, day: string): CustomEventInput {
  const time = day === suggestion.date ? suggestion.time : null;
  return {
    title: suggestion.title,
    course: suggestion.course,
    start: localInstant(day, time),
    end: null,
    allDay: time === null,
    location: null,
    note: noteFor(suggestion),
  };
}

export function suggestionToUndated(suggestion: Suggestion, addedAt: string): UndatedTodo {
  return {
    id: suggestion.id,
    title: suggestion.title,
    course: suggestion.course,
    note: noteFor(suggestion),
    done: false,
    addedAt,
  };
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const KNOWN_PROBLEMS: Record<string, SummaryProblem> = {
  busy: "busy",
  "rate-limited": "rate-limited",
  refused: "refused",
  "not-configured": "unavailable",
  region: "region",
  "choice-unavailable": "choice-unavailable",
};

const PROVIDERS: readonly ProviderId[] = ["glm", "gemini", "groq"];

/**
 * Asks the app's endpoint to read one source. Failures are `SummaryError`s with
 * the same problems as a summary's, since it is the same models behind it.
 */
export async function requestPlan(
  request: PlanRequest,
  fetchImpl: FetchLike = fetch,
  choice: SummaryChoice = "auto",
): Promise<{ items: PlanItem[]; summary: string | null; provider: ProviderId | null }> {
  const sources = request.announcements.length;
  let response: Response;
  let body: { items?: unknown; summary?: unknown; problem?: unknown; provider?: unknown };
  try {
    response = await fetchImpl(PLAN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(choice === "auto" ? request : { ...request, provider: choice }),
    });
    body = await response.json();
  } catch {
    throw new SummaryError("unavailable");
  }
  // Checked again here: what the page keeps should not depend on the server having checked it.
  const locale = request.kind === "syllabus" ? (request.locale ?? "en") : null;
  const result =
    response.ok && Array.isArray(body.items)
      ? parsePlanResult(JSON.stringify({ items: body.items, summary: body.summary }), sources, locale)
      : null;
  if (result) {
    return {
      items: result.items,
      summary: request.kind === "syllabus" ? result.summary : null,
      provider: PROVIDERS.find((id) => id === body.provider) ?? null,
    };
  }
  const problem = typeof body.problem === "string" ? KNOWN_PROBLEMS[body.problem] : undefined;
  throw new SummaryError(problem ?? "failed");
}
