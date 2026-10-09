import type { Announcement } from "./announcements.ts";
import type { CalendarTask } from "./calendar-types.ts";
import type { GradesSnapshot } from "./grades.ts";
import type { MaterialsIndex } from "./materials.ts";

export type SearchKind = "task" | "announcement" | "material" | "grade";

export type SearchResult = {
  kind: SearchKind;
  id: string;
  title: string;
  /** Where it is from: its course, its folder. */
  detail: string | null;
  /** The page it lives on. */
  href: string;
};

export type SearchSources = {
  tasks: readonly CalendarTask[];
  announcements: readonly Announcement[];
  materials: MaterialsIndex | null;
  grades: GradesSnapshot | null;
};

/** The order the groups are shown in. */
export const SEARCH_KINDS: readonly SearchKind[] = ["task", "announcement", "material", "grade"];

const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);
const hasAll = (text: string, tokens: string[]) => {
  const lower = text.toLowerCase();
  return tokens.every((token) => lower.includes(token));
};

type Candidate = SearchResult & { /** More text to look in than the title shows. */ extra: string };

function candidates(sources: SearchSources): Candidate[] {
  const out: Candidate[] = [];
  for (const task of sources.tasks) {
    out.push({ kind: "task", id: task.id, title: task.title, detail: task.course, href: "/tasks", extra: task.location ?? "" });
  }
  for (const item of sources.announcements) {
    out.push({
      kind: "announcement",
      id: item.id,
      title: item.title,
      detail: item.courseCode,
      href: "/announcements",
      extra: item.body,
    });
  }
  for (const course of sources.materials?.courses ?? []) {
    const code = course.code;
    for (const file of course.files) {
      out.push({ kind: "material", id: file.key, title: file.title, detail: [code, ...file.path].filter(Boolean).join(" / ") || null, href: "/materials", extra: "" });
    }
    for (const link of course.links) {
      out.push({ kind: "material", id: link.url, title: link.title, detail: [code, ...link.path].filter(Boolean).join(" / ") || null, href: "/materials", extra: "" });
    }
    for (const tool of course.tools) {
      out.push({ kind: "material", id: `${course.id}:${tool.title}`, title: tool.title, detail: [code, ...tool.path].filter(Boolean).join(" / ") || null, href: "/materials", extra: "" });
    }
  }
  for (const course of sources.grades?.courses ?? []) {
    for (const item of course.items) {
      out.push({
        kind: "grade",
        id: `${course.id}:${item.id}`,
        title: item.title,
        detail: course.code,
        href: `/grades#grades-${course.id}`,
        extra: "",
      });
    }
  }
  return out;
}

/**
 * What matches a query, grouped in a fixed order. A result has to hold every word of the query,
 * in its title, its course or folder, or (for an announcement) its text; one with the words in its
 * title comes before one that has them only elsewhere. No more than `perKind` of each kind.
 */
export function searchAll(query: string, sources: SearchSources, perKind = 6): SearchResult[] {
  const tokens = words(query);
  if (tokens.length === 0) return [];

  const ranked: Array<{ result: SearchResult; rank: number; order: number }> = [];
  candidates(sources).forEach((candidate, order) => {
    const { extra, ...result } = candidate;
    if (hasAll(result.title, tokens)) ranked.push({ result, rank: 0, order });
    else if (hasAll(`${result.title} ${result.detail ?? ""} ${extra}`, tokens)) ranked.push({ result, rank: 1, order });
  });

  return SEARCH_KINDS.flatMap((kind) =>
    ranked
      .filter((entry) => entry.result.kind === kind)
      .sort((left, right) => left.rank - right.rank || left.order - right.order)
      .slice(0, perKind)
      .map((entry) => entry.result),
  );
}
