import type { Candidate } from "./announcement-actions.ts";
import { dayKey, isRealDay } from "./announcement-dates.ts";
import type { CustomEventInput } from "./custom-events.ts";
import { dueInstant } from "./quick-add.ts";

/** What the student is looking at in a candidate's form: all text, as the inputs hold it. */
export type TodoDraft = { title: string; date: string; time: string };

/** The form's starting values: what the rules settled, and nothing they did not. */
export function draftFrom(candidate: Candidate): TodoDraft {
  return { title: candidate.title, date: candidate.date ? dayKey(candidate.date) : "", time: candidate.time ?? "" };
}

export type TodoResult =
  | { kind: "event"; input: CustomEventInput }
  | { kind: "undated"; todo: { title: string; course: string | null; note: string | null } }
  | { kind: "invalid"; problem: "title" | "date" | "time" };

/**
 * What the student's form makes. A day makes an event for that day, for the whole day when there
 * is no time, so no end of day is made up; no day makes a to-do with none. A day that is not a
 * real one, or a time that is not a time, is refused rather than corrected.
 */
export function todoFrom(draft: TodoDraft, announcement: { title: string; courseCode: string | null }): TodoResult {
  const title = draft.title.trim();
  if (!title) return { kind: "invalid", problem: "title" };
  const note = `From the announcement: ${announcement.title}`.slice(0, 300);
  const course = announcement.courseCode;
  if (draft.date === "") return { kind: "undated", todo: { title, course, note } };

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.date);
  if (!match || !isRealDay({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) })) return { kind: "invalid", problem: "date" };
  if (draft.time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) return { kind: "invalid", problem: "time" };
  return {
    kind: "event",
    input: { title, course, start: dueInstant(draft.date, draft.time), end: null, allDay: draft.time === "", location: null, note },
  };
}
