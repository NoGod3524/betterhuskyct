"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  ChevronRight,
  ChevronUp,
  FileUp,
  LoaderCircle,
  Plus,
  RefreshCw,
  Smartphone,
  TriangleAlert,
  X,
} from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { SyncSection } from "@/components/sync-section";
import {
  COURSE_COMPONENTS,
  MAX_COURSES,
  type CourseComponent,
} from "@/lib/courses";
import { MAX_SUBSCRIPTIONS } from "@/lib/subscriptions";
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
          className="flex items-start gap-2 border-t border-[#f3cec8] bg-[#fff6f4] px-5 py-3 text-sm text-[#9f3527] sm:px-7"
          role="alert"
          aria-live="polite"
        >
          <TriangleAlert size={17} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          className="flex items-start gap-2 border-t border-[#cce5d7] bg-[#f3fbf7] px-5 py-3 text-sm text-[#276944] sm:px-7"
          role="status"
          aria-live="polite"
        >
          <Check size={17} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
    </>
  );
}

/**
 * The import card.
 *
 * The path a HuskyCT student actually walks ends at a file: Share calendar →
 * Copy → paste into the address bar → the browser downloads an `.ics` → drag it
 * in. So the drop target is the destination, and the numbered steps sit beside
 * it, ending on it. Pasting the copied link straight in is offered as the
 * shortcut it is — two steps shorter, but not the route anyone was taught.
 *
 * Once a calendar is in, the card gets out of the way: it shrinks to one line.
 */
