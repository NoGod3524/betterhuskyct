"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useCalendar } from "@/components/calendar-provider";
import { DELIVERY_EVENT, type DeliveryDetail } from "@/components/helper-deliveries";
import {
  addFound,
  announcementBatches,
  announcementKey,
  ANNOUNCEMENT_SIGNATURE,
  decide,
  EMPTY_PLAN_STATE,
  joinSyllabusTexts,
  localDay,
  markFailed,
  markRead,
  needsReading,
  requestPlan,
  restorePlanState,
  savePlanState,
  suggestionToEvent,
  suggestionToUndated,
  syllabusKey,
  syllabusSignature,
  type PlanState,
  type Suggestion,
} from "@/lib/ai-plan";
import { SummaryError, type SummaryProblem } from "@/lib/announcement-summary";
import type { MaterialsStore, StoredFile } from "@/lib/materials";
import { openMaterialsStore } from "@/lib/materials-store";
import type { PlanItem, PlanRequest } from "@/lib/plan-models";
import { restoreSummaryChoice } from "@/lib/summary-choice";
import { pickSyllabusFiles, readFileText } from "@/lib/syllabus";
import { restoreUndatedTodos, saveUndatedTodos, type UndatedTodo } from "@/lib/undated-todos";

export type PlanStatus =
  | { phase: "idle"; problem: SummaryProblem | null }
  | { phase: "reading"; what: "syllabus" | "announcements"; course: string };

/** A row of the list as the student left it: added on this day, added with no day, or not ticked. */
export type PlanChoice = { id: string; day: string | null };

export type AiPlanValue = {
  enabled: boolean;
  status: PlanStatus;
  pending: Suggestion[];
  undated: UndatedTodo[];
  enable: () => void;
  disable: () => void;
  /** Read again now, including sources given up on. */
  checkNow: () => void;
  /** Adds the ticked rows and lets the others go. */
  resolve: (added: PlanChoice[], dismissed: string[]) => void;
  toggleUndated: (id: string) => void;
  removeUndated: (id: string) => void;
};

const AiPlanContext = createContext<AiPlanValue | null>(null);

/** Null outside the provider, so a page tested on its own still renders without the AI parts. */
export function useAiPlan(): AiPlanValue | null {
  return useContext(AiPlanContext);
}

/** A free model serves one request at a time; a short pause between them keeps from tripping it. */
const GAP_MS = 1_500;
/** After "busy" or "too many", the next try. */
const RETRY_MS = 60_000;
/** Many announcements can land in one sync; one read after they settle. */
const SETTLE_MS = 1_000;

type Outcome = { items: PlanItem[] } | { failed: true } | { stop: SummaryProblem; retry: boolean };

/** One function for every render: a new one each time would make every render start a new run. */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Reads syllabi and announcements with a model, in the background, once each,
 * while it is turned on — and holds what was found until the student decides.
 *
 * Runs on opening the app, when the helper finishes bringing files, and when
 * announcements change. One read at a time; a busy model pauses the whole run
 * for a minute rather than spending the next request too.
 */
