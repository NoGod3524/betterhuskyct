"use client";

import { Clock3, Flame, TriangleAlert } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { CoursePicker } from "@/components/course-picker";
import { EFFORT_LEVELS, effortFor } from "@/lib/effort";
import type { PlannedTask } from "@/lib/plan";
import { t, intlLocale, type Locale } from "@/lib/i18n";

const GROUP_TONES = {
  danger: "bg-[var(--c-e6533c)]",
  warn: "bg-[var(--c-e9a23b)]",
  calm: "bg-[var(--c-2a71d8)]",
} as const;

function whenLabel(item: PlannedTask, locale: Locale): string {
  if (item.overdue) {
    return item.daysLeft < 0
      ? t(locale, "plan.overdueBy", { days: Math.abs(item.daysLeft) })
      : t(locale, "plan.overdue");
  }
  if (item.daysLeft <= 0) return t(locale, "plan.dueToday");
  if (item.daysLeft === 1) return t(locale, "plan.dueTomorrow");
  return t(locale, "plan.dueIn", { days: item.daysLeft });
}

/** The exact moment something is due, so the row is not just "in 4 days". */
function dueMomentLabel(item: PlannedTask, locale: Locale): string {
  const due = new Date(item.dueAt);
  if (item.task.allDay) {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      month: "short",
      day: "numeric",
      weekday: "short",
    }).format(due);
  }

  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(due);
}

function PlanRow({ item }: { item: PlannedTask }) {
  const { locale, efforts, setTaskEffort, toggleTaskCompletion, courseLabelFor } =
    useCalendar();
  const level = effortFor(efforts, item.task.id);
  const course = courseLabelFor(item.task);

  return (
    <li className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {course && (
              <span className="rounded-md bg-[var(--c-e8f1ff)] px-2 py-0.5 text-[10px] font-bold tracking-[0.04em] text-[var(--c-1e5ca8)]">
                {course.code}
                {course.component ? ` · ${course.component}` : ""}
              </span>
            )}
            {item.task.kind && (
              <span className="rounded-md bg-[var(--c-f0f3f7)] px-2 py-0.5 text-[10px] font-bold tracking-[0.04em] text-[var(--c-536476)]">
                {t(
                  locale,
                  item.task.kind === "class"
                    ? "kind.class"
                    : "kind.assignment",
                )}
              </span>
            )}
          </div>
          <p className="mt-1.5 break-words text-sm font-semibold text-[var(--c-172b41)]">
            {item.task.title}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--muted)]">
            {item.task.location && (
              <>
                <span>{item.task.location}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>{dueMomentLabel(item, locale)}</span>
            <span aria-hidden="true">·</span>
            <span>{whenLabel(item, locale)}</span>
            {item.atRisk && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t(locale, "plan.sessions", {
                    needed: item.sessionsNeeded,
                    available: item.sessionsAvailable,
                  })}
                </span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => toggleTaskCompletion(item.task.id)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--c-4e647b)] transition hover:border-[var(--c-9fb7d1)] hover:text-[var(--c-244e7a)]"
        >
          {t(locale, "plan.markDone")}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={t(locale, "plan.effortLabel")}
          className="flex flex-wrap items-center gap-1.5"
        >
          {EFFORT_LEVELS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTaskEffort(item.task.id, option)}
              aria-pressed={level === option}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                level === option
                  ? "border-[var(--navy)] bg-[var(--navy)] text-white"
                  : "border-[var(--c-dbe3ec)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--c-9fb7d1)] hover:text-[var(--c-244e7a)]"
              }`}
            >
              {t(locale, `plan.effort.${option}`)}
            </button>
          ))}
        </div>
        <CoursePicker taskId={item.task.id} className="ml-auto" />
      </div>
    </li>
  );
}

function PlanGroup({
  titleKey,
  hintKey,
  tone,
  items,
}: {
  titleKey: "plan.overdue" | "plan.atRisk" | "plan.upcoming";
  hintKey: "plan.overdueHint" | "plan.atRiskHint" | "plan.upcomingHint";
  tone: keyof typeof GROUP_TONES;
  items: PlannedTask[];
}) {
  const { locale } = useCalendar();
  if (items.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <span className={`size-2.5 shrink-0 rounded-full ${GROUP_TONES[tone]}`} />
        <h2 className="font-display text-lg font-semibold">{t(locale, titleKey)}</h2>
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--c-f0f3f7)] text-xs font-bold text-[var(--c-536476)]">
          {items.length}
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">{t(locale, hintKey)}</p>
      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <PlanRow key={item.task.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The plan route: compared with the week view, this adds two things the calendar
 * alone cannot tell you — which deadlines no longer fit in the days remaining,
 * and which ones already slipped past.
 */
export function PlanSection() {
  const { locale, plan } = useCalendar();
  const urgent = plan.overdue.length + plan.atRisk.length;
  const empty = urgent + plan.upcoming.length === 0;

  return (
    <section className="mt-8" aria-labelledby="plan-heading">
      <p className="eyebrow">{t(locale, "plan.eyebrow")}</p>
      <h1
        id="plan-heading"
        className="font-display mt-1 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl"
      >
        {t(locale, "plan.heading")}
      </h1>

      {urgent > 0 && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--c-f0d9a8)] bg-[var(--c-fffaf0)] px-4 py-2 text-xs font-semibold text-[var(--c-8a5a12)]">
          <Flame size={14} />
          {t(locale, "plan.focus", { minutes: plan.focusMinutes })}
        </p>
      )}

      {empty ? (
        <p className="mt-6 flex items-start gap-2.5 rounded-2xl border border-dashed border-[var(--c-d7e1ec)] bg-[var(--c-fafcff)] p-5 text-sm text-[var(--muted)]">
          <Clock3 size={17} className="mt-0.5 shrink-0" />
          {t(locale, "plan.empty")}
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          <PlanGroup
            titleKey="plan.overdue"
            hintKey="plan.overdueHint"
            tone="danger"
            items={plan.overdue}
          />
          <PlanGroup
            titleKey="plan.atRisk"
            hintKey="plan.atRiskHint"
            tone="warn"
            items={plan.atRisk}
          />
          <PlanGroup
            titleKey="plan.upcoming"
            hintKey="plan.upcomingHint"
            tone="calm"
            items={plan.upcoming}
          />
        </div>
      )}

      {urgent > 0 && (
        <p className="mt-6 flex items-start gap-2.5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-xs leading-5 text-[var(--muted)]">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-[var(--c-e9a23b)]" />
          {t(locale, "plan.atRiskHint")}
        </p>
      )}
    </section>
  );
}
