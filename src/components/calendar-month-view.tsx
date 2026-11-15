"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, GraduationCap, Plus, RotateCcw, X } from "lucide-react";

import { EventForm, toTimeInput, type EventFormTarget } from "@/components/calendar-event-form";
import { useCalendar } from "@/components/calendar-provider";
import { ListSkeleton } from "@/components/list-skeleton";
import { useAcademicCalendar } from "@/components/use-academic-calendar";
import { academicByDay, type AcademicEvent } from "@/lib/academic-calendar";
import { formatDate } from "@/lib/format-date";
import { chipStyle } from "@/lib/course-colors";
import { isCustomEventId } from "@/lib/custom-events";
import { addDays, localDay, startOfLocalDay, taskDate } from "@/lib/date-utils";
import { t, type Locale } from "@/lib/i18n";
import type { CalendarTask } from "@/lib/calendar-types";

const longDate = (date: Date, locale: Locale) => formatDate(date, locale, { weekday: "long" });

const MAX_VISIBLE_PER_DAY = 3;
const MAX_DOTS = 3;

/**
 * A month grid for the calendar page, editable in place.
 *
 * Imported events are corrected through the overlay (`event-overlay.ts`), so
 * the student's own calendar never just loses a change to the next
 * collection; events they add themselves are plain, owned records
 * (`custom-events.ts`). Both end up in the same `tasks` list, so this
 * component only needs to know an id's namespace to decide which actions to
 * offer, through `isEventEdited` and the `custom-` prefix.
 */
/**
 * A school date's label in a day cell: loud for what a term is planned around, quiet for the rest.
 * One that runs over several days is named on its first day and on each Sunday it runs through;
 * on the days between it is a thin bar, so a three-week grading period does not fill three weeks
 * of cells with the same words.
 */
function SchoolDateLabel({ event, continued }: { event: AcademicEvent; continued: boolean }) {
  if (continued) {
    return (
      <span
        className={`block h-1 rounded-full ${event.importance === "major" ? "bg-[var(--warning)]/50" : "bg-[var(--line-strong)]"}`}
        title={event.detail}
        data-school-date="continued"
      />
    );
  }
  return event.importance === "major" ? (
    <span
      className="flex w-full items-center gap-1 truncate rounded bg-[var(--warning-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--warning)]"
      title={event.detail}
      data-school-date="major"
    >
      <GraduationCap size={12} className="shrink-0" aria-hidden />
      <span className="truncate">{event.title}</span>
    </span>
  ) : (
    <span className="flex w-full items-center gap-1 truncate px-1.5 text-[10px] text-[var(--muted)]" title={event.detail} data-school-date="minor">
      <GraduationCap size={11} className="shrink-0" aria-hidden />
      <span className="truncate">{event.title}</span>
    </span>
  );
}

type CalendarMonthProps = {
  /** Where UConn's academic calendar comes from; tests pass their own. */
  fetchAcademic?: (input: string, init?: RequestInit) => Promise<Response>;
};

export function CalendarMonthView(props: CalendarMonthProps) {
  const { locale, calendarReady } = useCalendar();
  return calendarReady
    ? <CalendarMonthContents {...props} />
    : <ListSkeleton label={t(locale, "common.loading")} />;
}