export function ConnectSection() {
  const {
    locale,
    handleImport,
    importCalendarFiles,
    calendarUrl,
    setCalendarUrl,
    isLoading,
    error,
    notice,
    rememberSource,
    toggleRememberSource,
    courses,
    addCourse,
    editCourse,
    dropCourse,
    setDefaultCourse,
    subscriptions,
    canAddSubscription,
    importCourseId,
    setImportCourseId,
    addFeedCourse,
    dropSubscription,
    refreshSubscription,
  } = useCalendar();
  const [draftCode, setDraftCode] = useState("");
  const [draftComponent, setDraftComponent] = useState<CourseComponent | "">("");
  const atCourseLimit = courses.length >= MAX_COURSES;
  const hasCalendars = subscriptions.length > 0;
  const [isExpanded, setIsExpanded] = useState(false);
  const [openSync, setOpenSync] = useState(false);
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
        className="mt-7 overflow-hidden rounded-2xl border border-[#cdddf4] bg-white"
        aria-label={t(locale, "connect.title")}
        id="connect"
      >
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e7f0ff] text-[#2368c8]">
            <FileUp size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#172b41]">
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
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#cdd9e6] bg-white px-3 text-sm font-semibold text-[#244e7a] transition hover:border-[#9fb7d1]"
          >
            {t(locale, "connect.manage")}
            <ChevronRight size={15} />
          </button>
          {/* Sync lives inside the panel, so the collapsed bar needs its own way
              in — nobody would look for it under a button about calendars. */}
          <button
            type="button"
            onClick={() => {
              setIsExpanded(true);
              setOpenSync(true);
            }}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#cdd9e6] bg-white px-3 text-sm font-semibold text-[#4e647b] transition hover:border-[#9fb7d1] hover:text-[#244e7a]"
          >
            <Smartphone size={15} />
            {t(locale, "sync.button")}
          </button>
        </div>
        <StatusRows error={error} notice={notice} />
      </section>
    );
  }

  return (
    <section
      className="mt-7 overflow-hidden rounded-[24px] border border-[#cdddf4] bg-white shadow-[0_16px_50px_rgba(29,69,116,0.08)]"
      aria-labelledby="connect-title"
      id="connect"
    >
      <div className="flex gap-4 p-5 pb-0 sm:p-6 sm:pb-0">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e7f0ff] text-[#2368c8]">
          <FileUp size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="connect-title" className="font-display text-lg font-semibold">
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
            className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-lg border border-[#cdd9e6] bg-white px-3 text-sm font-semibold text-[#4e647b] transition hover:border-[#9fb7d1] hover:text-[#244e7a]"
          >
            <ChevronUp size={15} />
            {t(locale, "connect.collapse")}
          </button>
        )}
      </div>

      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_1fr] lg:items-start">
        <div>
          <div className="rounded-2xl border-2 border-dashed border-[#b9cfea] bg-[#f7fbff] px-5 py-6 text-center">
            <FileUp size={28} className="mx-auto text-[#2a71d8]" />
            <p className="font-display mt-2 text-base font-semibold text-[#172b41]">
              {t(locale, "file.title")}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--muted)]">
              {t(locale, "file.hint")}
            </p>
            <label
              htmlFor="calendar-files"
              className="mt-3 inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[var(--blue)] px-5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(35,104,200,0.24)] transition hover:bg-[#1857aa]"
            >
              <FileUp size={16} />
              {t(locale, "file.choose")}
            </label>
            <input
              id="calendar-files"
              type="file"
              multiple
              accept=".ics,.ical,.ifb,text/calendar"
              className="sr-only"
              onChange={(event) => {
                void importCalendarFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold text-[#31506f]">
              {t(locale, "connect.shortcutLabel")}
            </p>
            <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={handleImport}>
              <label className="sr-only" htmlFor="calendar-url">
                {t(locale, "connect.inputLabel")}
              </label>
              <input
                id="calendar-url"
                name="calendarUrl"
                type="url"
                inputMode="url"
                autoComplete="off"
                required
                value={calendarUrl}
                onChange={(event) => setCalendarUrl(event.target.value)}
                placeholder={t(locale, "connect.placeholder")}
                className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--line-strong)] bg-[#fbfcfe] px-4 text-sm outline-none transition focus:border-[#2a71d8] focus:ring-4 focus:ring-[#2a71d8]/10"
              />
              {courses.length > 0 && (
                <select
                  aria-label={t(locale, "connect.courseLabel")}
                  value={importCourseId}
                  onChange={(event) => setImportCourseId(event.target.value)}
                  className="h-11 rounded-xl border border-[var(--line-strong)] bg-[#fbfcfe] px-3 text-sm outline-none transition focus:border-[#2a71d8] focus:ring-4 focus:ring-[#2a71d8]/10"
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
                type="submit"
                disabled={isLoading}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#cdd9e6] bg-white px-4 text-sm font-semibold text-[#244e7a] transition hover:border-[#9fb7d1] focus:outline-none focus:ring-4 focus:ring-[#2a71d8]/20 disabled:cursor-wait disabled:opacity-70"
              >
                {isLoading ? (
                  <><LoaderCircle size={17} className="animate-spin" />{t(locale, "connect.importing")}</>
                ) : (
                  <>{t(locale, "connect.importButton")}<ChevronRight size={16} /></>
                )}
              </button>
            </form>

            <div className="mt-2 flex items-start gap-2.5">
              <input
                id="remember-calendar"
                type="checkbox"
                checked={rememberSource}
                onChange={toggleRememberSource}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[#2a71d8]"
              />
              <div className="min-w-0">
                <label
                  htmlFor="remember-calendar"
                  className="text-sm font-semibold text-[#31506f]"
                >
                  {t(locale, "connect.rememberLabel")}
                </label>
                <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">
                  {t(locale, "connect.rememberHint")}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#dbe7f6] bg-[#f7fbff] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6b7f95]">
            {t(locale, "connect.stepsTitle")}
          </p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-[#31506f]">
            <li>{t(locale, "connect.helpStep1")}</li>
            <li>{t(locale, "connect.helpStep2")}</li>
            <li>{t(locale, "connect.helpStep3")}</li>
            <li>{t(locale, "connect.helpStep4")}</li>
            <li>{t(locale, "connect.helpStep5")}</li>
            <li>{t(locale, "connect.helpStep6")}</li>
            <li>{t(locale, "connect.helpStep7")}</li>
          </ol>
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
            {t(locale, "connect.helpNote")}
          </p>
        </div>
      </div>

      {subscriptions.length > 0 && (
        <div className="border-t border-[var(--line)] px-5 py-4 sm:px-7">
          <h3 className="text-sm font-semibold text-[#31506f]">
            {t(locale, "subscriptions.title")}
          </h3>
          <ul className="mt-2 space-y-2">
            {subscriptions.map((subscription) => (
              <li
                key={subscription.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[#fbfcfe] px-3 py-2"
              >
                <span
                  className="min-w-0 flex-1 truncate text-sm font-semibold text-[#172b41]"
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
                    className="h-8 rounded-lg border border-[var(--line-strong)] bg-white px-2.5 text-sm outline-none transition focus:border-[#2a71d8] focus:ring-4 focus:ring-[#2a71d8]/10"
                  >
                    <option value="">{t(locale, "connect.courseNone")}</option>
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.code.trim() || t(locale, "course.untitled")}
                      </option>
                    ))}
                  </select>
                )}
                {subscription.url && (
                  <button
                    type="button"
                    onClick={() => void refreshSubscription(subscription.id)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#cdd9e6] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#4e647b] transition hover:border-[#9fb7d1] hover:text-[#244e7a]"
                  >
                    <RefreshCw size={13} />
                    {t(locale, "subscriptions.refresh")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dropSubscription(subscription.id)}
                  aria-label={t(locale, "subscriptions.removeLabel", {
                    name:
                      subscription.name?.trim() ||
                      t(locale, "subscriptions.unnamed"),
                  })}
                  className="ml-auto grid size-7 shrink-0 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[#fdeae7] hover:text-[#c5402d]"
                >
                  <X size={15} />
                </button>
                {subscription.lastError && (
                  <p className="w-full text-[11px] text-[#a34235]">
                    {subscription.lastError}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {!canAddSubscription && (
            <p className="mt-2 text-xs text-[var(--muted)]">
              {t(locale, "subscriptions.limit", { max: MAX_SUBSCRIPTIONS })}
            </p>
          )}
        </div>
      )}

      {subscriptions.length > 0 && (
        <details
          open={openSync}
          onToggle={(event) => setOpenSync(event.currentTarget.open)}
          className="group border-t border-[var(--line)] px-5 py-3 text-sm sm:px-7"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-[#31506f] [&::-webkit-details-marker]:hidden">
            <ChevronRight size={15} className="shrink-0 text-[#2a71d8] transition group-open:rotate-90" />
            <Smartphone size={15} className="shrink-0 text-[#2a71d8]" />
            {t(locale, "sync.summary")}
          </summary>
          <SyncSection />
        </details>
      )}

      <details className="group border-t border-[var(--line)] px-5 py-3 text-sm sm:px-7">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-[#31506f] [&::-webkit-details-marker]:hidden">
          <ChevronRight size={15} className="shrink-0 text-[#2a71d8] transition group-open:rotate-90" />
          {t(locale, "course.summary")}
          {courses.length > 0 && (
            <span className="rounded-full bg-[#eaf2ff] px-2 py-0.5 text-[11px] font-bold text-[#245ea9]">
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
            className="h-9 w-44 rounded-lg border border-[var(--line-strong)] bg-[#fbfcfe] px-3 text-sm outline-none transition focus:border-[#2a71d8] focus:ring-4 focus:ring-[#2a71d8]/10"
          />
          <select
            aria-label={t(locale, "course.component")}
            value={draftComponent}
            onChange={(event) =>
              setDraftComponent(event.target.value as CourseComponent | "")
            }
            className="h-9 rounded-lg border border-[var(--line-strong)] bg-[#fbfcfe] px-3 text-sm outline-none transition focus:border-[#2a71d8] focus:ring-4 focus:ring-[#2a71d8]/10"
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
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#cdd9e6] bg-white px-3 text-sm font-semibold text-[#244e7a] transition hover:border-[#9fb7d1] disabled:cursor-not-allowed disabled:opacity-50"
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
                className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[#fbfcfe] px-3 py-2"
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
                  className="h-8 w-40 rounded-lg border border-[var(--line-strong)] bg-white px-2.5 text-sm outline-none transition focus:border-[#2a71d8] focus:ring-4 focus:ring-[#2a71d8]/10"
                />
                <select
                  aria-label={t(locale, "course.component")}
                  value={course.component ?? ""}
                  onChange={(event) =>
                    editCourse(course.id, {
                      component: (event.target.value || null) as CourseComponent | null,
                    })
                  }
                  className="h-8 rounded-lg border border-[var(--line-strong)] bg-white px-2.5 text-sm outline-none transition focus:border-[#2a71d8] focus:ring-4 focus:ring-[#2a71d8]/10"
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
                      : "border-[#dbe3ec] bg-white text-[var(--muted)] hover:border-[#9fb7d1] hover:text-[#244e7a]"
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
                  className="ml-auto grid size-7 shrink-0 place-items-center rounded-lg text-[var(--muted)] transition hover:bg-[#fdeae7] hover:text-[#c5402d]"
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
