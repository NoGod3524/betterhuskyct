"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { t } from "@/lib/i18n";
import { localDay } from "@/lib/date-utils";
import { dueInstant } from "@/lib/quick-add";

/**
 * A to-do added from the overview, with a title, a day and, if it has one, a time. It is the
 * calendar page's own "add event" with the rest of that form left out: it is stored the same way,
 * so it shows on both pages and is edited or removed on the calendar page.
 */
export function QuickAdd() {
  const { locale, now, addCustomEvent } = useCalendar();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState(false);

  // Read when it is opened, not when the page renders: the server does not know the reader's day.
  function show() {
    setDate(localDay(now));
    setOpen(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError(true);
      return;
    }
    const allDay = time === "";
    addCustomEvent({
      title: title.trim(),
      course: null,
      start: dueInstant(date, time),
      end: null,
      allDay,
      location: null,
      note: null,
    });
    setTitle("");
    setTime("");
    setError(false);
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" onClick={show} className="btn btn-quiet h-7 px-2.5 text-xs">
        <Plus size={13} />
        {t(locale, "quickAdd.open")}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rise-in mt-3 flex w-full flex-wrap items-end gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm">
      <label className="grid min-w-[12rem] flex-1 gap-1">
        <span className="text-xs text-[var(--muted)]">{t(locale, "quickAdd.title")}</span>
        <input
          autoFocus
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(false);
          }}
          aria-invalid={error}
          className="h-9 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-[var(--muted)]">{t(locale, "quickAdd.date")}</span>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required className="h-9 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5" />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-[var(--muted)]">{t(locale, "quickAdd.time")}</span>
        <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="h-9 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5" />
      </label>
      <button type="submit" className="btn btn-primary h-9">
        {t(locale, "quickAdd.add")}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="btn btn-quiet h-9">
        {t(locale, "quickAdd.cancel")}
      </button>
      {error ? (
        <p role="alert" className="w-full text-xs text-[var(--warning)]">
          {t(locale, "calendar.emptyTitleError")}
        </p>
      ) : null}
    </form>
  );
}
