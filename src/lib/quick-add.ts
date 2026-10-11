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
