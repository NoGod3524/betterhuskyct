import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { EMPTY_OVERLAY } from "../src/lib/event-overlay.ts";
import {
  activeNotices,
  dismissNotice,
  MOVE_NOTICE_DAYS,
  moveMap,
  moveOverlay,
  moveRecord,
  moveSet,
  parseMoveLog,
  recordMoves,
  restoreMoveLog,
  saveMoveLog,
  type Move,
} from "../src/lib/moved-deadlines.ts";
import { detectMoves, mergeSyncPayload } from "../src/lib/sync-merge.ts";
import { buildSyncPayload } from "../src/lib/sync.ts";

const FRIDAY = "2026-10-16T03:59:00.000Z";
const SUNDAY = "2026-10-18T03:59:00.000Z";
const NOW = new Date("2026-10-15T12:00:00.000Z");

const task = (uid: string, start: string, over: Partial<CalendarTask> = {}): CalendarTask => ({
  id: `${uid}:${start}`,
  title: "Homework 5",
  course: "MATH 1131Q",
  start,
  dateKey: null,
  end: null,
  allDay: false,
  location: null,
  kind: "assignment",
  ...over,
});

const MOVE: Move = { uid: "hw5", from: `hw5:${FRIDAY}`, to: `hw5:${SUNDAY}`, fromStart: FRIDAY, toStart: SUNDAY };

test("a deadline that arrives once, at a new start, is a move; a repeating event or an unchanged one is not", () => {
  assert.deepEqual(detectMoves([task("hw5", FRIDAY)], [task("hw5", SUNDAY)]), [MOVE]);
  assert.deepEqual(detectMoves([task("hw5", FRIDAY)], [task("hw5", FRIDAY)]), []);
  assert.deepEqual(detectMoves([task("new", FRIDAY)], [task("hw5", SUNDAY)]), [], "a different UID is a different task");
  // A repeating lecture: another set of instances is not one deadline moving.
  const weekly = (starts: string[]) => starts.map((start) => task("lecture", start));
  assert.deepEqual(detectMoves(weekly([FRIDAY, SUNDAY]), weekly(["2026-10-23T03:59:00.000Z", "2026-10-25T03:59:00.000Z"])), []);
});

test("what is kept under a task id follows it, and does not clobber a value already under the new id", () => {
  assert.deepEqual([...moveSet(new Set([MOVE.from, "other"]), [MOVE])].sort(), [MOVE.to, "other"].sort());
  assert.deepEqual([...moveMap(new Map([[MOVE.from, "graded"]]), [MOVE])], [[MOVE.to, "graded"]]);
  assert.deepEqual([...moveMap(new Map([[MOVE.from, "submitted"], [MOVE.to, "graded"]]), [MOVE])], [[MOVE.to, "graded"]], "the value already there is the newer word");
  assert.deepEqual(moveRecord({ [MOVE.from]: "course-1" }, [MOVE]), { [MOVE.to]: "course-1" });
  assert.deepEqual(moveSet(new Set(["unrelated"]), [MOVE]), new Set(["unrelated"]));
});

test("a note, a title and a deletion follow a moved task; a correction of its time does not", () => {
  const overlay = {
    edits: {
      [MOVE.from]: { note: "ask for an extension", title: "HW5 (mine)", start: "2026-10-16T01:00:00.000Z", allDay: false },
      keep: { note: "elsewhere" },
    },
    deletedIds: [MOVE.from],
  };

  const moved = moveOverlay(overlay, [MOVE]);

  assert.deepEqual(moved.edits[MOVE.to], { note: "ask for an extension", title: "HW5 (mine)" });
  assert.equal(MOVE.from in moved.edits, false);
  assert.deepEqual(moved.edits.keep, { note: "elsewhere" });
  assert.deepEqual(moved.deletedIds, [MOVE.to]);
  // Only a time correction: nothing is left, so no empty edit is kept.
  const timeOnly = moveOverlay({ edits: { [MOVE.from]: { start: FRIDAY } }, deletedIds: [] }, [MOVE]);
  assert.deepEqual(timeOnly, EMPTY_OVERLAY);
});

test("a merge carries the ticks and the course choice across a move, and says what moved", () => {
  const local = {
    courses: { ...EMPTY_COURSE_BOOK, assignments: { [MOVE.from]: "course-1", unrelated: "course-2" } },
    completedIds: new Set([MOVE.from, "other-tick"]),
    subscriptions: [
      { id: "feed", name: "HuskyCT to-do", courseId: null, importedAt: "2026-10-14T00:00:00.000Z", events: [task("hw5", FRIDAY), task("hw6", FRIDAY)] },
    ],
  };
  const payload = buildSyncPayload({
    feeds: [{ name: "HuskyCT to-do", courseId: null, importedAt: "2026-10-15T00:00:00.000Z", events: [task("hw5", SUNDAY), task("hw6", FRIDAY)] }],
    completedIds: [],
    courses: EMPTY_COURSE_BOOK,
  });

  const merged = mergeSyncPayload(local, payload);

  assert.deepEqual(merged.moves, [MOVE]);
  assert.deepEqual([...merged.completedIds].sort(), [MOVE.to, "other-tick"].sort());
  assert.deepEqual(merged.courses.assignments, { [MOVE.to]: "course-1", unrelated: "course-2" });
  assert.deepEqual(merged.subscriptions[0].events.map((event) => event.id).sort(), [MOVE.to, `hw6:${FRIDAY}`].sort(), "the old instance is gone, not shown twice");
});

test("a deadline moved again replaces its notice, and a notice lasts a week or until it is dismissed", () => {
  const first = recordMoves({}, [MOVE], NOW);
  assert.deepEqual(first, { [MOVE.to]: { from: FRIDAY, to: SUNDAY, at: NOW.toISOString() } });

  const again: Move = { uid: "hw5", from: MOVE.to, to: "hw5:2026-10-20T03:59:00.000Z", fromStart: SUNDAY, toStart: "2026-10-20T03:59:00.000Z" };
  const second = recordMoves(first, [again], new Date(NOW.valueOf() + 3_600_000));
  assert.deepEqual(Object.keys(second), [again.to], "the first notice was kept beside the second");
  assert.equal(second[again.to].from, SUNDAY);

  assert.deepEqual(Object.keys(activeNotices(second, NOW)), [again.to]);
  assert.deepEqual(activeNotices(second, new Date(NOW.valueOf() + (MOVE_NOTICE_DAYS + 1) * 86_400_000)), {});
  assert.deepEqual(dismissNotice(second, again.to), {});
  assert.equal(dismissNotice(second, "nothing"), second);
  assert.equal(recordMoves(second, [], NOW), second);
});

test("the notices are stored and read back, and damaged storage reads as none", () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
  const log = recordMoves({}, [MOVE], NOW);

  saveMoveLog(storage, log);
  assert.deepEqual(restoreMoveLog(storage), log);
  saveMoveLog(storage, {});
  assert.equal(map.size, 0, "an empty log is not kept");

  map.set("huskypilot.moves.v1", "{oops");
  assert.deepEqual(restoreMoveLog(storage), {});
  assert.deepEqual(parseMoveLog({ version: 1, notices: { a: { from: "x", to: SUNDAY, at: NOW.toISOString() }, b: { from: FRIDAY, to: SUNDAY, at: NOW.toISOString() } } }), { b: { from: FRIDAY, to: SUNDAY, at: NOW.toISOString() } });
});
