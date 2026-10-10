import { kindOf } from "./announcement-actions.ts";
import { findDates } from "./announcement-dates.ts";
import { sentenceRanges } from "./announcement-sentences.ts";

/**
 * An announcement's text, cut into pieces to show it with the key sentences marked and the links
 * live. The pieces put back together are exactly the text: nothing is left out, reordered or
 * reworded, so the marking can only draw the eye, never change what was said.
 */
export type TextSegment = {
  text: string;
  /** A sentence that names something to do or a date. */
  key: boolean;
  /** An http(s) address, when this piece is one. */
  url: string | null;
};

/** Whether a sentence names something to do (due, exam, cancelled…) or writes a date out. */
export function isKeySentence(sentence: string): boolean {
  if (kindOf(sentence).kind !== null) return true;
  return findDates(sentence, null).some((date) => date.basis.includes("month-day") || date.basis.includes("iso") || (date.basis.includes("numeric") && date.basis.includes("year-stated")));
}

function withLinks(text: string, key: boolean): TextSegment[] {
  const out: TextSegment[] = [];
  let at = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    // A full stop or bracket after an address is the sentence's, not the address's.
    const url = match[0].replace(/[.,;:!?)\]]+$/, "");
    if (match.index! > at) out.push({ text: text.slice(at, match.index), key, url: null });
    out.push({ text: url, key, url });
    at = match.index! + url.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), key, url: null });
  return out;
}

export function segmentsOf(body: string): TextSegment[] {
  const out: TextSegment[] = [];
  let cursor = 0;
  for (const range of sentenceRanges(body)) {
    if (range.start > cursor) out.push(...withLinks(body.slice(cursor, range.start), false));
    out.push(...withLinks(body.slice(range.start, range.end), isKeySentence(body.slice(range.start, range.end))));
    cursor = range.end;
  }
  if (cursor < body.length) out.push(...withLinks(body.slice(cursor), false));
  return out;
}

/** Whether the text points at a file the announcement carries, which this app does not hold. */
export function mentionsAttachment(text: string): boolean {
  return /\battach(?:ed|ment|ments)\b|\bsee (?:the )?(?:file|pdf|document|handout)\b/i.test(text);
}
