import { EMPTY_SCHEME, parseScheme, type Scheme } from "./grade-scenarios.ts";

/**
 * Each course's scheme, kept in this browser. It is small and the student's own, so it is
 * localStorage and nothing else: it goes to no server.
 */
export const SCENARIOS_KEY = "huskypilot.gradeScenarios.v1";

/** Fired on the window when a scheme is written, so the components that show one read it again. */
export const SCENARIOS_CHANGED = "huskypilot:grade-scenarios-changed";

/** The stored schemes by course id; anything unreadable is left out. */
export function parseSchemes(raw: string | null): Record<string, Scheme> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const out: Record<string, Scheme> = {};
    for (const [courseId, stored] of Object.entries(value)) {
      const scheme = parseScheme(stored);
      if (scheme) out[courseId] = scheme;
    }
    return out;
  } catch {
    return {};
  }
}

export function schemeFor(schemes: Record<string, Scheme>, courseId: string): Scheme {
  return schemes[courseId] ?? EMPTY_SCHEME;
}

/** Writes one course's scheme among the others. Blocked or full storage leaves things as they were. */
export function saveScheme(storage: Pick<Storage, "getItem" | "setItem">, courseId: string, scheme: Scheme): void {
  try {
    const all = parseSchemes(storage.getItem(SCENARIOS_KEY));
    all[courseId] = scheme;
    storage.setItem(SCENARIOS_KEY, JSON.stringify(all));
  } catch {
    // Nothing is kept; the page still shows what was just set until it is left.
  }
}
