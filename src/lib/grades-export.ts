import { csvCell } from "./export.ts";
import { formatPoints, isCounted, type GradesSnapshot } from "./grades.ts";

const HEADERS = ["Course", "Term", "Item", "Status", "Earned", "Possible", "Percent", "Result", "Read at"];

/**
 * A spreadsheet opens a cell that starts with = + - or @ as a formula. A gradebook's titles and
 * statuses are text HuskyCT's staff wrote, so they are written as text, with a leading apostrophe,
 * rather than left for a spreadsheet to run.
 */
function text(value: string | null): string {
  const plain = value ?? "";
  return /^[=+\-@\t\r]/.test(plain) ? "'" + plain : plain;
}

/**
 * The gradebooks as CSV, one row per item, in the order HuskyCT lists them. Headers stay in English
 * so the file opens the same everywhere; what is in the cells is what HuskyCT showed.
 *
 * "Percent" is the item's own score over its points, to a tenth. It is not a course grade: weights,
 * drops and extra credit are not in what HuskyCT shows, and so are not here either.
 */
export function gradesToCsv(snapshot: GradesSnapshot): string {
  const rows: string[][] = [];
  for (const course of snapshot.courses) {
    for (const item of course.items) {
      const counted = isCounted(item);
      rows.push([
        text(course.code ?? course.id),
        text(snapshot.term),
        text(item.title),
        text(item.status),
        item.earned === null ? "" : formatPoints(item.earned),
        item.possible === null ? "" : formatPoints(item.possible),
        counted ? String(Math.round((item.earned / item.possible) * 1000) / 10) : "",
        text(item.label),
        snapshot.takenAt,
      ]);
    }
  }
  return [HEADERS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** Stable, sortable file name such as `huskypilot-grades-2026-10-05.csv`. */
export function gradesFileName(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `huskypilot-grades-${now.getFullYear()}-${month}-${day}.csv`;
}
