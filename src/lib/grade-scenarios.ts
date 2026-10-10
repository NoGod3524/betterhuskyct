import { isCounted, type GradeItem } from "./grades.ts";

/**
 * Grade scenarios: what a course grade comes to if the parts of it that are still to come go a
 * given way.
 *
 * HuskyCT's gradebook lists the work and the scores, not how the course is graded, so the
 * weights are the student's to give (from the syllabus). What is worked out from them is a
 * scenario, not a forecast: the expected averages are the student's own, set with a slider.
 */

export type Category = {
  id: string;
  name: string;
  /** Its share of the course grade, in percent. The shares need not add to 100; the sum is what counts. */
  weight: number;
};

export type Scheme = {
  categories: Category[];
  /** A gradebook row's id → the category it belongs to, where the student chose over the guess. */
  assigned: Record<string, string>;
  /** A category's id → the average the student expects for the whole of it, in percent. */
  expected: Record<string, number>;
  /** The categories with work still to come, which a target is worked towards through. */
  open: string[];
};

export const EMPTY_SCHEME: Scheme = { categories: [], assigned: {}, expected: {}, open: [] };

export const MAX_CATEGORIES = 20;
const MAX_NAME = 60;

// --- which row belongs to which part ---------------------------------------------------------

/** Words a gradebook row uses for the same thing a syllabus names another way. */
const ALIASES: ReadonlyArray<readonly string[]> = [
  ["homework", "hw", "assignment", "problem set", "pset", "problem"],
  ["exam", "midterm", "final", "test"],
  ["quiz"],
  ["participation", "attendance", "clicker", "iclicker", "engagement"],
  ["project", "paper", "essay", "report"],
  ["lab", "laboratory"],
  ["discussion", "forum", "post"],
];

const normal = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** "Quizzes" and "Quiz", "Exams" and "Exam", the same word. */
const stem = (word: string) => word.replace(/zzes$/, "z").replace(/(es|s)$/, "");

function keywordsOf(name: string): string[] {
  const words = normal(name).split(" ").filter(Boolean).map(stem);
  const found = new Set(words);
  for (const group of ALIASES) {
    if (group.some((alias) => words.includes(stem(alias)) || words.includes(alias))) for (const alias of group) found.add(stem(alias));
  }
  return [...found];
}

/** The category whose name, or whose usual synonyms, the title uses; null when none does or two do. */
export function guessCategory(title: string, categories: readonly Category[]): string | null {
  const padded = ` ${normal(title)} `;
  const hits = categories.filter((category) => keywordsOf(category.name).some((keyword) => keyword && new RegExp(`\\b${keyword}`).test(padded)));
  return hits.length === 1 ? hits[0].id : null;
}

// --- what each part comes to so far -----------------------------------------------------------

export type CategoryStanding = {
  category: Category;
  /** Points-weighted average of the scored rows in it, in percent, or null when none is scored. */
  average: number | null;
  scored: number;
};

export type Standing = {
  parts: CategoryStanding[];
  /** Scored rows that belong to no category, which no scenario counts. */
  unassigned: GradeItem[];
};

const round1 = (value: number) => Math.round(value * 10) / 10;

export function standingOf(items: readonly GradeItem[], scheme: Scheme): Standing {
  const sums = new Map<string, { earned: number; possible: number; scored: number }>();
  const unassigned: GradeItem[] = [];
  const ids = new Set(scheme.categories.map((category) => category.id));

  for (const item of items) {
    if (!isCounted(item)) continue;
    const chosen = scheme.assigned[item.id];
    const id = chosen && ids.has(chosen) ? chosen : guessCategory(item.title, scheme.categories);
    if (!id) {
      unassigned.push(item);
      continue;
    }
    const sum = sums.get(id) ?? { earned: 0, possible: 0, scored: 0 };
    sum.earned += item.earned;
    sum.possible += item.possible;
    sum.scored += 1;
    sums.set(id, sum);
  }

  return {
    parts: scheme.categories.map((category) => {
      const sum = sums.get(category.id);
      return {
        category,
        average: sum && sum.possible > 0 ? round1((sum.earned / sum.possible) * 100) : null,
        scored: sum?.scored ?? 0,
      };
    }),
    unassigned,
  };
}

// --- the scenario ----------------------------------------------------------------------------

