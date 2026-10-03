"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, RotateCcw, Trash2, X } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { isCustomEventId } from "@/lib/custom-events";
import { addDays, startOfLocalDay, taskDate } from "@/lib/date-utils";
import { t, type Locale } from "@/lib/i18n";
import type { CalendarTask } from "@/lib/calendar-types";
import type { EventEdit } from "@/lib/event-overlay";

const pad = (value: number) => String(value).padStart(2, "0");
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const toDateInput = (date: Date) => dayKey(date);
const toTimeInput = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const longDate = (date: Date, locale: Locale) =>
  new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", { weekday: "long", month: "long", day: "numeric" }).format(date);

function localInstant(dateInput: string, timeInput: string): string {
  const [year, month, day] = dateInput.split("-").map(Number);
  const [hour, minute] = (timeInput || "00:00").split(":").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1, hour || 0, minute || 0).toISOString();
}

const MAX_VISIBLE_PER_DAY = 3;
const MAX_DOTS = 3;

type DraftKind = { mode: "add"; date: Date } | { mode: "edit"; taskId: string };

type Draft = {
  title: string;
  course: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string;
  note: string;
};

function emptyDraft(date: Date): Draft {
  return {
    title: "",
    course: "",
    date: toDateInput(date),
    startTime: "09:00",
    endTime: "",
    allDay: false,
    location: "",
    note: "",
  };
}

function draftFrom(task: CalendarTask, note: string | null): Draft {
  const start = new Date(task.start);
  return {
    title: task.title,
    course: task.course ?? "",
    date: toDateInput(start),
    startTime: toTimeInput(start),
    endTime: task.end ? toTimeInput(new Date(task.end)) : "",
    allDay: task.allDay,
    location: task.location ?? "",
    note: note ?? "",
  };
}

