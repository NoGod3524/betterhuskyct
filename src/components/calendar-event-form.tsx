"use client";

import { useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import type { CalendarTask } from "@/lib/calendar-types";
import { isCustomEventId } from "@/lib/custom-events";
import { localDay } from "@/lib/date-utils";
import type { EventEdit } from "@/lib/event-overlay";
import { t } from "@/lib/i18n";

const pad = (value: number) => String(value).padStart(2, "0");
export const toTimeInput = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
function localInstant(dateInput: string, timeInput: string): string {
  const [year, month, day] = dateInput.split("-").map(Number);
  const [hour, minute] = (timeInput || "00:00").split(":").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1, hour || 0, minute || 0).toISOString();
}

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
    date: localDay(date),
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
    // An all-day event is on its day as written, not on the day its start falls on in this zone.
    date: task.allDay && task.dateKey ? task.dateKey : localDay(start),
    startTime: toTimeInput(start),
    endTime: task.end ? toTimeInput(new Date(task.end)) : "",
    allDay: task.allDay,
    location: task.location ?? "",
    note: note ?? "",
  };
}

function fieldClass() {
  return "h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-4 focus:ring-[var(--blue)]/10";
}

/** What the form is for: a new event on a day, or a change to one already on the calendar. */
export type EventFormTarget = { mode: "add"; date: Date } | { mode: "edit"; task: CalendarTask };

/**
 * The form for one event on the calendar page. An event the student added is edited in place; a
 * correction to an imported one goes into the overlay, so the next collection still finds it.
 */
export function EventForm({ target, onClose }: { target: EventFormTarget; onClose: () => void }) {
  const { locale, editEvent, addCustomEvent, restoreEvent, deleteEvent, isEventEdited, eventNoteFor } = useCalendar();
  const [draft, setDraft] = useState<Draft>(() =>
    target.mode === "add" ? emptyDraft(target.date) : draftFrom(target.task, eventNoteFor(target.task.id)),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const draftFor = target.mode === "edit" ? { mode: "edit" as const, taskId: target.task.id } : target;
  const closeDraft = onClose;

  function saveDraftChange(change: () => void) {
    try { change(); closeDraft(); }
    catch (error) { setFormError(error instanceof Error ? error.message : t(locale, "errors.saveFailed")); }
  }

  function saveDraft() {
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
        dateKey: fields.allDay ? draft.date : null,
        end: fields.end,
        allDay: fields.allDay,
        location: fields.location,
        note: fields.note ?? "",
      };
      saveDraftChange(() => editEvent(draftFor.taskId, edit));
    } else {
      saveDraftChange(() => { addCustomEvent(fields); });
    }
  }

  const editingTaskId = draftFor?.mode === "edit" ? draftFor.taskId : null;
  const editingIsCustom = editingTaskId ? isCustomEventId(editingTaskId) : false;
  const editingIsEdited = editingTaskId ? isEventEdited(editingTaskId) : false;

  return (
    <div
      className="scrim fixed inset-0 z-50 flex items-end justify-center p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={draftFor.mode === "add" ? t(locale, "calendar.newEvent") : t(locale, "calendar.editEvent")}
    >
      <div className="rise-in max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-2xl sm:rounded-xl">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">
            {draftFor.mode === "add" ? t(locale, "calendar.newEvent") : t(locale, "calendar.editEvent")}
          </h3>
          <button
            type="button"
            aria-label={t(locale, "calendar.cancel")}
            onClick={closeDraft}
            className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--subtle)]"
          >
            <X size={16} />
          </button>
        </div>

        {editingIsEdited && !editingIsCustom && (
          <p className="mt-2 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
            {t(locale, "calendar.editedBadge")}
          </p>
        )}

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-xs font-medium text-[var(--muted)]">
            {t(locale, "calendar.fieldTitle")}
            <input
              className={fieldClass()}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              autoFocus
            />
          </label>

          <label className="grid gap-1 text-xs font-medium text-[var(--muted)]">
            {t(locale, "calendar.fieldCourse")}
            <input
              className={fieldClass()}
              value={draft.course}
              onChange={(event) => setDraft({ ...draft, course: event.target.value })}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs font-medium text-[var(--muted)]">
              {t(locale, "calendar.fieldDate")}
              <input
                type="date"
                className={fieldClass()}
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
              />
            </label>
            <label className="flex items-end gap-2 pb-2 text-xs font-medium text-[var(--muted)]">
              <input
                type="checkbox"
                className="size-4 accent-[var(--blue)]"
                checked={draft.allDay}
                onChange={(event) => setDraft({ ...draft, allDay: event.target.checked })}
              />
              {t(locale, "calendar.fieldAllDay")}
            </label>
          </div>

          {!draft.allDay && (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs font-medium text-[var(--muted)]">
                {t(locale, "calendar.fieldStartTime")}
                <input
                  type="time"
                  className={fieldClass()}
                  value={draft.startTime}
                  onChange={(event) => setDraft({ ...draft, startTime: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-[var(--muted)]">
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

          <label className="grid gap-1 text-xs font-medium text-[var(--muted)]">
            {t(locale, "calendar.fieldLocation")}
            <input
              className={fieldClass()}
              value={draft.location}
              onChange={(event) => setDraft({ ...draft, location: event.target.value })}
            />
          </label>

          <label className="grid gap-1 text-xs font-medium text-[var(--muted)]">
            {t(locale, "calendar.fieldNote")}
            <textarea
              className="min-h-[70px] w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none transition focus:border-[var(--blue)] focus:ring-4 focus:ring-[var(--blue)]/10"
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>

          {formError && <p role="alert" className="text-xs text-[var(--danger)]">{formError}</p>}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={saveDraft}
            className="btn btn-primary h-9 px-4"
          >
            {t(locale, "calendar.save")}
          </button>
          <button
            type="button"
            onClick={closeDraft}
            className="btn btn-quiet h-9 px-4"
          >
            {t(locale, "calendar.cancel")}
          </button>

          {editingTaskId && (
            <div className="ml-auto flex items-center gap-2">
              {editingIsEdited && !editingIsCustom && (
                <button
                  type="button"
                  onClick={() => {
                    saveDraftChange(() => restoreEvent(editingTaskId));
                  }}
                  className="btn btn-quiet h-9 text-xs"
                >
                  <RotateCcw size={13} />
                  {t(locale, "calendar.restoreOriginal")}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  saveDraftChange(() => deleteEvent(editingTaskId));
                }}
                className="btn btn-quiet h-9 text-xs text-[var(--danger)] hover:!bg-[var(--danger-soft)]"
              >
                <Trash2 size={13} />
                {t(locale, "calendar.delete")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
