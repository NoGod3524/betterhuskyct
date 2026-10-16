"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useCalendar } from "@/components/calendar-provider";
import { DELIVERY_EVENT, type DeliveryDetail } from "@/components/helper-deliveries";
import {
  addFound,
  announcementBatches,
  announcementKey,
  announcementSignature,
  decide,
  EMPTY_PLAN_STATE,
  joinSyllabusTexts,
  markFailed,
  markRead,
  parsePlanState,
  PLAN_DATA_KEY,
  PLAN_STORAGE_KEY,
  supersede,
  needsReading,
  requestPlan,
  restorePlanState,
  savePlanState,
  saveSwitchedOff,
  saveSwitchedOn,
  setSummary,
  suggestionToEvent,
  suggestionToUndated,
  syllabusKey,
  syllabusSignature,
  type PlanState,
  type Suggestion,
  type SyllabusSummary,
} from "@/lib/ai-plan";
import { localDay } from "@/lib/date-utils";
import { SummaryError, type SummaryProblem } from "@/lib/announcement-summary";
import type { MaterialsStore, StoredFile } from "@/lib/materials";
import { openMaterialsStore } from "@/lib/materials-store";
import type { PlanItem, PlanRequest } from "@/lib/plan-models";
import { restoreSummaryChoice } from "@/lib/summary-choice";
import type { ProviderId } from "@/lib/summary-models";
import { writeStorageBatch } from "@/lib/storage-batch";
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
  /** Each course's syllabus summary, by HuskyCT course id. */
  summaries: Record<string, SyllabusSummary>;
  undated: UndatedTodo[];
  saveProblem: boolean;
  enable: () => void;
  disable: () => void;
  /** Read again now, including sources given up on. */
  checkNow: () => void;
  /** Adds the ticked rows and lets the others go. */
  resolve: (added: PlanChoice[], dismissed: string[]) => boolean;
  toggleUndated: (id: string) => void;
  removeUndated: (id: string) => void;
  /** Adds a to-do with no day, from the announcements page; returns its id. It needs no AI. */
  addUndated: (todo: { title: string; course: string | null; note: string | null }) => string;
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