function fieldClass() {
  return "h-10 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--c-fbfcfe)] px-3 text-sm outline-none transition focus:border-[var(--c-2a71d8)] focus:ring-4 focus:ring-[var(--c-2a71d8)]/10";
}

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
export function CalendarMonthView() {
  const {
    locale,
    tasks,
    now,
    editEvent,
    deleteEvent,
    restoreEvent,
    restoreAllEvents,
    eventNoteFor,
    isEventEdited,
    addCustomEvent,
  } = useCalendar();
  const [cursor, setCursor] = useState(() => startOfLocalDay(now));
  const [draftFor, setDraftFor] = useState<DraftKind | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dayDetail, setDayDetail] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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
      const key = dayKey(date);
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
  const todayKey = dayKey(startOfLocalDay(now));

  function openAdd(date: Date) {
    setDraftFor({ mode: "add", date });
    setDraft(emptyDraft(date));
    setFormError(null);
  }

  function openEdit(task: CalendarTask) {
    setDraftFor({ mode: "edit", taskId: task.id });
    setDraft(draftFrom(task, eventNoteFor(task.id)));
    setFormError(null);
  }

  function closeDraft() {
    setDraftFor(null);
    setDraft(null);
    setFormError(null);
  }

  function saveDraft() {
    if (!draft || !draftFor) return;
    if (!draft.title.trim()) {
      setFormError(t(locale, "calendar.emptyTitleError"));
      return;
    }
    const start = localInstant(draft.date, draft.allDay ? "00:00" : draft.startTime);
    const end = !draft.allDay && draft.endTime ? localInstant(draft.date, draft.endTime) : null;
    const fields = {
      title: draft.title.trim(),
      course: draft.course.trim() || null,
      start,
      end,
      allDay: draft.allDay,
      location: draft.location.trim() || null,
      note: draft.note.trim() || null,
    };

    if (draftFor.mode === "edit") {
      const edit: EventEdit = {
        title: fields.title,
        start: fields.start,
        end: fields.end,
        allDay: fields.allDay,
        location: fields.location,
        note: fields.note ?? "",
      };
      editEvent(draftFor.taskId, edit);
    } else {
      addCustomEvent(fields);
    }
    closeDraft();
  }

  const editingTaskId = draftFor?.mode === "edit" ? draftFor.taskId : null;
  const editingIsCustom = editingTaskId ? isCustomEventId(editingTaskId) : false;
  const editingIsEdited = editingTaskId ? isEventEdited(editingTaskId) : false;

  return (
    <section className="mt-6 overflow-hidden rounded-[24px] border border-[var(--c-cdddf4)] bg-[var(--surface)] shadow-[0_16px_50px_rgba(29,69,116,0.08)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] px-5 py-4 sm:px-6">
        <h2 className="font-display min-w-0 flex-1 text-lg font-semibold text-[var(--c-172b41)]">{monthLabel}</h2>
        <button
          type="button"
          onClick={() => setCursor(startOfLocalDay(now))}
          className="inline-flex h-9 items-center rounded-lg border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--c-244e7a)] transition hover:border-[var(--c-9fb7d1)]"
        >
          {t(locale, "calendar.today")}
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t(locale, "calendar.prevMonth")}
            onClick={() => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
            className="grid size-9 place-items-center rounded-lg border border-[var(--c-cdd9e6)] bg-[var(--surface)] text-[var(--c-244e7a)] transition hover:border-[var(--c-9fb7d1)]"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            aria-label={t(locale, "calendar.nextMonth")}
            onClick={() => setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
            className="grid size-9 place-items-center rounded-lg border border-[var(--c-cdd9e6)] bg-[var(--surface)] text-[var(--c-244e7a)] transition hover:border-[var(--c-9fb7d1)]"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t(locale, "calendar.restoreAllConfirm"))) restoreAllEvents();
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--muted)] transition hover:border-[var(--c-9fb7d1)] hover:text-[var(--c-244e7a)]"
        >
          <RotateCcw size={13} />
          {t(locale, "calendar.restoreAll")}
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-[var(--line)] text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        {weekdayLabels.map((label) => (
          <div key={label} className="py-2">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((date) => {
          const key = dayKey(date);
          const inMonth = date.getMonth() === cursor.getMonth();
          const events = eventsByDay.get(key) ?? [];
          const visible = events.slice(0, MAX_VISIBLE_PER_DAY);
          const hidden = events.length - visible.length;

          return (
            <div
              key={key}
              className={`min-h-[60px] border-b border-r border-[var(--line)] p-1 last:border-r-0 sm:min-h-[120px] sm:p-2 ${inMonth ? "" : "bg-[var(--c-f7fbff)]"}`}
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
                        ? "text-[var(--c-172b41)] hover:bg-[var(--c-eaf2ff)]"
                        : "text-[var(--muted)] hover:bg-[var(--c-eaf2ff)]"
                  }`}
                >
                  {date.getDate()}
                </button>
                <button
                  type="button"
                  aria-label={t(locale, "calendar.addEvent")}
                  onClick={() => openAdd(date)}
                  className="grid size-5 shrink-0 place-items-center rounded text-[var(--muted)] transition hover:bg-[var(--c-eaf2ff)] hover:text-[var(--c-2368c8)]"
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
                    <span key={task.id} className="size-1.5 rounded-full bg-[var(--c-2a71d8)]" />
                  ))}
                </button>
              )}

              <div className="mt-1 hidden space-y-1 sm:block">
                {visible.map((task) => {
                  const edited = !isCustomEventId(task.id) && isEventEdited(task.id);
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => openEdit(task)}
                      className="block w-full truncate rounded-md bg-[var(--c-eaf2ff)] px-1.5 py-0.5 text-left text-[11px] font-medium text-[var(--c-245ea9)] transition hover:bg-[var(--c-cdddf4)]"
                      title={task.title}
                    >
                      {!task.allDay && (
                        <span className="text-[var(--c-6b7f95)]">{toTimeInput(new Date(task.start))} </span>
                      )}
                      {task.title}
                      {edited && <span className="ml-1 text-[var(--c-8a5a12)]">•</span>}
                    </button>
                  );
                })}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setDayDetail(key)}
                    className="block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--c-244e7a)]"
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
          const date = days.find((entry) => dayKey(entry) === dayDetail);
          if (!date) return null;
          const events = eventsByDay.get(dayDetail) ?? [];
          return (
            <div
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
              role="dialog"
              aria-modal="true"
              aria-label={longDate(date, locale)}
            >
              <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-5 shadow-2xl sm:rounded-2xl sm:p-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-base font-semibold text-[var(--c-172b41)]">{longDate(date, locale)}</h3>
                  <button
                    type="button"
                    aria-label={t(locale, "calendar.cancel")}
                    onClick={() => setDayDetail(null)}
                    className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--c-eef2f6)]"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="mt-3 space-y-1.5">
                  {events.length === 0 && <p className="text-sm text-[var(--muted)]">{t(locale, "calendar.noEvents")}</p>}
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
                        className="flex w-full items-start gap-2 rounded-xl border border-[var(--line)] bg-[var(--c-fbfcfe)] px-3 py-2 text-left text-sm transition hover:border-[var(--c-9fb7d1)]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-[var(--c-172b41)]">
                            {task.title}
                            {edited && <span className="ml-1 text-[var(--c-8a5a12)]">•</span>}
                          </span>
                          {task.course && <span className="block text-xs text-[var(--muted)]">{task.course}</span>}
                        </span>
                        {!task.allDay && (
                          <span className="shrink-0 text-xs text-[var(--c-6b7f95)]">{toTimeInput(new Date(task.start))}</span>
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
                  className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--c-244e7a)] transition hover:border-[var(--c-9fb7d1)]"
                >
                  <Plus size={15} />
                  {t(locale, "calendar.addEvent")}
                </button>
              </div>
            </div>
          );
        })()}

      {draft && draftFor && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={draftFor.mode === "add" ? t(locale, "calendar.newEvent") : t(locale, "calendar.editEvent")}
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-5 shadow-2xl sm:rounded-2xl sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[var(--c-172b41)]">
                {draftFor.mode === "add" ? t(locale, "calendar.newEvent") : t(locale, "calendar.editEvent")}
              </h3>
              <button
                type="button"
                aria-label={t(locale, "calendar.cancel")}
                onClick={closeDraft}
                className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--c-eef2f6)]"
              >
                <X size={16} />
              </button>
            </div>

            {editingIsEdited && !editingIsCustom && (
              <p className="mt-2 rounded-lg bg-[var(--c-fff0d9)] px-3 py-2 text-xs text-[var(--c-8a5a12)]">
                {t(locale, "calendar.editedBadge")}
              </p>
            )}

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-[var(--c-31506f)]">
                {t(locale, "calendar.fieldTitle")}
                <input
                  className={fieldClass()}
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  autoFocus
                />
              </label>

              <label className="grid gap-1 text-xs font-semibold text-[var(--c-31506f)]">
                {t(locale, "calendar.fieldCourse")}
                <input
                  className={fieldClass()}
                  value={draft.course}
                  onChange={(event) => setDraft({ ...draft, course: event.target.value })}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-xs font-semibold text-[var(--c-31506f)]">
                  {t(locale, "calendar.fieldDate")}
                  <input
                    type="date"
                    className={fieldClass()}
                    value={draft.date}
                    onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                  />
                </label>
                <label className="flex items-end gap-2 pb-1.5 text-xs font-semibold text-[var(--c-31506f)]">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--c-2a71d8)]"
                    checked={draft.allDay}
                    onChange={(event) => setDraft({ ...draft, allDay: event.target.checked })}
                  />
                  {t(locale, "calendar.fieldAllDay")}
                </label>
              </div>

              {!draft.allDay && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1 text-xs font-semibold text-[var(--c-31506f)]">
                    {t(locale, "calendar.fieldStartTime")}
                    <input
                      type="time"
                      className={fieldClass()}
                      value={draft.startTime}
                      onChange={(event) => setDraft({ ...draft, startTime: event.target.value })}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-[var(--c-31506f)]">
                    {t(locale, "calendar.fieldEndTime")}
                    <input
                      type="time"
                      className={fieldClass()}
                      value={draft.endTime}
                      onChange={(event) => setDraft({ ...draft, endTime: event.target.value })}
                    />
                  </label>
                </div>
              )}

              <label className="grid gap-1 text-xs font-semibold text-[var(--c-31506f)]">
                {t(locale, "calendar.fieldLocation")}
                <input
                  className={fieldClass()}
                  value={draft.location}
                  onChange={(event) => setDraft({ ...draft, location: event.target.value })}
                />
              </label>

              <label className="grid gap-1 text-xs font-semibold text-[var(--c-31506f)]">
                {t(locale, "calendar.fieldNote")}
                <textarea
                  className="min-h-[70px] w-full rounded-lg border border-[var(--line-strong)] bg-[var(--c-fbfcfe)] px-3 py-2 text-sm outline-none transition focus:border-[var(--c-2a71d8)] focus:ring-4 focus:ring-[var(--c-2a71d8)]/10"
                  value={draft.note}
                  onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                />
              </label>

              {formError && <p className="text-xs text-[var(--c-c5402d)]">{formError}</p>}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={saveDraft}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--blue)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(35,104,200,0.24)] transition hover:bg-[var(--c-1857aa)]"
              >
                {t(locale, "calendar.save")}
              </button>
              <button
                type="button"
                onClick={closeDraft}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--c-244e7a)] transition hover:border-[var(--c-9fb7d1)]"
              >
                {t(locale, "calendar.cancel")}
              </button>

              {editingTaskId && (
                <div className="ml-auto flex items-center gap-2">
                  {editingIsEdited && !editingIsCustom && (
                    <button
                      type="button"
                      onClick={() => {
                        restoreEvent(editingTaskId);
                        closeDraft();
                      }}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--c-4e647b)] transition hover:border-[var(--c-9fb7d1)] hover:text-[var(--c-244e7a)]"
                    >
                      <RotateCcw size={13} />
                      {t(locale, "calendar.restoreOriginal")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      deleteEvent(editingTaskId);
                      closeDraft();
                    }}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--c-f3cec8)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--c-9f3527)] transition hover:bg-[var(--c-fff6f4)]"
                  >
                    <Trash2 size={13} />
                    {t(locale, "calendar.delete")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
