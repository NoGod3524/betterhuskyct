import { intlLocale, type Locale } from "./i18n.ts";

/**
 * Every day the app writes out is written yyyy/mm/dd, in both languages, so "10/9" never has to be
 * read as October 9 or September 10. The weekday and the time keep the reader's language.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** `2026/10/09`, for a moment in the reader's zone. */
export function ymd(date: Date): string {
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

/** `2026/10/09`, for a day given as its parts. */
export function ymdParts({ year, month, day }: { year: number; month: number; day: number }): string {
  return `${year}/${pad(month)}/${pad(day)}`;
}

type Options = {
  /** `short` (Fri) or `long` (Friday); none leaves the weekday out. */
  weekday?: "short" | "long";
  /** Add the time of day, as the language writes it. */
  time?: boolean;
};

/** `2026/10/09`, with the weekday and the time when asked: `2026/10/09 Fri 11:59 PM`. */
export function formatDate(date: Date, locale: Locale, { weekday, time }: Options = {}): string {
  const parts = [ymd(date)];
  if (weekday) parts.push(new Intl.DateTimeFormat(intlLocale(locale), { weekday }).format(date));
  if (time) parts.push(new Intl.DateTimeFormat(intlLocale(locale), { hour: "numeric", minute: "2-digit" }).format(date));
  return parts.join(" ");
}

/** The same as a formatter, for code that makes one and uses it many times. */
export function dateFormatter(locale: Locale, options: Options = {}): { format: (date: Date) => string } {
  return { format: (date) => formatDate(date, locale, options) };
}