type Outcome = { items: PlanItem[]; summary: string | null; provider: ProviderId | null } | { failed: true } | { stop: SummaryProblem; retry: boolean };

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
  const { announcements, addCustomEvents, locale } = useCalendar();
  const [state, setState] = useState<PlanState>(EMPTY_PLAN_STATE);
  const [undated, setUndated] = useState<UndatedTodo[]>([]);
  const [status, setStatus] = useState<PlanStatus>({ phase: "idle", problem: null });
  const [saveProblem, setSaveProblem] = useState(false);

  const stateRef = useRef(state);
  const undatedRef = useRef(undated);
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const announcementsRef = useRef(announcements);
  const running = useRef(false);
  const again = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const locallyOff = useRef(false);
  const runRef = useRef<() => Promise<void>>(async () => undefined);

  const localeRef = useRef(locale);
  const invalidateReading = useCallback(() => {
    generation.current++;
    activeRequest.current?.abort();
  }, []);

  const stopReading = useCallback(() => {
    invalidateReading();
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    again.current = false;
    setStatus({ phase: "idle", problem: null });
  }, [invalidateReading]);

  const readCurrent = useCallback(() => {
    const saved = restorePlanState(window.localStorage);
    const next = locallyOff.current ? { ...saved, enabled: false } : saved;
    if (!next.enabled && stateRef.current.enabled) stopReading();
    stateRef.current = next;
    setState(next);
    return next;
  }, [stopReading]);

  useEffect(() => {
    announcementsRef.current = announcements;
  }, [announcements]);

  useEffect(() => {
    if (localeRef.current !== locale) {
      invalidateReading();
    }
    localeRef.current = locale;
  }, [locale, invalidateReading]);

  const commit = useCallback((change: (current: PlanState) => PlanState, whileEnabled = false) => {
    const current = readCurrent();
    if (whileEnabled && !current.enabled) return false;
    const next = change(current);
    if (next === stateRef.current) return true;
    try {
      savePlanState(window.localStorage, next);
    } catch {
      setSaveProblem(true);
      return false;
    }
    stateRef.current = next;
    setState(next);
    return true;
  }, [readCurrent]);

  // Restored after the first paint, as the calendar is, so the server render and the first client render agree.
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      try {
        readCurrent();
        undatedRef.current = restoreUndatedTodos(window.localStorage);
        setUndated(undatedRef.current);
      } catch { locallyOff.current = true; setSaveProblem(true); }
    }, 0);
    return () => {
      clearTimeout(timer);
      mounted.current = false;
      invalidateReading();
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [invalidateReading, readCurrent]);

  useEffect(() => {
    const listener = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (event.key !== null && event.key !== PLAN_STORAGE_KEY && event.key !== PLAN_DATA_KEY) return;
      // A revoke followed quickly by a new enable still invalidates the old request.
      const switchedOn = event.key === PLAN_STORAGE_KEY && parsePlanState(event.newValue).enabled;
      if (event.key === null || (event.key === PLAN_STORAGE_KEY && !switchedOn)) stopReading();
      const current = readCurrent();
      if (switchedOn && current.enabled) void runRef.current();
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, [readCurrent, stopReading]);

  const ask = useCallback(
    async (request: PlanRequest, signal: AbortSignal): Promise<Outcome> => {
      try {
        return await requestPlan(request, fetchImpl, restoreSummaryChoice(window.localStorage), signal);
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
    const started = generation.current;
    const active = () => mounted.current && started === generation.current && readCurrent().enabled && started === generation.current;
    const controller = new AbortController();
    activeRequest.current = controller;
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
        if (!active()) return null;
        const picks = pickSyllabusFiles(course, byKey);
        if (picks.length === 0) continue;
        const key = syllabusKey(course.id);
        const language = localeRef.current;
        const signature = syllabusSignature(
          picks.map((pick) => ({ key: pick.key, savedAt: byKey.get(pick.key)!.savedAt })),
          language,
        );
        if (!needsReading(stateRef.current, key, signature)) continue;
        const stillCurrent = async () => {
          const currentIndex = await store!.getIndex();
          const currentCourse = currentIndex?.courses.find((entry) => entry.id === course.id);
          if (!currentCourse || !active()) return false;
          const currentFiles = new Map((await store!.files()).map((file) => [file.key, file]));
          const currentPicks = pickSyllabusFiles(currentCourse, currentFiles);
          return active() && currentPicks.length > 0 && signature === syllabusSignature(
            currentPicks.map((pick) => ({ key: pick.key, savedAt: currentFiles.get(pick.key)!.savedAt })), localeRef.current,
          );
        };

        const label = (course.code ?? course.id).slice(0, 80);
        setStatus({ phase: "reading", what: "syllabus", course: label });
        const texts: Array<{ name: string; text: string }> = [];
        for (const pick of picks) {
          const text = await readFileText(byKey.get(pick.key)!);
          if (text) texts.push({ name: pick.name, text });
        }
        if (!(await stillCurrent())) continue;
        // A scan has no text to send. It is marked read, so it is not opened again every visit.
        if (texts.length === 0) {
          commit((current) => markRead(current, key, signature), true);
          continue;
        }

        await pause();
        // The switch may have been turned off while the file was read: nothing leaves after that.
        if (!active()) return null;
        const outcome = await ask({
          kind: "syllabus",
          courseLabel: label,
          term: index.term ? index.term.slice(0, 60) : null,
          today,
          text: joinSyllabusTexts(texts),
          announcements: [],
          locale: language,
        }, controller.signal);
        if (!active()) return null;
        if (!(await stillCurrent())) continue;
        if ("stop" in outcome) return { problem: outcome.stop, retry: outcome.retry };
        if ("failed" in outcome) {
          commit((current) => markFailed(current, key, signature), true);
          continue;
        }
        const fromLabel = texts.map((entry) => entry.name).join(", ");
        const at = new Date().toISOString();
        commit((current) =>
          markRead(
            setSummary(
              addFound(current, outcome.items, { course: course.code, from: "syllabus", fromLabel: () => fromLabel, foundAt: at }),
              course.id,
              outcome.summary ? { text: outcome.summary, files: fromLabel, locale: language, provider: outcome.provider, at } : null,
            ),
            key,
            signature,
          ),
          true,
        );
      }
    }

    for (const batch of announcementBatches(announcementsRef.current, stateRef.current)) {
      if (!active()) return null;
      const stillCurrent = () => batch.ids.every((id, index) => {
        const current = announcementsRef.current.find((announcement) => announcement.id === id);
        return current && announcementSignature(current) === batch.signatures[index];
      });
      if (!stillCurrent()) continue;
      const label = (batch.course ?? "Course").slice(0, 80);
      setStatus({ phase: "reading", what: "announcements", course: label });
      await pause();
      if (!active()) return null;
      if (!stillCurrent()) continue;
      const outcome = await ask({ kind: "announcements", courseLabel: label, term: null, today, text: "", announcements: batch.announcements }, controller.signal);
      if (!active()) return null;
      if (!stillCurrent()) continue;
      if ("stop" in outcome) return { problem: outcome.stop, retry: outcome.retry };
      if ("failed" in outcome) {
        commit((current) => batch.ids.reduce((next, id, index) => markFailed(next, announcementKey(id), batch.signatures[index]), current), true);
        continue;
      }
      commit((current) =>
        batch.ids.reduce(
          (next, id, index) => markRead(next, announcementKey(id), batch.signatures[index]),
          addFound(supersede(current, batch.ids), outcome.items, {
            course: batch.course,
            from: "announcement",
            fromLabel: (item) => (item.source ? batch.announcements[item.source - 1]?.title ?? "" : ""),
            announcementId: (item) => (item.source ? batch.ids[item.source - 1] ?? null : null),
            foundAt: new Date().toISOString(),
          }),
        ),
        true,
      );
    }
    return null;
  }, [ask, commit, openMaterials, readCurrent, wait]);

  const run = useCallback(async () => {
    if (!readCurrent().enabled) return;
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
      } while (again.current && stateRef.current.enabled && !stopped);
    } catch {
      stopped = { problem: "failed", retry: false };
    } finally {
      running.current = false;
    }
    if (!mounted.current || !stateRef.current.enabled) return;
    setStatus({ phase: "idle", problem: stopped?.problem ?? null });
    if (stopped?.retry) retryTimer.current = setTimeout(() => void runRef.current(), RETRY_MS);
  }, [readAll, readCurrent]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  // The triggers below go through the ref, so a new `run` alone never starts a read.
  // On opening the app, whenever it is turned on, and when the language changes (a summary is written in it).
  useEffect(() => {
    if (state.enabled) void runRef.current();
  }, [state.enabled, locale]);

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
  // Their text counts as well as their ids: the id stays when the teacher edits the body.
  const announcementIds = useMemo(() => announcements.map((announcement) => announcement.id + ":" + announcementSignature(announcement)).join("|"), [announcements]);
  useEffect(() => {
    if (!state.enabled || !announcementIds) return;
    const timer = setTimeout(() => void runRef.current(), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [announcementIds, state.enabled]);

  const commitUndated = useCallback((change: (current: UndatedTodo[]) => UndatedTodo[]) => {
    try {
      const next = change(undatedRef.current);
      saveUndatedTodos(window.localStorage, next);
      undatedRef.current = next;
      setUndated(next);
    } catch (error) {
      setSaveProblem(true);
      throw error;
    }
  }, []);

  const value: AiPlanValue = {
    enabled: state.enabled,
    status,
    pending: state.pending,
    summaries: state.summaries,
    undated,
    saveProblem,
    enable: () => {
      const current = restorePlanState(window.localStorage);
      const next = { ...current, enabled: true, enabledAt: current.enabledAt ?? new Date().toISOString() };
      try {
        saveSwitchedOn(window.localStorage, next);
        locallyOff.current = false;
        stateRef.current = next;
        setState(next);
        setSaveProblem(false);
      } catch { setSaveProblem(true); }
    },
    disable: () => {
      stopReading();
      // Off on screen whatever happens to storage, and off in storage too, by whatever means.
      const next = { ...restorePlanState(window.localStorage), enabled: false };
      const saved = saveSwitchedOff(window.localStorage, next);
      locallyOff.current = !saved;
      stateRef.current = next;
      setState(next);
      setSaveProblem(!saved);
      setStatus({ phase: "idle", problem: null });
    },
    checkNow: () => {
      commit((current) => ({ ...current, failed: {} }));
      setStatus({ phase: "idle", problem: null });
      void run();
    },
    resolve: (added, dismissed) => {
      setSaveProblem(false);
      readCurrent();
      const byId = new Map(stateRef.current.pending.map((suggestion) => [suggestion.id, suggestion]));
      const now = new Date().toISOString();
      const events = [];
      const eventIds: string[] = [];
      const todos: UndatedTodo[] = [];
      for (const { id, day } of added) {
        const suggestion = byId.get(id);
        if (!suggestion) continue;
        if (day) {
          events.push(suggestionToEvent(suggestion, day));
          eventIds.push(id);
        }
        else todos.push(suggestionToUndated(suggestion, now));
      }
      let saved = true;
      if (events.length > 0) {
        try {
          const next = decide(stateRef.current, Object.fromEntries(eventIds.map((id) => [id, "added" as const])));
          addCustomEvents(events, (staged) => savePlanState(staged, next));
          stateRef.current = next;
          setState(next);
        } catch { saved = false; }
      }
      if (todos.length > 0) {
        try {
          const nextTodos = [...undatedRef.current, ...todos.filter((todo) => !undatedRef.current.some((existing) => existing.id === todo.id))];
          const next = decide(stateRef.current, Object.fromEntries(todos.map((todo) => [todo.id, "added" as const])));
          writeStorageBatch(window.localStorage, (staged) => {
            saveUndatedTodos(staged, nextTodos);
            savePlanState(staged, next);
          });
          undatedRef.current = nextTodos;
          setUndated(nextTodos);
          stateRef.current = next;
          setState(next);
        } catch { saved = false; }
      }
      const verdicts: Record<string, "dismissed"> = {};
      for (const id of dismissed) if (stateRef.current.pending.some((suggestion) => suggestion.id === id)) verdicts[id] = "dismissed";
      if (Object.keys(verdicts).length > 0 && !commit((current) => decide(current, verdicts))) saved = false;
      setSaveProblem(!saved);
      return saved;
    },
    toggleUndated: (id) => {
      try { commitUndated((current) => current.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo))); } catch { /* shown beside the list */ }
    },
    removeUndated: (id) => {
      try { commitUndated((current) => current.filter((todo) => todo.id !== id)); } catch { /* shown beside the list */ }
    },
    addUndated: ({ title, course, note }) => {
      const id = `announcement-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
      commitUndated((current) => [...current, { id, title, course, note, done: false, addedAt: new Date().toISOString() }]);
      return id;
    },
  };

  return <AiPlanContext.Provider value={value}>{children}</AiPlanContext.Provider>;
}
