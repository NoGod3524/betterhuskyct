"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronRight, ChevronUp, Plug, Plus, TriangleAlert, X } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import {
  COURSE_COMPONENTS,
  MAX_COURSES,
  type CourseComponent,
} from "@/lib/courses";
import { t } from "@/lib/i18n";

/** The error and success rows, shared by both states of the card. */
function StatusRows({
  error,
  notice,
}: {
  error: string | null;
  notice: string | null;
}) {
  return (
    <>
      {error && (
        <div
          className="flex items-start gap-2 border-t border-[var(--line)] bg-[var(--danger-soft)] px-4 py-2.5 text-sm text-[var(--danger)] sm:px-5"
          role="alert"
          aria-live="polite"
        >
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          className="flex items-start gap-2 border-t border-[var(--line)] px-4 py-2.5 text-xs text-[var(--muted)] sm:px-5"
          role="status"
          aria-live="polite"
        >
          <Check size={14} className="mt-px shrink-0 text-[var(--success)]" />
          <span>{notice}</span>
        </div>
      )}
    </>
  );
}

/**
 * The card for what is connected: the calendars a sync brought, which course each belongs to, and
 * the student's own list of courses. With nothing connected it says how to: the Sync button at
 * the top of the page, and the helper it needs the first time.
 *
 * Once something is in, the card gets out of the way: it shrinks to one line.
 */
