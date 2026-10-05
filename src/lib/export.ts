import type { CalendarTask } from "./calendar-types.ts";

const CSV_HEADERS = [
  "Title",
  "Course",
  "Start",
  "End",
  "All day",
  "Location",
  "Completed",
];

/**
 * Excel only detects UTF-8 in a CSV file when it starts with a byte-order mark,
 * so exports are prefixed with this before being downloaded.
 */
export const CSV_BOM = "\uFEFF";

/** Quote a cell when it contains a delimiter, a quote, or a line break. */
export function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/**
 * Render tasks as CSV. Headers stay in English on purpose: the file is meant to
 * open cleanly in Excel, Sheets, or Notion, and the user's own text (titles,
 * courses, locations) is passed through unchanged.
 */
export function tasksToCsv(
  tasks: CalendarTask[],
  completedIds: Set<string>,
): string {
  const rows = tasks.map((task) => [
    task.title,
    task.course ?? "",
    task.start,
    task.end ?? "",
    task.allDay ? "yes" : "no",
    task.location ?? "",
    completedIds.has(task.id) ? "yes" : "no",
  ]);

  return [CSV_HEADERS, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

/** Stable, sortable file name such as `huskypilot-tasks-2026-09-10.csv`. */
export function exportFileName(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `huskypilot-tasks-${year}-${month}-${day}.csv`;
}
