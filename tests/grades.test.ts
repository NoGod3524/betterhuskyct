import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createGradesReceiver,
  formatPoints,
  GRADES_PROTOCOL,
  huskyctGradesUrl,
  isCounted,
  memoryGradesStore,
  markChangesSeen,
  mergeGrades,
  parseStoredGrades,
  parseGradesMessage,
  summarizeCourse,
  type GradeItem,
  type GradesSnapshot,
  type GradesStore,
} from "../src/lib/grades.ts";

const scored = (id: string, title: string, earned: number, possible: number, status: string | null = null): GradeItem => ({
  id,
  title,
  status,
  earned,
  possible,
  label: null,
});
const unscored = (id: string, title: string, label: string | null = "Not graded"): GradeItem => ({
  id,
  title,
  status: null,
  earned: null,
  possible: null,
  label,
});

function snapshot(codes: Array<[string, string]> = [["MATH 1070Q", "_203765_1"]]): GradesSnapshot {
  return {
    version: 1,
    term: "Fall 2026",
    takenAt: "2026-09-28T18:00:00.000Z",
    courses: codes.map(([code, id]) => ({
      id,
      code,
      items: [
        scored("_1_1", "Section 4.1 Homework", 81.3, 100, "1 attempt submitted (1 Late)"),
        scored("_2_1", "Section 4.2 Homework", 105, 100),
        scored("_3_1", "Section 4.4 Homework", 110, 100),
        scored("_4_1", "Practice Test for Ch 4", 0, 0, "Attempt 2 started"),
        unscored("_5_1", "Section 5.3 Homework"),
      ],
    })),
  };
}

const message = (body: Record<string, unknown>) => ({ protocol: GRADES_PROTOCOL, ...body });

// --- what is accepted ---------------------------------------------------------------

test("a hello and a reading are read when they are exactly right", () => {
  assert.deepEqual(parseGradesMessage(message({ kind: "hello" })), { kind: "hello" });
  const read = parseGradesMessage(message({ kind: "grades", grades: snapshot() }));
  assert.equal(read?.kind, "grades");
  assert.deepEqual(read?.kind === "grades" ? read.grades : null, snapshot());
});

test("anything else from another page is dropped whole", () => {
  const good = snapshot();
  const withItem = (item: Record<string, unknown>) =>
    message({ kind: "grades", grades: { ...good, courses: [{ ...good.courses[0], items: [item] }] } });
  const base = { id: "_1_1", title: "HW", status: null, earned: 1, possible: 2, label: null };
  const bad = [
    { kind: "hello" }, // no protocol
    message({ kind: "unknown" }),
    message({ kind: "grades", grades: { ...good, version: 2 } }),
    message({ kind: "grades", grades: { ...good, takenAt: "yesterday" } }),
    message({ kind: "grades", grades: { ...good, courses: "many" } }),
    // Half a score.
    withItem({ ...base, possible: null }),
    // A score and a label both.
    withItem({ ...base, label: "A" }),
    // Points that are not points.
    withItem({ ...base, earned: -1 }),
    withItem({ ...base, earned: Number.POSITIVE_INFINITY }),
    withItem({ ...base, earned: "1" }),
    withItem({ ...base, possible: 1e9 }),
    // An id that is not HuskyCT's.
    withItem({ ...base, id: "javascript:alert(1)" }),
    // A title too long to be one, or none.
    withItem({ ...base, title: "x".repeat(5000) }),
    withItem({ ...base, title: "" }),
    // More rows than any course has.
    message({ kind: "grades", grades: { ...good, courses: [{ ...good.courses[0], items: Array(1001).fill(base) }] } }),
  ];
  for (const data of bad) assert.equal(parseGradesMessage(data), null, JSON.stringify(data).slice(0, 90));
});

// --- reading the numbers ------------------------------------------------------------

test("the total counts scores out of some points, and nothing else", () => {
  const summary = summarizeCourse(snapshot().courses[0]);

  // 81.3 + 105 + 110 out of 300; the 0/0 practice test and the ungraded row do not count.
  assert.deepEqual(summary, { graded: 3, total: 5, earned: 296.3, possible: 300, percent: 98.8 });
  assert.equal(isCounted(snapshot().courses[0].items[3]), false);
  assert.equal(isCounted(snapshot().courses[0].items[4]), false);
});

test("a course with nothing graded has no percent", () => {
  const summary = summarizeCourse({ id: "_1_1", code: "STAT 1000Q", items: [unscored("_1_1", "Assignment 1")] });
  assert.deepEqual(summary, { graded: 0, total: 1, earned: 0, possible: 0, percent: null });
  assert.deepEqual(summarizeCourse({ id: "_1_1", code: null, items: [] }).percent, null);
});