/** What a part is taken to come to: the student's expectation, else what it stands at, else nothing. */
export function valueOf(part: CategoryStanding, scheme: Scheme): number | null {
  const set = scheme.expected[part.category.id];
  if (typeof set === "number" && Number.isFinite(set)) return Math.min(100, Math.max(0, set));
  return part.average;
}

export type ScenarioTotal = {
  /** The course grade in percent over the parts that have a value, or null when none has. */
  percent: number | null;
  /** The weight, in percent, of the parts that have no value yet and so are left out. */
  missingWeight: number;
  /** The sum of all the weights, which should be 100. */
  totalWeight: number;
};

export function scenarioTotal(standing: Standing, scheme: Scheme): ScenarioTotal {
  let weighted = 0;
  let counted = 0;
  let missingWeight = 0;
  let totalWeight = 0;
  for (const part of standing.parts) {
    totalWeight += part.category.weight;
    const value = valueOf(part, scheme);
    if (value === null) {
      missingWeight += part.category.weight;
      continue;
    }
    weighted += part.category.weight * value;
    counted += part.category.weight;
  }
  return { percent: counted > 0 ? round1(weighted / counted) : null, missingWeight: round1(missingWeight), totalWeight: round1(totalWeight) };
}

export type NeededResult =
  /** No target, no open part, or a closed part with nothing known about it. */
  | { kind: "none" }
  /** The target is met whatever the open parts come to. */
  | { kind: "safe" }
  /** The open parts must average this percent. */
  | { kind: "needs"; percent: number }
  /** Even full marks on every open part end below the target; the best that is possible. */
  | { kind: "out"; best: number };

/**
 * What the open parts must average for the whole course to reach `target`. The parts that are not
 * open count at what they stand at or are expected to come to; every weight counts, so a scheme
 * that does not add to 100 is worked over its own sum.
 */
export function neededOnOpen(standing: Standing, scheme: Scheme, target: number): NeededResult {
  if (!Number.isFinite(target) || target < 0 || target > 100) return { kind: "none" };
  const open = new Set(scheme.open);
  let total = 0;
  let closedWeighted = 0;
  let openWeight = 0;
  for (const part of standing.parts) {
    total += part.category.weight;
    if (open.has(part.category.id)) {
      openWeight += part.category.weight;
      continue;
    }
    const value = valueOf(part, scheme);
    if (value === null) return { kind: "none" };
    closedWeighted += part.category.weight * value;
  }
  if (openWeight <= 0 || total <= 0) return { kind: "none" };
  const needed = (target * total - closedWeighted) / openWeight;
  if (needed <= 0) return { kind: "safe" };
  if (needed > 100) return { kind: "out", best: round1((closedWeighted + 100 * openWeight) / total) };
  return { kind: "needs", percent: round1(needed) };
}

/** UConn's letter for a percent. The cut-offs are the usual ones; a course's syllabus may set its own. */
export function letterFor(percent: number): string {
  const cuts: Array<[number, string]> = [[93, "A"], [90, "A-"], [87, "B+"], [83, "B"], [80, "B-"], [77, "C+"], [73, "C"], [70, "C-"], [67, "D+"], [63, "D"], [60, "D-"]];
  return cuts.find(([cut]) => percent >= cut)?.[1] ?? "F";
}

// --- what is kept ----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isPercent = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

/** A stored scheme, or null when it is not one. Anything out of shape is dropped, not repaired. */
export function parseScheme(value: unknown): Scheme | null {
  if (!isRecord(value) || !Array.isArray(value.categories) || value.categories.length > MAX_CATEGORIES) return null;
  const categories: Category[] = [];
  for (const raw of value.categories) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string" || !isPercent(raw.weight)) return null;
    const name = raw.name.trim().slice(0, MAX_NAME);
    if (!raw.id) return null;
    categories.push({ id: raw.id, name, weight: raw.weight });
  }
  const ids = new Set(categories.map((category) => category.id));
  const assigned: Record<string, string> = {};
  if (isRecord(value.assigned)) {
    for (const [row, id] of Object.entries(value.assigned)) if (typeof id === "string" && ids.has(id)) assigned[row] = id;
  }
  const expected: Record<string, number> = {};
  if (isRecord(value.expected)) {
    for (const [id, percent] of Object.entries(value.expected)) if (ids.has(id) && isPercent(percent)) expected[id] = percent;
  }
  const open = Array.isArray(value.open) ? value.open.filter((id): id is string => typeof id === "string" && ids.has(id)) : [];
  return { categories, assigned, expected, open };
}
