import { readFileSync } from "node:fs";

import { extractCandidates, type ActionKind } from "../../src/lib/announcement-actions.ts";
import { dayKey } from "../../src/lib/announcement-dates.ts";
import { sentencesOf } from "../../src/lib/announcement-sentences.ts";
import { postedTime, type Announcement } from "../../src/lib/announcements.ts";

/**
 * What the evaluation counts. The unit is one sentence (the announcement's title is unit 0), cut by
 * the same function the app cuts with. An event is something a student would put on a to-do list or
 * a calendar: the four kinds below, with the day when the text gives one.
 */
export const KINDS = ["deadline", "exam", "quiz", "no-class"] as const;
export type Kind = (typeof KINDS)[number];

export type Unit = { i: number; from: "title" | "text"; text: string };
export type Event = { kind: Kind; date: string | null };
/** unit index -> events; units with none are left out. */
export type Labels = Record<string, Event[]>;

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

export function loadAnnouncements(path: string): Announcement[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { announcements: Announcement[] };
  return parsed.announcements;
}

export function unitsOf(announcement: Pick<Announcement, "title" | "body">): Unit[] {
  const texts: Array<{ from: Unit["from"]; text: string }> = [{ from: "title", text: oneLine(announcement.title) }, ...sentencesOf(announcement.body).map((text) => ({ from: "text" as const, text }))];
  return texts.map((unit, i) => ({ i, ...unit }));
}

/** The day the announcement was posted (or first seen), the anchor for "Friday" and "tomorrow". */
export function referenceDay(announcement: Pick<Announcement, "posted" | "announced">): string {
  const at = new Date(postedTime(announcement.posted) ?? Date.parse(announcement.announced));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The same text posted to several sections is one announcement here. */
export const contentKey = (announcement: Pick<Announcement, "title" | "body">) => `${oneLine(announcement.title)}
${oneLine(announcement.body)}`;

/** One announcement per distinct text, in a fixed order. */
export function distinct(announcements: Announcement[]): Announcement[] {
  const seen = new Map<string, Announcement>();
  for (const announcement of [...announcements].sort((a, b) => (a.id < b.id ? -1 : 1))) if (!seen.has(contentKey(announcement))) seen.set(contentKey(announcement), announcement);
  return [...seen.values()];
}

/** A fixed, even split by course: half to tune the rules on, half kept back to report on. */
export function splitOf(announcements: Announcement[]): Map<string, "dev" | "test"> {
  const byCourse = new Map<string, Announcement[]>();
  for (const announcement of distinct(announcements)) {
    const key = announcement.courseCode ?? "";
    byCourse.set(key, [...(byCourse.get(key) ?? []), announcement]);
  }
  const split = new Map<string, "dev" | "test">();
  for (const group of byCourse.values()) {
    group.sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((announcement, index) => split.set(announcement.id, index % 2 === 0 ? "dev" : "test"));
  }
  return split;
}

const COARSE: Record<ActionKind, Kind | null> = { deadline: "deadline", change: "deadline", exam: "exam", quiz: "quiz", "no-class": "no-class", mention: null };

/** What the rules suggest for one announcement, as a set of events, with the days they offered when they left it open. */
export function predict(announcement: Announcement): { events: Event[]; options: Map<string, string[]> } {
  const events = new Map<string, Event>();
  const options = new Map<string, string[]>();
  for (const candidate of extractCandidates(announcement)) {
    const kind = COARSE[candidate.kind];
    if (!kind) continue;
    const event = { kind, date: candidate.date ? dayKey(candidate.date) : null };
    events.set(eventKey(event), event);
    if (event.date === null) options.set(eventKey(event), [...(options.get(eventKey(event)) ?? []), ...candidate.options.map((option) => dayKey(option.date))]);
  }
  return { events: [...events.values()], options };
}

/** The gold events of one announcement: the unit labels, with the same event said twice counted once. */
export function flatten(labels: Labels): Event[] {
  const events = new Map<string, Event>();
  for (const list of Object.values(labels)) for (const event of list) events.set(eventKey(event), event);
  return [...events.values()];
}

export type Counts = { tp: number; fp: number; fn: number };
export const zero = (): Counts => ({ tp: 0, fp: 0, fn: 0 });

export function rates({ tp, fp, fn }: Counts) {
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}

/** Multiset match of two lists of keys: how many agree, how many only one side has. */
export function match(predicted: string[], gold: string[]): Counts {
  const left = new Map<string, number>();
  for (const key of gold) left.set(key, (left.get(key) ?? 0) + 1);
  let tp = 0;
  for (const key of predicted) {
    const n = left.get(key) ?? 0;
    if (n > 0) {
      tp += 1;
      left.set(key, n - 1);
    }
  }
  return { tp, fp: predicted.length - tp, fn: gold.length - tp };
}

export function add(into: Counts, more: Counts) {
  into.tp += more.tp;
  into.fp += more.fp;
  into.fn += more.fn;
}

export type Level = "kind" | "date" | "assisted";

export const eventKey = (e: Event) => `${e.kind}|${e.date}`;

/**
 * One announcement's counts at three levels, each stricter than the one before:
 * kind     - which kinds of event the announcement holds, whatever the day;
 * date     - which events, each with its day as YYYY-MM-DD (or none), the rules settled on;
 * assisted - the same, where a day the rules left to the student counts as right when the right
 *            day was among the choices offered.
 */
export function score(predicted: Event[], options: Map<string, string[]>, gold: Event[]): Record<Level, Counts> {
  const goldKeys = new Set(gold.map(eventKey));
  const assisted = predicted.map((event) => {
    if (event.date !== null) return eventKey(event);
    const hit = gold.find((g) => g.kind === event.kind && g.date !== null && (options.get(eventKey(event)) ?? []).includes(g.date) && !predicted.some((p) => eventKey(p) === eventKey(g)));
    return hit && goldKeys.has(eventKey(hit)) ? eventKey(hit) : eventKey(event);
  });
  return {
    kind: match([...new Set(predicted.map((e) => e.kind))], [...new Set(gold.map((e) => e.kind))]),
    date: match(predicted.map(eventKey), gold.map(eventKey)),
    assisted: match(assisted, gold.map(eventKey)),
  };
}
