"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { formatPoints } from "@/lib/grades";
import { neededOnRest } from "@/lib/grade-target";
import { t, type Locale } from "@/lib/i18n";

/** "What do I need?" under a course: the target and what is still to come are the student's to enter. */
export function GradeTarget({ locale, percent }: { locale: Locale; percent: number }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("90");
  const [rest, setRest] = useState("30");
  const result = neededOnRest(percent, rest === "" ? NaN : Number(rest), target === "" ? NaN : Number(target));

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1.5 py-1 text-left text-sm font-medium text-[var(--muted)] transition hover:text-[var(--ink)]"
      >
        <ChevronRight size={16} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        {t(locale, "gradeTarget.title")}
      </button>
      {open ? (
        <div className="rise-in mt-1 grid gap-3 text-sm">
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-[var(--muted)]">{t(locale, "gradeTarget.target")}</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                className="h-9 w-28 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 tabular-nums"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--muted)]">{t(locale, "gradeTarget.rest")}</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                value={rest}
                onChange={(event) => setRest(event.target.value)}
                className="h-9 w-28 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 tabular-nums"
              />
            </label>
          </div>
          <p role="status" className="font-medium">
            {result.kind === "none"
              ? t(locale, "gradeTarget.none")
              : result.kind === "safe"
                ? t(locale, "gradeTarget.safe", { target })
                : result.kind === "needs"
                  ? t(locale, "gradeTarget.needs", { percent: formatPoints(result.percent), target })
                  : t(locale, "gradeTarget.out", { best: formatPoints(result.best), target })}
          </p>
          <p className="text-xs leading-5 text-[var(--muted)]">{t(locale, "gradeTarget.note")}</p>
        </div>
      ) : null}
    </div>
  );
}