export function AiPlanProvider({
  children,
  openMaterials = openMaterialsStore,
  fetchImpl,
  wait = sleep,
}: {
  children: ReactNode;
  openMaterials?: () => Promise<MaterialsStore>;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  wait?: (ms: number) => Promise<void>;
}) {
  const { announcements, addCustomEvents } = useCalendar();
  const [state, setState] = useState<PlanState>(EMPTY_PLAN_STATE);
  const [undated, setUndated] = useState<UndatedTodo[]>([]);
  const [status, setStatus] = useState<PlanStatus>({ phase: "idle", problem: null });

  const stateRef = useRef(state);
  const announcementsRef = useRef(announcements);
  const running = useRef(false);
  const again = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const runRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    announcementsRef.current = announcements;
  }, [announcements]);

  const commit = useCallback((change: (current: PlanState) => PlanState) => {
    const next = change(stateRef.current);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
    savePlanState(window.localStorage, next);
  }, []);

  // Restored after the first paint, as the calendar is, so the server render and the first client render agree.
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      const restored = restorePlanState(window.localStorage);
      stateRef.current = restored;
      setState(restored);
      setUndated(restoreUndatedTodos(window.localStorage));
    }, 0);
    return () => {
      clearTimeout(timer);
      mounted.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  const ask = useCallback(
    async (request: PlanRequest): Promise<Outcome> => {
      try {
        const { items } = await requestPlan(request, fetchImpl, restoreSummaryChoice(window.localStorage));
        return { items };
      } catch (error) {
        const problem = error instanceof SummaryError ? error.problem : "failed";
        if (problem === "busy" || problem === "rate-limited") return { stop: problem, retry: true };
        if (problem === "unavailable" || problem === "region" || problem === "choice-unavailable") {
          return { stop: problem, retry: false };
        }
        return { failed: true };
      }
    },
    [fetchImpl],
  );

  /** One pass over everything there is to read. Returns the problem that stopped it, if one did. */
  const readAll = useCallback(async (): Promise<{ problem: SummaryProblem; retry: boolean } | null> => {
    const today = localDay(new Date());
    let first = true;
    const pause = async () => {
      if (!first) await wait(GAP_MS);
      first = false;
    };

    let store: MaterialsStore | null = null;
    try {
      store = await openMaterials();
    } catch {
      store = null;
    }
    const index = store ? await store.getIndex().catch(() => null) : null;
    if (store && index) {
      const files: StoredFile[] = await store.files().catch(() => []);
      const byKey = new Map(files.map((file) => [file.key, file]));
      for (const course of index.courses) {
        if (!stateRef.current.enabled || !mounted.current) return null;
        const picks = pickSyllabusFiles(course, byKey);
        if (picks.length === 0) continue;
        const key = syllabusKey(course.id);
        const signature = syllabusSignature(picks.map((pick) => ({ key: pick.key, savedAt: byKey.get(pick.key)!.savedAt })));
        if (!needsReading(stateRef.current, key, signature)) continue;

        const label = (course.code ?? course.id).slice(0, 80);
        setStatus({ phase: "reading", what: "syllabus", course: label });
        const texts: Array<{ name: string; text: string }> = [];
        for (const pick of picks) {
          const text = await readFileText(byKey.get(pick.key)!);
          if (text) texts.push({ name: pick.name, text });
        }
        // A scan has no text to send. It is marked read, so it is not opened again every visit.
        if (texts.length === 0) {
          commit((current) => markRead(current, key, signature));
          continue;
        }

        await pause();
        const outcome = await ask({
          kind: "syllabus",
          courseLabel: label,
          term: index.term ? index.term.slice(0, 60) : null,
          today,
          text: joinSyllabusTexts(texts),
          announcements: [],
        });
        if ("stop" in outcome) return { problem: outcome.stop, retry: outcome.retry };
        if ("failed" in outcome) {
          commit((current) => markFailed(current, key, signature));
          continue;
        }
        const fromLabel = texts.map((entry) => entry.name).join(", ");
        commit((current) =>
          markRead(
            addFound(current, outcome.items, {
              course: course.code,
              from: "syllabus",
              fromLabel: () => fromLabel,
              foundAt: new Date().toISOString(),
            }),
            key,
            signature,
          ),
        );
      }
    }

    for (const batch of announcementBatches(announcementsRef.current, stateRef.current)) {
      if (!stateRef.current.enabled || !mounted.current) return null;
      const label = (batch.course ?? "Course").slice(0, 80);
      setStatus({ phase: "reading", what: "announcements", course: label });
      await pause();
      const outcome = await ask({ kind: "announcements", courseLabel: label, term: null, today, text: "", announcements: batch.announcements });
      if ("stop" in outcome) return { problem: outcome.stop, retry: outcome.retry };
      if ("failed" in outcome) {
        commit((current) => batch.ids.reduce((next, id) => markFailed(next, announcementKey(id), ANNOUNCEMENT_SIGNATURE), current));
        continue;
      }
      commit((current) =>
        batch.ids.reduce(
          (next, id) => markRead(next, announcementKey(id), ANNOUNCEMENT_SIGNATURE),
          addFound(current, outcome.items, {
            course: batch.course,
            from: "announcement",
            fromLabel: (item) => (item.source ? batch.announcements[item.source - 1]?.title ?? "" : ""),
            foundAt: new Date().toISOString(),
          }),
        ),
      );
    }
    return null;
  }, [ask, commit, openMaterials, wait]);

  const run = useCallback(async () => {
    if (!stateRef.current.enabled) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    let stopped: { problem: SummaryProblem; retry: boolean } | null = null;
    try {
      do {
        again.current = false;
        stopped = await readAll();
      } while (again.current && !stopped);
    } catch {
      stopped = { problem: "failed", retry: false };
    } finally {
      running.current = false;
    }
    if (!mounted.current) return;
    setStatus({ phase: "idle", problem: stopped?.problem ?? null });
    if (stopped?.retry) retryTimer.current = setTimeout(() => void runRef.current(), RETRY_MS);
  }, [readAll]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  // The triggers below go through the ref, so a new `run` alone never starts a read.
  // On opening the app, and whenever it is turned on.
  useEffect(() => {
    if (state.enabled) void runRef.current();
  }, [state.enabled]);

  // When the helper has finished bringing files.
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<DeliveryDetail>).detail;
      if (detail.kind === "materials" && detail.state.phase === "done") void runRef.current();
    };
    window.addEventListener(DELIVERY_EVENT, listener);
    return () => window.removeEventListener(DELIVERY_EVENT, listener);
  }, []);

  // When announcements change, once they settle.
  const announcementIds = useMemo(() => announcements.map((announcement) => announcement.id).join("|"), [announcements]);
  useEffect(() => {
    if (!state.enabled || !announcementIds) return;
    const timer = setTimeout(() => void runRef.current(), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [announcementIds, state.enabled]);

  const commitUndated = useCallback((change: (current: UndatedTodo[]) => UndatedTodo[]) => {
    setUndated((current) => {
      const next = change(current);
      saveUndatedTodos(window.localStorage, next);
      return next;
    });
  }, []);

  const value: AiPlanValue = {
    enabled: state.enabled,
    status,
    pending: state.pending,
    undated,
    enable: () => commit((current) => ({ ...current, enabled: true, enabledAt: current.enabledAt ?? new Date().toISOString() })),
    disable: () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      commit((current) => ({ ...current, enabled: false }));
      setStatus({ phase: "idle", problem: null });
    },
    checkNow: () => {
      commit((current) => ({ ...current, failed: {} }));
      setStatus({ phase: "idle", problem: null });
      void run();
    },
    resolve: (added, dismissed) => {
      const byId = new Map(stateRef.current.pending.map((suggestion) => [suggestion.id, suggestion]));
      const now = new Date().toISOString();
      const events = [];
      const todos: UndatedTodo[] = [];
      const verdicts: Record<string, "added" | "dismissed"> = {};
      for (const { id, day } of added) {
        const suggestion = byId.get(id);
        if (!suggestion) continue;
        if (day) events.push(suggestionToEvent(suggestion, day));
        else todos.push(suggestionToUndated(suggestion, now));
        verdicts[id] = "added";
      }
      for (const id of dismissed) if (byId.has(id)) verdicts[id] = "dismissed";
      addCustomEvents(events);
      if (todos.length > 0) {
        commitUndated((current) => [...current.filter((todo) => !todos.some((added) => added.id === todo.id)), ...todos]);
      }
      commit((current) => decide(current, verdicts));
    },
    toggleUndated: (id) => commitUndated((current) => current.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo))),
    removeUndated: (id) => commitUndated((current) => current.filter((todo) => todo.id !== id)),
  };

  return <AiPlanContext.Provider value={value}>{children}</AiPlanContext.Provider>;
}