test("points read as people write them", () => {
  assert.equal(formatPoints(105), "105");
  assert.equal(formatPoints(81.3), "81.3");
  assert.equal(formatPoints(81.30000000000001), "81.3");
  assert.equal(formatPoints(0.1 + 0.2), "0.3");
});

test("a course's gradebook links to HuskyCT only when its id is HuskyCT's", () => {
  assert.equal(huskyctGradesUrl({ id: "_203765_1", code: null, items: [] }), "https://lms.uconn.edu/ultra/courses/_203765_1/grades");
  assert.equal(huskyctGradesUrl({ id: "MATH 1070Q", code: null, items: [] }), null);
});

// --- keeping ----------------------------------------------------------------------------

test("a newer reading replaces its own courses and keeps the rest", () => {
  const before = snapshot([["MATH 1070Q", "_203765_1"], ["ECON 1201", "_198430_1"]]);
  const newer = snapshot([["MATH 1070Q", "_203765_1"]]);
  newer.takenAt = "2026-09-29T09:00:00.000Z";
  newer.courses[0].items = [scored("_9_1", "Exam 1", 90, 100)];

  const merged = mergeGrades(before, newer);

  assert.deepEqual(merged.courses.map((course) => course.code), ["ECON 1201", "MATH 1070Q"]);
  assert.deepEqual(merged.courses[1].items.map((item) => item.title), ["Exam 1"]);
  assert.equal(merged.courses[0].items.length, 5, "a course the reading did not reach was emptied");
  assert.equal(merged.takenAt, "2026-09-29T09:00:00.000Z");
  assert.equal(mergeGrades(null, newer).courses.length, 1);
});

test("two courses with one code are two courses, and a reading of one keeps the other", () => {
  const lecture = { id: "_201693_1", code: "STAT 1000Q", items: [scored("_1_1", "Quiz 1", 8, 10)] };
  const lab = { id: "_201694_1", code: "STAT 1000Q", items: [scored("_2_1", "Lab 1", 5, 5)] };
  const before: GradesSnapshot = { ...snapshot(), courses: [lecture, lab] };
  const newer: GradesSnapshot = { ...snapshot(), takenAt: "2026-09-29T09:00:00.000Z", courses: [{ ...lecture, items: [scored("_1_1", "Quiz 1", 9, 10)] }] };

  const merged = mergeGrades(before, newer);

  assert.deepEqual(merged.courses.map((course) => [course.id, course.items[0].earned]), [
    ["_201693_1", 9],
    ["_201694_1", 5],
  ]);
});

// --- what changed since you last looked -----------------------------------------------------

/** A reading of one course whose items are given. */
const reading = (items: GradeItem[], takenAt: string, id = "_203765_1"): GradesSnapshot => ({
  version: 1,
  term: "Fall 2026",
  takenAt,
  courses: [{ id, code: "MATH 1070Q", items }],
});
const T1 = "2026-09-28T18:00:00.000Z";
const T2 = "2026-09-29T09:00:00.000Z";
const T3 = "2026-09-30T09:00:00.000Z";

test("the first reading of a course is the baseline, not a wall of new scores", () => {
  const first = mergeGrades(null, reading([scored("_1_1", "HW 1", 90, 100)], T1));
  assert.equal(first.changes, undefined);

  // A different course arriving later is a baseline of its own.
  const second = mergeGrades(first, reading([scored("_9_1", "Quiz", 5, 5)], T2, "_201693_1"));
  assert.equal(second.changes, undefined);
});

test("a score that appears, changes, or is added is a change; a bare assignment is not", () => {
  const before = mergeGrades(null, reading([unscored("_1_1", "HW 1"), scored("_2_1", "HW 2", 80, 100), scored("_3_1", "HW 3", 7, 10)], T1));

  const after = mergeGrades(
    before,
    reading(
      [
        scored("_1_1", "HW 1", 95, 100), // had no score
        scored("_2_1", "HW 2", 90, 100), // had another
        scored("_3_1", "HW 3", 7, 10), // same
        scored("_4_1", "HW 4", 10, 10), // did not exist
        unscored("_5_1", "HW 5"), // did not exist, and has no score: not news
      ],
      T2,
    ),
  );

  const byItem = Object.fromEntries((after.changes ?? []).map((change) => [change.itemId, change]));
  assert.deepEqual(Object.keys(byItem).sort(), ["_1_1", "_2_1", "_4_1"]);
  assert.deepEqual(byItem["_1_1"], { courseId: "_203765_1", itemId: "_1_1", kind: "graded", from: null, at: T2 });
  assert.deepEqual(byItem["_2_1"], { courseId: "_203765_1", itemId: "_2_1", kind: "changed", from: { earned: 80, possible: 100 }, at: T2 });
  assert.deepEqual(byItem["_4_1"], { courseId: "_203765_1", itemId: "_4_1", kind: "new", from: null, at: T2 });
});