export function ConnectSection() {
  const {
    locale,
    error,
    notice,
    courses,
    addCourse,
    editCourse,
    dropCourse,
    setDefaultCourse,
    subscriptions,
    addFeedCourse,
    dropSubscription,
  } = useCalendar();
  const [draftCode, setDraftCode] = useState("");
  const [draftComponent, setDraftComponent] = useState<CourseComponent | "">("");
  const atCourseLimit = courses.length >= MAX_COURSES;
  const hasCalendars = subscriptions.length > 0;
  const [isExpanded, setIsExpanded] = useState(false);
  const previousCount = useRef(subscriptions.length);

  // Adding a calendar is the moment this card stops being useful, so it folds
  // itself away and lets the new deadlines take the space.
  useEffect(() => {
    if (subscriptions.length > previousCount.current) setIsExpanded(false);
    previousCount.current = subscriptions.length;
  }, [subscriptions.length]);

  const showPanel = !hasCalendars || isExpanded;

  function handleAddCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addCourse(draftCode, draftComponent || null);
    setDraftCode("");
    setDraftComponent("");
  }

  if (!showPanel) {
    return (
      <section
        className="card mt-6 overflow-hidden"
        aria-label={t(locale, "connect.title")}
        id="connect"
      >
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
            <Plug size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {t(
                locale,
                subscriptions.length === 1
                  ? "connect.readyOne"
                  : "connect.readyMany",
                { count: subscriptions.length },
              )}
            </p>
            <p className="truncate text-xs text-[var(--muted)]">
              {t(locale, "connect.readyHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="btn btn-quiet h-8 shrink-0"
          >
            {t(locale, "connect.manage")}
            <ChevronRight size={14} />
          </button>
        </div>
        <StatusRows error={error} notice={notice} />
      </section>
    );
  }

  return (
    <section
      className="card mt-6 overflow-hidden"
      aria-labelledby="connect-title"
      id="connect"
    >
      <div className="flex gap-4 p-5 pb-0 sm:p-6 sm:pb-0">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
          <Plug size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="connect-title" className="font-display text-base font-semibold">
            {t(locale, "connect.title")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            {t(locale, "connect.description")}
          </p>
        </div>
        {hasCalendars && (
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="btn btn-quiet h-8 shrink-0 self-start"
          >
            <ChevronUp size={15} />
            {t(locale, "connect.collapse")}
          </button>
        )}
      </div>

      {!hasCalendars && (
        <div className="flex flex-wrap items-center gap-3 p-5 pt-3 sm:p-6 sm:pt-3">
          <Link href="/helper" className="btn btn-primary h-9 px-4 text-sm">
            {t(locale, "connect.setup")}
            <ChevronRight size={16} />
          </Link>
        </div>
      )}

      {subscriptions.length > 0 && (
        <div className="border-t border-[var(--line)] px-5 py-4 sm:px-7">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            {t(locale, "subscriptions.title")}
          </h3>
          <ul className="mt-2 space-y-2">
            {subscriptions.map((subscription) => (
              <li
                key={subscription.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2"
              >
                <span
                  className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]"
                  title={subscription.name ?? undefined}
                >
                  {subscription.name?.trim() ||
                    t(locale, "subscriptions.unnamed")}
                </span>
                <span className="shrink-0 text-xs text-[var(--muted)]">
                  {t(
                    locale,
                    subscription.events.length === 1
                      ? "subscriptions.tasksOne"
                      : "subscriptions.tasks",
                    { count: subscription.events.length },
                  )}
                </span>
                {/* Only worth a picker once there is something to pick. */}
                {courses.length > 0 && (
                  <select
                    aria-label={t(locale, "subscriptions.courseLabel")}
                    value={subscription.courseId ?? ""}
                    onChange={(event) =>
                      addFeedCourse(subscription.id, event.target.value || null)
                    }
                    className="h-8 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-4 focus:ring-[var(--blue)]/10"
                  >
                    <option value="">{t(locale, "connect.courseNone")}</option>
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.code.trim() || t(locale, "course.untitled")}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => dropSubscription(subscription.id)}
                  aria-label={t(locale, "subscriptions.removeLabel", {
                    name:
                      subscription.name?.trim() ||
                      t(locale, "subscriptions.unnamed"),
                  })}
                  className="ml-auto grid size-7 shrink-0 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                >
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="group border-t border-[var(--line)] px-5 py-3 text-sm sm:px-7">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-[var(--ink)] [&::-webkit-details-marker]:hidden">
          <ChevronRight size={15} className="shrink-0 text-[var(--blue)] transition group-open:rotate-90" />
          {t(locale, "course.summary")}
          {courses.length > 0 && (
            <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--accent-ink)]">
              {courses.length}
            </span>
          )}
        </summary>
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
          {t(locale, "course.hint")}
        </p>

        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={handleAddCourse}
        >
          <label className="sr-only" htmlFor="course-code">
            {t(locale, "course.codeLabel")}
          </label>
          <input
            id="course-code"
            type="text"
            value={draftCode}
            onChange={(event) => setDraftCode(event.target.value)}
            placeholder={t(locale, "course.codePlaceholder")}
            autoComplete="off"
            className="h-9 w-44 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-4 focus:ring-[var(--blue)]/10"
          />
          <select
            aria-label={t(locale, "course.component")}
            value={draftComponent}
            onChange={(event) =>
              setDraftComponent(event.target.value as CourseComponent | "")
            }
            className="h-9 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-4 focus:ring-[var(--blue)]/10"
          >
            <option value="">{t(locale, "course.componentNone")}</option>
            {COURSE_COMPONENTS.map((component) => (
              <option key={component} value={component}>
                {component}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!draftCode.trim() || atCourseLimit}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--accent-ink)] transition hover:border-[var(--line-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={15} />
            {t(locale, "course.add")}
          </button>
          {atCourseLimit && (
            <span className="text-xs text-[var(--muted)]">
              {t(locale, "course.limit", { max: MAX_COURSES })}
            </span>
          )}
        </form>

        {courses.length === 0 ? (
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
            {t(locale, "course.empty")}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {courses.map((course) => (
              <li
                key={course.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2"
              >
                <input
                  type="text"
                  value={course.code}
                  onChange={(event) =>
                    editCourse(course.id, { code: event.target.value })
                  }
                  aria-label={t(locale, "course.codeLabel")}
                  placeholder={t(locale, "course.codePlaceholder")}
                  autoComplete="off"
                  className="h-8 w-40 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-4 focus:ring-[var(--blue)]/10"
                />
                <select
                  aria-label={t(locale, "course.component")}
                  value={course.component ?? ""}
                  onChange={(event) =>
                    editCourse(course.id, {
                      component: (event.target.value || null) as CourseComponent | null,
                    })
                  }
                  className="h-8 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-4 focus:ring-[var(--blue)]/10"
                >
                  <option value="">{t(locale, "course.componentNone")}</option>
                  {COURSE_COMPONENTS.map((component) => (
                    <option key={component} value={component}>
                      {component}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-pressed={course.isDefault}
                  onClick={() =>
                    setDefaultCourse(course.isDefault ? null : course.id)
                  }
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                    course.isDefault
                      ? "border-[var(--navy)] bg-[var(--navy)] text-white"
                      : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--accent-ink)]"
                  }`}
                >
                  {t(
                    locale,
                    course.isDefault ? "course.isDefault" : "course.makeDefault",
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => dropCourse(course.id)}
                  aria-label={t(locale, "course.removeLabel", {
                    code: course.code.trim() || t(locale, "course.untitled"),
                  })}
                  className="ml-auto grid size-7 shrink-0 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                >
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>

      <StatusRows error={error} notice={notice} />
    </section>
  );
}
