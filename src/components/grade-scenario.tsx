"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ChevronRight, Plus, Sparkles, X } from "lucide-react";

import { joinSyllabusTexts } from "@/lib/ai-plan";
import { SummaryError } from "@/lib/announcement-summary";
import { requestGrading } from "@/lib/grading-client";
import type { GradingResult } from "@/lib/grading-models";
import type { MaterialsStore, StoredFile } from "@/lib/materials";
import { openMaterialsStore } from "@/lib/materials-store";
import { pickSyllabusFiles, readFileText } from "@/lib/syllabus";
import {
  guessCategory,
  letterFor,
  MAX_CATEGORIES,
  neededOnOpen,
  scenarioTotal,
  standingOf,
  valueOf,
  type Scheme,
} from "@/lib/grade-scenarios";
import { parseSchemes, saveScheme, SCENARIOS_CHANGED, SCENARIOS_KEY, schemeFor } from "@/lib/grade-scenarios-store";
import { isCounted, formatPoints, type GradesCourse } from "@/lib/grades";
import { t, type Locale } from "@/lib/i18n";

function subscribe(onChange: () => void) {
  window.addEventListener(SCENARIOS_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SCENARIOS_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(SCENARIOS_KEY);
  } catch {
    return null;
  }
}

const inputClass = "h-9 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 text-sm tabular-nums";
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * "What if…?" under a course's scores. The student gives how the course is graded (from the
 * syllabus), drags each part to what they expect, and sees where the course lands, or says
 * which parts are still to come and a grade they want, and sees what those must average.
 * Everything here is a scenario of the student's own making, not a forecast, and is kept in this
 * browser.
 */
