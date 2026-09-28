import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createGradesReceiver,
  formatPoints,
  GRADES_PROTOCOL,
  huskyctGradesUrl,
  isCounted,
  memoryGradesStore,
  mergeGrades,
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