function CalendarMonthContents({ fetchAcademic }: CalendarMonthProps) {
  const {
    locale,
    tasks,
    now,
    restoreAllEvents,
    hasEventEdits,
    isEventEdited,
    courseLabelFor,
    courseColorFor,
  } = useCalendar();
  const colorOf = (task: CalendarTask) => courseColorFor(courseLabelFor(task)?.code);
  const [cursor, setCursor] = useState(() => startOfLocalDay(now));
  const [editing, setEditing] = useState<EventFormTarget | null>(null);
  const [dayDetail, setDayDetail] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const academic = useAcademicCalendar(fetchAcademic);
  const schoolDays = useMemo(() => academicByDay(academic), [academic]);

  const monthLabel = new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    month: "long",
    year: "numeric",
  }).format(cursor);

  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", { weekday: "short" });
    const sunday = addDays(startOfLocalDay(now), -now.getDay());
    return Array.from({ length: 7 }, (_, index) => formatter.format(addDays(sunday, index)));
  }, [locale, now]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const task of tasks) {
      const date = taskDate(task);
      if (Number.isNaN(date.valueOf())) continue;
      const key = localDay(date);
      const list = map.get(key);
      if (list) list.push(task);
      else map.set(key, [task]);
    }
    for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return map;
  }, [tasks]);

  // `cursor` is today's date on first mount, not necessarily the 1st — the
  // offset has to be measured from the month's own first day, never from
  // whatever `cursor` happens to be, or the grid comes out shifted until the
  // next navigation first lands it on a 1st.
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const todayKey = localDay(startOfLocalDay(now));


  function openAdd(date: Date) {
    setEditing({ mode: "add", date });
    setFormError(null);
  }

  function openEdit(task: CalendarTask) {
    setEditing({ mode: "edit", task });
    setFormError(null);
  }

  return (
    <section className="card mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-3 sm:px-5">
        <h2 className="font-display min-w-0 flex-1 text-lg font-semibold">{monthLabel}</h2>
        <button
          type="button"
          onClick={() => setCursor(startOfLocalDay(now))}
          className="btn btn-quiet"
        >
          {t(locale, "calendar.today")}
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t(locale, "calendar.prevMonth")}
            onClick={() => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
            className="btn btn-quiet w-8 px-0"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            aria-label={t(locale, "calendar.nextMonth")}
            onClick={() => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
            className="btn btn-quiet w-8 px-0"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        {/* Only when there is something to undo. */}
        {hasEventEdits ? (
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(t(locale, "calendar.restoreAllConfirm"))) return;
              try {
                restoreAllEvents();
                setFormError(null);
              } catch (error) {
                setFormError(error instanceof Error ? error.message : t(locale, "errors.saveFailed"));
              }
            }}
            className="btn btn-quiet text-xs text-[var(--muted)]"
          >
            <RotateCcw size={13} />
            {t(locale, "calendar.restoreAll")}
          </button>
        ) : null}
      </div>

      {formError && !editing ? <p role="alert" className="px-4 py-2 text-sm text-[var(--warning)]">{formError}</p> : null}

      <div className="grid grid-cols-7 border-b border-[var(--line)] bg-[var(--canvas)] text-[11px] font-medium text-[var(--muted)]">
        {weekdayLabels.map((label) => (
          <div key={label} className="px-2 py-2 sm:px-3">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((date) => {
          const key = localDay(date);
          const inMonth = date.getMonth() === cursor.getMonth();
          const events = eventsByDay.get(key) ?? [];
          const visible = events.slice(0, MAX_VISIBLE_PER_DAY);
          const hidden = events.length - visible.length;
          const school = schoolDays.get(key) ?? [];
          // A break, finals or a deadline colours the whole day, so it shows even on a phone.
          const schoolMajor = school.some((event) => event.importance === "major");

          return (
            <div
              key={key}
              data-day={key}
              data-school={schoolMajor ? "major" : undefined}
              className={`group/day min-h-[60px] border-b border-r border-[var(--line)] p-1 [&:nth-child(7n)]:border-r-0 sm:min-h-[116px] sm:p-1.5 ${
                inMonth ? "" : "bg-[var(--canvas)]"
              } ${schoolMajor ? "shadow-[inset_0_2px_0_var(--warning)]" : ""}`}
            >
              <div className="flex items-center justify-between">
                {/* The number itself opens the full day, titles and all — the
                    one dependable way in once a narrow phone has truncated
                    every pill below it to a few characters. */}
                <button
                  type="button"
                  onClick={() => setDayDetail(key)}
                  aria-label={t(locale, "calendar.dayHeading", { date: longDate(date, locale) })}
                  className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold transition ${
                    key === todayKey
                      ? "bg-[var(--blue)] text-white"
                      : inMonth
                        ? "text-[var(--ink)] hover:bg-[var(--subtle)]"
                        : "text-[var(--muted)] opacity-60 hover:bg-[var(--subtle)]"
                  }`}
                >
                  {date.getDate()}
                </button>
                <button
                  type="button"
                  aria-label={t(locale, "calendar.addEvent")}
                  onClick={() => openAdd(date)}
                  className="grid size-5 shrink-0 place-items-center rounded text-[var(--muted)] transition [@media(hover:hover)]:opacity-0 group-hover/day:opacity-100 hover:bg-[var(--subtle)] hover:text-[var(--blue)] focus-visible:opacity-100"
                >
                  <Plus size={13} />
                </button>
              </div>

              {/* A phone has no room for titles in a seven-column grid, so
                  there it shows one dot per event and the whole cell opens
                  the day. From `sm` up the titles are shown in place. */}
              {events.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDayDetail(key)}
                  aria-hidden="true"
                  tabIndex={-1}
                  className="mt-1 flex w-full flex-wrap items-center justify-center gap-0.5 sm:hidden"
                >
                  {events.slice(0, MAX_DOTS).map((task) => (
                    <span
                      key={task.id}
                      className="size-1.5 rounded-full bg-[var(--blue)]"
                      style={colorOf(task) ? { backgroundColor: colorOf(task)! } : undefined}
                    />
                  ))}
                </button>
              )}

              <div className="mt-1 hidden space-y-1 sm:block">
                {school.map((event) => (
                  <SchoolDateLabel key={event.id} event={event} continued={event.start < key && date.getDay() !== 0} />
                ))}
                {visible.map((task) => {
                  const edited = !isCustomEventId(task.id) && isEventEdited(task.id);
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => openEdit(task)}
                      className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium bg-[var(--accent-soft)] text-[var(--accent-ink)] transition hover:brightness-95"
                      style={colorOf(task) ? chipStyle(colorOf(task)!) : undefined}
                      data-course-color={colorOf(task) ?? undefined}
                      title={task.title}
                    >
                      {!task.allDay && (
                        <span className="tabular-nums opacity-70">{toTimeInput(new Date(task.start))} </span>
                      )}
                      {task.title}
                      {edited && <span className="ml-1 text-[var(--warning)]">•</span>}
                    </button>
                  );
                })}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setDayDetail(key)}
                    className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-[var(--muted)] hover:text-[var(--ink)]"
                  >
                    {t(locale, "calendar.moreEvents", { count: hidden })}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {dayDetail &&
        (() => {
          const date = days.find((entry) => localDay(entry) === dayDetail);
          if (!date) return null;
          const events = eventsByDay.get(dayDetail) ?? [];
          const school = schoolDays.get(dayDetail) ?? [];
          return (
            <div
              className="scrim fixed inset-0 z-50 flex items-end justify-center p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
              role="dialog"
              aria-modal="true"
              aria-label={longDate(date, locale)}
            >
              <div className="rise-in max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-2xl sm:rounded-xl">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-base font-semibold">{longDate(date, locale)}</h3>
                  <button
                    type="button"
                    aria-label={t(locale, "calendar.cancel")}
                    onClick={() => setDayDetail(null)}
                    className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--subtle)]"
                  >
                    <X size={16} />
                  </button>
                </div>

                {school.length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    {school.map((event) => (
                      <div
                        key={event.id}
                        className={`rounded-lg px-3 py-2 text-sm ${
                          event.importance === "major"
                            ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                            : "bg-[var(--subtle)] text-[var(--ink)]"
                        }`}
                      >
                        <p className="flex items-center gap-1.5 font-semibold">
                          <GraduationCap size={14} className="shrink-0" aria-hidden />
                          {event.title}
                        </p>
                        {event.detail !== event.title ? <p className="mt-1 text-xs">{event.detail}</p> : null}
                        <p className="mt-1 text-[11px] opacity-80">{t(locale, "calendar.schoolSource", { term: event.term })}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 space-y-1.5">
                  {events.length === 0 && school.length === 0 && (
                    <p className="text-sm text-[var(--muted)]">{t(locale, "calendar.noEvents")}</p>
                  )}
                  {events.map((task) => {
                    const edited = !isCustomEventId(task.id) && isEventEdited(task.id);
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => {
                          setDayDetail(null);
                          openEdit(task);
                        }}
                        className="flex w-full items-start gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-left text-sm transition hover:bg-[var(--subtle)]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">
                            {task.title}
                            {edited && <span className="ml-1 text-[var(--warning)]">•</span>}
                          </span>
                          {task.course && <span className="block text-xs text-[var(--muted)]">{task.course}</span>}
                        </span>
                        {!task.allDay && (
                          <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{toTimeInput(new Date(task.start))}</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setDayDetail(null);
                    openAdd(date);
                  }}
                  className="btn btn-quiet mt-4"
                >
                  <Plus size={15} />
                  {t(locale, "calendar.addEvent")}
                </button>
              </div>
            </div>
          );
        })()}

      {editing ? (
        <EventForm
          key={editing.mode === "edit" ? editing.task.id : "add:" + localDay(editing.date)}
          target={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