export function GradeScenario({
  course,
  locale,
  openMaterials = openMaterialsStore,
  fetchImpl,
}: {
  course: GradesCourse;
  locale: Locale;
  openMaterials?: () => Promise<MaterialsStore>;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}) {
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [found, setFound] = useState<GradingResult | null>(null);
  const [readMessage, setReadMessage] = useState<string | null>(null);
  const [target, setTarget] = useState("93");
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const scheme = useMemo(() => schemeFor(parseSchemes(raw), course.id), [raw, course.id]);
  const standing = useMemo(() => standingOf(course.items, scheme), [course.items, scheme]);
  const total = useMemo(() => scenarioTotal(standing, scheme), [standing, scheme]);
  const needed = useMemo(() => neededOnOpen(standing, scheme, target === "" ? NaN : Number(target)), [standing, scheme, target]);
  const scored = course.items.filter(isCounted);

  function change(next: Scheme) {
    saveScheme(window.localStorage, course.id, next);
    window.dispatchEvent(new window.Event(SCENARIOS_CHANGED));
  }

  /**
   * Reads how the syllabus grades the course, when the student presses the button: the syllabus
   * text goes to an AI service, and what comes back is shown for them to check, never used on its own.
   */
  async function readSyllabus() {
    setReading(true);
    setFound(null);
    setReadMessage(null);
    try {
      let files: StoredFile[] = [];
      let courseFiles: Parameters<typeof pickSyllabusFiles>[0] | undefined;
      try {
        const store = await openMaterials();
        const index = await store.getIndex();
        courseFiles = index?.courses.find((entry) => entry.id === course.id);
        files = courseFiles ? await store.files() : [];
      } catch {
        courseFiles = undefined;
      }
      const byKey = new Map(files.map((file) => [file.key, file]));
      const picks = courseFiles ? pickSyllabusFiles(courseFiles, byKey) : [];
      if (picks.length === 0) {
        setReadMessage(t(locale, "scenario.noSyllabus"));
        return;
      }
      const texts: Array<{ name: string; text: string }> = [];
      for (const pick of picks) {
        const text = await readFileText(byKey.get(pick.key)!);
        if (text) texts.push({ name: pick.name, text });
      }
      if (texts.length === 0) {
        setReadMessage(t(locale, "scenario.noText"));
        return;
      }
      const result = await requestGrading({ courseLabel: (course.code ?? course.id).slice(0, 80), text: joinSyllabusTexts(texts) }, fetchImpl);
      if (result.parts.length === 0) setReadMessage(t(locale, "scenario.notSaid"));
      else setFound(result);
    } catch (error) {
      const problem = error instanceof SummaryError ? error.problem : "failed";
      setReadMessage(
        t(locale, problem === "busy" || problem === "rate-limited" ? "scenario.errorBusy" : problem === "unavailable" ? "scenario.errorUnavailable" : "scenario.errorFailed"),
      );
    } finally {
      setReading(false);
    }
  }

  /** The parts the syllabus gave, once the student has checked them: they replace the ones above. */
  function useFound() {
    if (!found) return;
    change({ categories: found.parts.map((part) => ({ id: newId(), name: part.name, weight: part.weight })), assigned: {}, expected: {}, open: [] });
    setFound(null);
  }

  const addPart = () => {
    if (scheme.categories.length >= MAX_CATEGORIES) return;
    change({ ...scheme, categories: [...scheme.categories, { id: newId(), name: "", weight: 0 }] });
  };
  const editPart = (id: string, patch: { name?: string; weight?: number }) =>
    change({ ...scheme, categories: scheme.categories.map((part) => (part.id === id ? { ...part, ...patch } : part)) });
  const removePart = (id: string) =>
    change({
      categories: scheme.categories.filter((part) => part.id !== id),
      assigned: Object.fromEntries(Object.entries(scheme.assigned).filter(([, value]) => value !== id)),
      expected: Object.fromEntries(Object.entries(scheme.expected).filter(([key]) => key !== id)),
      open: scheme.open.filter((value) => value !== id),
    });
  const setExpected = (id: string, percent: number | null) => {
    const expected = { ...scheme.expected };
    if (percent === null) delete expected[id];
    else expected[id] = percent;
    change({ ...scheme, expected });
  };
  const toggleOpen = (id: string) =>
    change({ ...scheme, open: scheme.open.includes(id) ? scheme.open.filter((value) => value !== id) : [...scheme.open, id] });
  const assign = (rowId: string, categoryId: string) => {
    const assigned = { ...scheme.assigned };
    if (categoryId === "") delete assigned[rowId];
    else assigned[rowId] = categoryId;
    change({ ...scheme, assigned });
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1.5 py-1 text-left text-sm font-medium text-[var(--muted)] transition hover:text-[var(--ink)]"
      >
        <ChevronRight size={16} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        {t(locale, "scenario.title")}
      </button>
      {open ? (
        <div className="rise-in mt-1 grid gap-4 text-sm">
          <p className="text-xs leading-5 text-[var(--muted)]">{t(locale, "scenario.intro")}</p>

          <div className="grid gap-2">
            <h4 className="font-semibold">{t(locale, "scenario.partsHeading")}</h4>
            {scheme.categories.map((part) => (
              <div key={part.id} className="flex flex-wrap items-center gap-2">
                <input
                  value={part.name}
                  onChange={(event) => editPart(part.id, { name: event.target.value })}
                  placeholder={t(locale, "scenario.partName")}
                  aria-label={t(locale, "scenario.partName")}
                  className={`${inputClass} min-w-[9rem] flex-1`}
                />
                <label className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={part.weight}
                    onChange={(event) => editPart(part.id, { weight: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })}
                    aria-label={t(locale, "scenario.partWeight", { name: part.name || "?" })}
                    className={`${inputClass} w-20`}
                  />
                  <span className="text-[var(--muted)]">%</span>
                </label>
                <button
                  type="button"
                  onClick={() => removePart(part.id)}
                  aria-label={t(locale, "scenario.partRemove", { name: part.name || "?" })}
                  className="grid size-8 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--subtle)]"
                >
                  <X size={15} aria-hidden />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={addPart} className="btn btn-quiet h-8 px-2.5 text-xs">
                <Plus size={13} />
                {t(locale, "scenario.addPart")}
              </button>
              <button type="button" onClick={() => void readSyllabus()} disabled={reading} className="btn btn-quiet h-8 px-2.5 text-xs">
                <Sparkles size={13} aria-hidden />
                {t(locale, reading ? "scenario.reading" : "scenario.readSyllabus")}
              </button>
              {scheme.categories.length > 0 ? (
                <span className={`text-xs ${Math.abs(total.totalWeight - 100) < 0.05 ? "text-[var(--muted)]" : "text-[var(--warning)]"}`}>
                  {t(locale, "scenario.weightSum", { sum: formatPoints(total.totalWeight) })}
                </span>
              ) : null}
            </div>
            <p className="text-xs leading-5 text-[var(--muted)]">{t(locale, "scenario.readDisclosure")}</p>
            {readMessage ? (
              <p role="status" className="text-xs text-[var(--warning)]">
                {readMessage}
              </p>
            ) : null}
            {found ? (
              <div role="region" aria-label={t(locale, "scenario.foundHeading")} className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--accent-soft)] p-3">
                <h5 className="font-semibold">{t(locale, "scenario.foundHeading")}</h5>
                <ul className="grid gap-1.5">
                  {found.parts.map((part, index) => (
                    <li key={index} className="grid gap-0.5">
                      <span className="font-medium">
                        {part.name} <span className="font-normal text-[var(--muted)]">· {formatPoints(part.weight)}%</span>
                      </span>
                      {part.evidence ? <span className="text-xs italic text-[var(--muted)]">{part.evidence}</span> : null}
                    </li>
                  ))}
                </ul>
                {found.note ? <p className="text-xs text-[var(--muted)]">{found.note}</p> : null}
                <p className="text-xs text-[var(--muted)]">{t(locale, "scenario.foundCheck")}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={useFound} className="btn btn-primary h-8 px-3 text-xs">
                    {t(locale, "scenario.useFound")}
                  </button>
                  <button type="button" onClick={() => setFound(null)} className="btn btn-quiet h-8 px-3 text-xs">
                    {t(locale, "scenario.dismissFound")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {scheme.categories.length > 0 ? (
            <>
              <div className="grid gap-3">
                <h4 className="font-semibold">{t(locale, "scenario.slidersHeading")}</h4>
                {standing.parts.map((part) => {
                  const value = valueOf(part, scheme);
                  const isSet = scheme.expected[part.category.id] !== undefined;
                  return (
                    <div key={part.category.id} className="grid gap-1 rounded-lg border border-[var(--line)] p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">
                          {part.category.name || "?"} <span className="font-normal text-[var(--muted)]">· {formatPoints(part.category.weight)}%</span>
                        </span>
                        <span className="text-xs text-[var(--muted)]">
                          {part.average === null
                            ? t(locale, "scenario.nothingScored")
                            : t(locale, "scenario.standsAt", { average: formatPoints(part.average), count: part.scored })}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={0.5}
                          value={value ?? 85}
                          onChange={(event) => setExpected(part.category.id, Number(event.target.value))}
                          aria-label={t(locale, "scenario.expect", { name: part.category.name || "?" })}
                          className="h-2 flex-1 accent-[var(--blue)]"
                        />
                        <span className="w-14 text-right font-semibold tabular-nums">{value === null ? "—" : `${formatPoints(value)}%`}</span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
                        <label className="flex items-center gap-1.5">
                          <input type="checkbox" checked={scheme.open.includes(part.category.id)} onChange={() => toggleOpen(part.category.id)} />
                          {t(locale, "scenario.stillToCome")}
                        </label>
                        {isSet ? (
                          <button type="button" onClick={() => setExpected(part.category.id, null)} className="font-medium text-[var(--link)] hover:underline">
                            {t(locale, "scenario.useCurrent")}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div role="status" className="rounded-lg bg-[var(--accent-soft)] p-3">
                {total.percent === null ? (
                  <p>{t(locale, "scenario.noTotal")}</p>
                ) : (
                  <>
                    <p className="font-semibold">
                      {t(locale, "scenario.total", { percent: formatPoints(total.percent), letter: letterFor(total.percent) })}
                    </p>
                    {total.missingWeight > 0 ? (
                      <p className="mt-1 text-xs text-[var(--muted)]">{t(locale, "scenario.missing", { weight: formatPoints(total.missingWeight) })}</p>
                    ) : null}
                  </>
                )}
                <p className="mt-1 text-xs text-[var(--muted)]">{t(locale, "scenario.notAForecast")}</p>
              </div>

              <div className="grid gap-2">
                <h4 className="font-semibold">{t(locale, "scenario.targetHeading")}</h4>
                <label className="flex flex-wrap items-center gap-2">
                  <span className="text-[var(--muted)]">{t(locale, "scenario.target")}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    className={`${inputClass} w-24`}
                  />
                  <span className="text-[var(--muted)]">%</span>
                </label>
                <p role="status" className="font-medium">
                  {scheme.open.length === 0
                    ? t(locale, "scenario.pickOpen")
                    : needed.kind === "none"
                      ? t(locale, "scenario.needNone")
                      : needed.kind === "safe"
                        ? t(locale, "scenario.needSafe", { target })
                        : needed.kind === "needs"
                          ? t(locale, "scenario.needs", { percent: formatPoints(needed.percent), target })
                          : t(locale, "scenario.needOut", { best: formatPoints(needed.best), target })}
                </p>
              </div>

              {scored.length > 0 ? (
                <details className="text-xs">
                  <summary className="cursor-pointer font-medium text-[var(--muted)]">{t(locale, "scenario.rowsHeading")}</summary>
                  <ul className="mt-2 grid gap-1.5">
                    {scored.map((row) => {
                      const guessed = guessCategory(row.title, scheme.categories);
                      const chosen = scheme.assigned[row.id] ?? "";
                      return (
                        <li key={row.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate">{row.title}</span>
                          <select
                            value={chosen}
                            onChange={(event) => assign(row.id, event.target.value)}
                            aria-label={t(locale, "scenario.rowPart", { title: row.title })}
                            className="h-8 rounded-md border border-[var(--line)] bg-[var(--surface)] px-1.5"
                          >
                            <option value="">
                              {guessed
                                ? t(locale, "scenario.rowGuess", { name: scheme.categories.find((part) => part.id === guessed)?.name || "?" })
                                : t(locale, "scenario.rowNone")}
                            </option>
                            {scheme.categories.map((part) => (
                              <option key={part.id} value={part.id}>
                                {part.name || "?"}
                              </option>
                            ))}
                          </select>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