test("a score going away, or a 0/0 practice test, is not news", () => {
  const before = mergeGrades(null, reading([scored("_1_1", "HW 1", 9, 10), scored("_2_1", "Practice", 0, 0)], T1));
  const after = mergeGrades(before, reading([unscored("_1_1", "HW 1"), scored("_2_1", "Practice", 3, 0)], T2));
  assert.equal(after.changes, undefined);
});

test("a change stays until it is marked seen, and 'was' is what the student last saw", () => {
  const r1 = mergeGrades(null, reading([scored("_1_1", "HW 1", 80, 100)], T1));
  const r2 = mergeGrades(r1, reading([scored("_1_1", "HW 1", 90, 100)], T2));
  // A reading that shows nothing new does not lose it.
  const r3 = mergeGrades(r2, reading([scored("_1_1", "HW 1", 90, 100)], T3));
  assert.deepEqual(r3.changes?.map((c) => [c.itemId, c.kind, c.from?.earned, c.at]), [["_1_1", "changed", 80, T2]]);

  // Changed again before it was seen: still measured from the 80 they knew.
  const r4 = mergeGrades(r3, reading([scored("_1_1", "HW 1", 95, 100)], T3));
  assert.deepEqual(r4.changes?.map((c) => [c.kind, c.from?.earned, c.at]), [["changed", 80, T3]]);

  // Back where they last saw it: nothing to say.
  const r5 = mergeGrades(r4, reading([scored("_1_1", "HW 1", 80, 100)], T3));
  assert.equal(r5.changes, undefined);
});

test("a graded score that changes again is still 'newly graded', and a new one is still 'new'", () => {
  const r1 = mergeGrades(null, reading([unscored("_1_1", "HW 1")], T1));
  const r2 = mergeGrades(r1, reading([scored("_1_1", "HW 1", 70, 100), scored("_2_1", "HW 2", 10, 10)], T2));
  const r3 = mergeGrades(r2, reading([scored("_1_1", "HW 1", 75, 100), scored("_2_1", "HW 2", 9, 10)], T3));

  const byItem = Object.fromEntries((r3.changes ?? []).map((c) => [c.itemId, c]));
  assert.equal(byItem["_1_1"].kind, "graded");
  assert.equal(byItem["_1_1"].from, null);
  assert.equal(byItem["_2_1"].kind, "new");
});

test("a change is dropped when its item or its score is gone", () => {
  const r1 = mergeGrades(null, reading([scored("_1_1", "HW 1", 80, 100), scored("_2_1", "HW 2", 5, 10)], T1));
  const r2 = mergeGrades(r1, reading([scored("_1_1", "HW 1", 90, 100), scored("_2_1", "HW 2", 6, 10)], T2));
  assert.equal(r2.changes?.length, 2);

  const r3 = mergeGrades(r2, reading([unscored("_1_1", "HW 1")], T3));
  assert.equal(r3.changes, undefined, "changes outlived the scores they were about");
});

test("a reading that does not reach a course leaves that course's changes alone", () => {
  const both = (a: number, b: number, at: string): GradesSnapshot => ({
    version: 1,
    term: null,
    takenAt: at,
    courses: [
      { id: "_1_1", code: "AAA 1000", items: [scored("_1_1", "A", a, 10)] },
      { id: "_2_1", code: "BBB 1000", items: [scored("_2_1", "B", b, 10)] },
    ],
  });
  const r1 = mergeGrades(null, both(5, 5, T1));
  const r2 = mergeGrades(r1, both(6, 7, T2));
  assert.equal(r2.changes?.length, 2);

  // Only BBB is read now.
  const onlyB: GradesSnapshot = { version: 1, term: null, takenAt: T3, courses: [{ id: "_2_1", code: "BBB 1000", items: [scored("_2_1", "B", 7, 10)] }] };
  const r3 = mergeGrades(r2, onlyB);
  assert.deepEqual(r3.changes?.map((c) => c.courseId).sort(), ["_1_1", "_2_1"]);
});

test("marking seen clears the changes and nothing else", () => {
  const r2 = mergeGrades(mergeGrades(null, reading([scored("_1_1", "HW 1", 80, 100)], T1)), reading([scored("_1_1", "HW 1", 90, 100)], T2));
  assert.equal(r2.changes?.length, 1);

  const seen = markChangesSeen(r2);

  assert.equal("changes" in seen, false);
  assert.deepEqual(seen.courses, r2.courses);
  assert.equal(seen.takenAt, r2.takenAt);
  // The next reading is measured from what was on the page when they looked.
  assert.equal(mergeGrades(seen, reading([scored("_1_1", "HW 1", 90, 100)], T3)).changes, undefined);
});

