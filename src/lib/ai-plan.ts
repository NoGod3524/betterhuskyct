import { SummaryError, type SummaryProblem } from "./announcement-summary.ts";
import type { Announcement } from "./announcements.ts";
import { isDeadline, type CalendarTask } from "./calendar-types.ts";
import type { CustomEventInput } from "./custom-events.ts";
import { taskDate } from "./date-utils.ts";
import { cleanSummary, MAX_PLAN_TEXT, parsePlanResult, PLAN_ITEM_KINDS, type PlanAnnouncement, type PlanItem, type PlanRequest } from "./plan-models.ts";
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
};

export const EMPTY_PLAN_STATE: PlanState = {
  enabled: false,
  enabledAt: null,
  read: {},
  failed: {},
  pending: [],
  decided: {},
  summaries: {},
};

const PROVIDER_IDS: readonly string[] = ["glm", "gemini", "groq"];

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
    return {
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
    };
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

/** Adds what a read found, leaving out what is already waiting or was already decided. */
export function addFound(
  state: PlanState,
  items: PlanItem[],
  meta: { course: string | null; from: SuggestionSource; fromLabel: (item: PlanItem) => string; foundAt: string },
): PlanState {
  const known = new Set([...state.pending.map((suggestion) => suggestion.id), ...Object.keys(state.decided)]);
  const added: Suggestion[] = [];
  for (const item of items) {
    const id = suggestionId(meta.course, item.title, item.date);
    if (known.has(id)) continue;
    known.add(id);
    added.push({ ...item, id, course: meta.course, from: meta.from, fromLabel: meta.fromLabel(item), foundAt: meta.foundAt });
  }
  return added.length === 0 ? state : { ...state, pending: [...state.pending, ...added] };
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

/** An announcement's id comes from its course, title and posting time, so having read it is all there is to record. */
export const ANNOUNCEMENT_SIGNATURE = "1";

export function announcementKey(id: string): string {
  return `announcement:${id}`;
}

/** Today in the reader's own time zone. */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export type AnnouncementBatch = { course: string | null; ids: string[]; announcements: PlanAnnouncement[] };

/**
 * The announcements still to read, by course, newest first, in batches small
 * enough for one request. Those from before the lookback are not read: they
 * are what was already there when this was turned on.
 */
export function announcementBatches(announcements: Announcement[], state: PlanState): AnnouncementBatch[] {
  const since = state.enabledAt ? Date.parse(state.enabledAt) - ANNOUNCEMENT_LOOKBACK_DAYS * 86_400_000 : -Infinity;
  const byCourse = new Map<string | null, Announcement[]>();
  for (const announcement of announcements) {
    if (!needsReading(state, announcementKey(announcement.id), ANNOUNCEMENT_SIGNATURE)) continue;
    if (Date.parse(announcement.announced) < since) continue;
    const list = byCourse.get(announcement.courseCode) ?? [];
    list.push(announcement);
    byCourse.set(announcement.courseCode, list);
  }

  const batches: AnnouncementBatch[] = [];
  for (const [course, list] of byCourse) {
    list.sort((left, right) => (left.announced < right.announced ? 1 : left.announced > right.announced ? -1 : 0));
    let batch: AnnouncementBatch = { course, ids: [], announcements: [] };
    let characters = 0;
    for (const announcement of list) {
      const item = { title: announcement.title.slice(0, 200), body: announcement.body, posted: announcement.posted?.slice(0, 120) ?? null };
      const size = item.title.length + item.body.length;
      if (batch.ids.length > 0 && (batch.ids.length >= MAX_BATCH_ANNOUNCEMENTS || characters + size > MAX_BATCH_CHARACTERS)) {
        batches.push(batch);
        batch = { course, ids: [], announcements: [] };
        characters = 0;
      }
      batch.ids.push(announcement.id);
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
