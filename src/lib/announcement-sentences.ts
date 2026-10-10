/**
 * Where the sentences of a text are.
 *
 * Cut at line ends and at . ! ? followed by a space and a capital or a digit, except after "Oct.",
 * "Dr." and the like, and after a single letter. Positions are kept, so a text can be shown whole
 * with some of its sentences marked, with nothing left out or reworded.
 */
const ABBREVIATIONS = new Set(["jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun", "dr", "mr", "mrs", "ms", "prof", "vs", "etc", "e.g", "i.e", "no", "fig", "st", "approx"]);

export type Range = { start: number; end: number };

export function sentenceRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    let from = 0;
    for (const boundary of line.matchAll(/[.!?]+\s+(?=[A-Z0-9"'(\[])/g)) {
      const end = boundary.index! + boundary[0].length;
      // "Oct. 9" and "Dr. Smith" are not the end of a sentence.
      const word = /([A-Za-z.]+)$/.exec(line.slice(0, boundary.index!))?.[1] ?? "";
      if (boundary[0].startsWith(".") && (ABBREVIATIONS.has(word.toLowerCase()) || /^[A-Za-z]$/.test(word))) continue;
      ranges.push({ start: lineStart + from, end: lineStart + end });
      from = end;
    }
    ranges.push({ start: lineStart + from, end: lineStart + line.length });
    lineStart += line.length + 1;
  }
  return ranges.filter((range) => range.end > range.start);
}

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** The sentences, as written, with their white space made single and none left empty. */
export function sentencesOf(text: string): string[] {
  return sentenceRanges(text)
    .map((range) => oneLine(text.slice(range.start, range.end)))
    .filter((sentence) => sentence.length > 0);
}
