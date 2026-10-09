const pad = (value: number) => String(value).padStart(2, "0");

/** The local day of `now` as a date input's value: 2026-10-09. */
export function todayInput(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * When a to-do falls due, from a date input ("2026-10-09") and a time input ("14:30", or "" for
 * no time, which is the start of the day). Local time, as an ISO string, the way the calendar
 * page stores what it adds.
 */
export function dueInstant(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (time || "00:00").split(":").map(Number);
  return new Date(year, month - 1, day, hour || 0, minute || 0).toISOString();
}
