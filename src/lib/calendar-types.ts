/**
 * What a Blackboard entry actually is, read from its UID. Blackboard puts class
 * meetings and graded items in the same calendar, and nothing else in the
 * payload tells them apart.
 */
export type TaskKind = "class" | "assignment";

export type CalendarTask = {
  id: string;
  title: string;
  course: string | null;
  start: string;
  dateKey: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  /** Absent on older saved payloads, and on feeds that are not Blackboard. */
  kind?: TaskKind | null;
};

/**
 * Whether this entry is something you have to hand in, rather than somewhere you
 * have to be.
 *
 * A lecture has a time and a room, but nothing is due at it and nobody ticks it
 * off. Counting lectures as deadlines inflates every "N due" on the page and
 * puts a plan row on a class you were going to attend anyway — so schedule
 * entries stay in the day list and out of everything that says "due".
 *
 * Feeds that are not Blackboard leave `kind` unset, and those entries are taken
 * at face value: an iCalendar event with no marker is a deadline.
 */
export function isDeadline(task: CalendarTask): boolean {
  return task.kind !== "class";
}

export type CalendarImportResult = {
  calendarName: string | null;
  importedAt: string;
  events: CalendarTask[];
};

export type TaskGroup = {
  key: "today" | "tomorrow" | "week";
  title: string;
  dateLabel: string;
  accentClass: string;
  tasks: CalendarTask[];
};
