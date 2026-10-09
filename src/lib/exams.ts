import { isDeadline, type CalendarTask } from "./calendar-types.ts";
import { dueTimestamp, startOfLocalDay, taskDate } from "./date-utils.ts";

/** A final that is handed in, not sat: "Final project", "Final paper". */
const NOT_AN_EXAM = /\bfinal\s+(project|paper|presentation|draft|report|essay|assignment|portfolio|submission)\b/i;
const EXAM = /\b(exams?|midterms?|mid-terms?|finals?|tests?)\b/i;

/**
 * Whether a title names an exam. HuskyCT does not say what kind of thing an item is, so this reads
 * the title: exam, midterm, final or test, but not a quiz, and not a final project or paper. It
 * can be wrong either way, which is why the list that uses it says it goes by the title.
 */
export function isExamTitle(title: string): boolean {
  return EXAM.test(title) && !NOT_AN_EXAM.test(title);
}

export type UpcomingExam = {
  task: CalendarTask;
  /** Calendar days from today to the exam's day: 0 is today. */
  daysLeft: number;
};

/** The exams still ahead, today's included, nearest first, leaving out what is done. */
export function upcomingExams(tasks: readonly CalendarTask[], doneIds: ReadonlySet<string>, now: Date): UpcomingExam[] {
  const today = startOfLocalDay(now);
  const found: Array<UpcomingExam & { due: number }> = [];
  for (const task of tasks) {
    if (!isDeadline(task) || doneIds.has(task.id) || !isExamTitle(task.title)) continue;
    const due = dueTimestamp(task);
    if (due === null || due < today.valueOf()) continue;
    const day = startOfLocalDay(taskDate(task));
    found.push({ task, due, daysLeft: Math.round((day.valueOf() - today.valueOf()) / 86_400_000) });
  }
  return found.sort((left, right) => left.due - right.due).map(({ task, daysLeft }) => ({ task, daysLeft }));
}