test("stored changes are read back, but the helper cannot send any", () => {
  const stored = mergeGrades(mergeGrades(null, reading([scored("_1_1", "HW 1", 80, 100)], T1)), reading([scored("_1_1", "HW 1", 90, 100)], T2));
  const roundTrip = parseStoredGrades(JSON.parse(JSON.stringify(stored)));
  assert.deepEqual(roundTrip, stored);

  // A message that carries a change loses it: the app works these out itself.
  const forged = { ...stored, changes: [{ courseId: "_203765_1", itemId: "_1_1", kind: "graded", from: null, at: T2 }] };
  const parsed = parseGradesMessage(message({ kind: "grades", grades: forged }));
  assert.equal(parsed?.kind, "grades");
  assert.equal(parsed?.kind === "grades" ? parsed.grades.changes : "not a reading", undefined);
});

test("a stored change that does not fit is dropped alone", () => {
  const good = { courseId: "_203765_1", itemId: "_1_1", kind: "graded", from: null, at: T2 };
  const stored = {
    ...reading([scored("_1_1", "HW 1", 90, 100)], T2),
    changes: [
      good,
      { ...good, itemId: "javascript:alert(1)" },
      { ...good, kind: "changed" }, // "changed" must say what it changed from
      { ...good, kind: "graded", from: { earned: 1, possible: 2 } }, // and "graded" cannot
      { ...good, at: "yesterday" },
      "nonsense",
    ],
  };

  const read = parseStoredGrades(stored);

  assert.deepEqual(read?.changes, [good]);
  assert.equal(read?.courses.length, 1, "the grades were dropped with the bad change");
});

// --- receiving ----------------------------------------------------------------------------

function helperWindow() {
  const replies: Array<{ message: Record<string, unknown>; origin: string }> = [];
  return {
    replies,
    source: {
      postMessage(reply: unknown, origin: string) {
        replies.push({ message: reply as Record<string, unknown>, origin });
      },
    },
  };
}

test("a reading: hello, the grades, then a stored reply", async () => {
  const store = memoryGradesStore();
  const states: string[] = [];
  const receive = createGradesReceiver({ store, onChange: (state) => states.push(state.phase) });
  const helper = helperWindow();
  const from = "https://lms.uconn.edu";

  await receive({ origin: from, data: message({ kind: "hello" }), source: helper.source });
  await receive({ origin: from, data: message({ kind: "grades", grades: snapshot() }), source: helper.source });

  assert.deepEqual(
    helper.replies.map((reply) => reply.message),
    [
      { protocol: GRADES_PROTOCOL, kind: "ready" },
      { protocol: GRADES_PROTOCOL, kind: "stored", ok: true },
    ],
  );
  assert.ok(helper.replies.every((reply) => reply.origin === from), "a reply went to another origin");
  assert.deepEqual(await store.get(), snapshot());
  assert.deepEqual(states, ["connected", "done"]);
});

test("only HuskyCT's own pages are answered", async () => {
  const store = memoryGradesStore();
  const receive = createGradesReceiver({ store });
  const stranger = helperWindow();

  for (const origin of ["https://evil.example", "https://lms.uconn.edu.evil.example", "http://lms.uconn.edu"]) {
    await receive({ origin, data: message({ kind: "grades", grades: snapshot() }), source: stranger.source });
  }
  await receive({ origin: "https://lms.uconn.edu", data: message({ kind: "grades", grades: snapshot() }), source: null });

  assert.equal(stranger.replies.length, 0);
  assert.equal(await store.get(), null);
});

test("a reading the browser cannot keep is reported as not stored", async () => {
  const failing: GradesStore = {
    get: async () => null,
    put: async () => {
      throw new Error("quota");
    },
    clear: async () => undefined,
  };
  const states: string[] = [];
  const receive = createGradesReceiver({ store: failing, onChange: (state) => states.push(state.phase) });
  const helper = helperWindow();

  await receive({ origin: "https://lms.uconn.edu", data: message({ kind: "grades", grades: snapshot() }), source: helper.source });

  assert.deepEqual(helper.replies.map((reply) => reply.message.ok), [false]);
  assert.deepEqual(states, ["failed"]);
});

test("a second reading merges into the first", async () => {
  const store = memoryGradesStore();
  const receive = createGradesReceiver({ store });
  const helper = helperWindow();
  const origin = "https://lms.uconn.edu";

  await receive({ origin, data: message({ kind: "grades", grades: snapshot([["ECON 1201", "_198430_1"]]) }), source: helper.source });
  await receive({ origin, data: message({ kind: "grades", grades: snapshot([["MATH 1070Q", "_203765_1"]]) }), source: helper.source });

  assert.deepEqual((await store.get())?.courses.map((course) => course.code), ["ECON 1201", "MATH 1070Q"]);
});
