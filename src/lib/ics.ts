import { isDeadline, type CalendarTask } from "./calendar-types.ts";

/**
 * The open deadlines as an iCalendar file, for the phone's or computer's own calendar app.
 *
 * The app's reminders only fire while BetterHuskyCT is open; a calendar app reminds with the app
 * closed. Each deadline is a short event that ends when the work is due, with two alarms. Its UID
 * is the helper's source id, so importing a newer file updates a rescheduled deadline instead of
 * adding it twice (where the calendar app honours UIDs on import, as Apple Calendar and Outlook do).
 * Other tasks keep their own ids: historical feeds may contain independent recurring instances.
 *
 * Nothing leaves the device: the file is made here and downloaded.
 */

/** How long before a timed deadline the event starts, so it shows as a block ending at the due time. */
const LEAD_MINUTES = 30;

/** The alarms: a day before, and two hours before. An all-day deadline is reminded at 9:00 the day before. */
const TIMED_ALARMS = ["-P1D", "-PT2H"];
const ALL_DAY_ALARMS = ["-PT15H"];

/** Text as iCalendar wants it: backslash, semicolon, comma and line breaks escaped. */
export function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets are folded: a line break and a space, never inside a character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // The first line may hold 75 octets; each continuation starts with a space, so 74 more.
    if (size + bytes > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 20261013T235900Z */
function utcStamp(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** 2026-10-13 -> 20261013, and the day after. */
function dateValue(key: string): string {
  return key.replace(/-/g, "");
}
function nextDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
}

/** The deadlines worth a reminder: not a class, not ticked off, not already past. */
export function deadlinesToRemind(tasks: CalendarTask[], done: Set<string>, now: Date): CalendarTask[] {
  return tasks.filter((task) => {
    if (!isDeadline(task) || done.has(task.id)) return false;
    if (task.allDay && task.dateKey) {
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      return task.dateKey >= today;
    }
    const due = Date.parse(task.start);
    return !Number.isNaN(due) && due > now.valueOf();
  });
}

export function tasksToIcs(tasks: CalendarTask[], now: Date): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BetterHuskyCT//Deadlines//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:BetterHuskyCT deadlines"];
  for (const task of tasks) {
    const summary = task.course ? `Due: ${task.title} (${task.course})` : `Due: ${task.title}`;
    // Helper source ids never contain a colon; the dated suffix can outlive a local time edit.
    const uid = /^huskyct-(todo|calendar)-/.test(task.id) ? task.id.split(":")[0] : task.id;
    lines.push("BEGIN:VEVENT", `UID:${icsText(uid)}@betterhuskyct`, `DTSTAMP:${utcStamp(now)}`, `SUMMARY:${icsText(summary)}`);
    if (task.allDay && task.dateKey) {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(task.dateKey)}`, `DTEND;VALUE=DATE:${nextDay(task.dateKey)}`);
    } else {
      // The time the app shows as due, which is the start; an end, where a feed gives one, is not a deadline.
      const due = new Date(task.start);
      lines.push(`DTSTART:${utcStamp(new Date(due.valueOf() - LEAD_MINUTES * 60_000))}`, `DTEND:${utcStamp(due)}`);
    }
    if (task.location) lines.push(`LOCATION:${icsText(task.location)}`);
    lines.push("TRANSP:TRANSPARENT");
    const alarms = task.allDay ? ALL_DAY_ALARMS : TIMED_ALARMS;
    for (const trigger of alarms) {
      // Timed alarms count back from the due time, the event's end; an all-day one from the day's start.
      const related = task.allDay ? "" : ";RELATED=END";
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(summary)}`, `TRIGGER${related}:${trigger}`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function icsFileName(now: Date): string {
  return `betterhuskyct-deadlines-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.ics`;
}
