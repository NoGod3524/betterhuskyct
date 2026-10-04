import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

/**
 * Gradebook rows read from HuskyCT's own data, shaped as the Grades page's request was
 * recorded on 2026-10-04. What matters most is the direction of every doubt: a value
 * this has not seen must leave work open, never mark it done.
 */
const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");

type Item = { id: string; title: string; status: string | null; earned: number | null; possible: number | null; label: string | null };
type Helper = {
  readUserId: () => Promise<string | null>;
  readGradesApi: (courseId: string, userId: string) => Promise<Item[] | null>;
  gradeItemFromApi: (row: unknown) => Item | null;
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

function openPage(serve: (path: string) => unknown | null) {
  const window = new Window({ url: "https://lms.uconn.edu/ultra/stream" });
  windows.push(window);
  const asked: string[] = [];
  (window as unknown as { fetch: unknown }).fetch = async (path: string) => {
    asked.push(path);
    const answer = serve(path);
    return answer === null
      ? new Response("{}", { status: 404 })
      : new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  };
  const sandbox = {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    Blob,
    CompressionStream,
    Response,
    TextEncoder,
    btoa,
    URL,
    console,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { window, helper: (window as unknown as { __huskyctHelper: Helper }).__huskyctHelper, asked };
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** A row as the recording showed one. */
const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  columnId: id,
  column: { id, effectiveColumnName: name, columnName: name, possible: 100, deleted: false },
  status: "GRADED",
  pointsPossible: 100,
  displayGrade: { score: 100, isOverride: false },
  effectiveScore: 100,
  isExempt: false,
  lastAttempt: { status: "COMPLETED", score: 100 },
  ...extra,
});

const FIRST = "/learn/api/v1/courses/_203765_1/gradebook/grades?userId=_1003488_1&limit=25&offset=0&sort=column.position(asc)&expand=lastAttempt,attemptsLeft,submissionStatus,column&includeNoGradeItems=true";

test("the signed-in student's id is read from the account, and only if it looks like one", async () => {
  assert.equal(await openPage((path) => (path === "/learn/api/v1/users/me" ? { id: "_1003488_1", userName: "x" } : null)).helper.readUserId(), "_1003488_1");
  assert.equal(await openPage(() => ({ id: "not-an-id" })).helper.readUserId(), null);
  assert.equal(await openPage(() => null).helper.readUserId(), null);
});

test("a graded row is its score out of its points; a submitted one waits to be graded; an exempt one says so", () => {
  const { helper } = openPage(() => null);

  assert.deepEqual(plain(helper.gradeItemFromApi(row("_3876640_1", "Take-home Quiz 1"))), {
    id: "_3876640_1", title: "Take-home Quiz 1", status: "Graded", earned: 100, possible: 100, label: null,
  });
  const exam = row("_3876639_1", "Exam 1", { status: "NEEDS_GRADING", displayGrade: {}, effectiveScore: undefined });
  assert.deepEqual(plain(helper.gradeItemFromApi(exam)), {
    id: "_3876639_1", title: "Exam 1", status: "Submitted", earned: null, possible: null, label: "Not graded",
  });
  const exempt = row("_3876641_1", "Dropped", { status: "NOT_SUBMITTED", displayGrade: {}, effectiveScore: undefined, isExempt: true, lastAttempt: undefined });
  assert.deepEqual(plain(helper.gradeItemFromApi(exempt)), {
    id: "_3876641_1", title: "Dropped", status: null, earned: null, possible: null, label: "Exempt",
  });
});

test("a value never seen leaves the work open: a score on a row that is not GRADED, an attempt that is not COMPLETED", () => {
  const { helper } = openPage(() => null);

  const scoredButUnknown = plain(helper.gradeItemFromApi(row("_1_1", "A", { status: "SOMETHING_NEW" })));
  assert.equal(scoredButUnknown?.earned, null, "a score on a row of an unknown status was taken as a grade");
  assert.equal(scoredButUnknown?.status, "Submitted", "the completed attempt is still seen");

  const started = plain(helper.gradeItemFromApi(row("_2_1", "B", { status: "IN_PROGRESS", displayGrade: {}, effectiveScore: undefined, lastAttempt: { status: "IN_PROGRESS" } })));
  assert.equal(started?.status, null, "an attempt still in progress was taken as handed in");
});

test("a row that is not an item is left out: no id of the _N_N kind, a deleted column, no name", () => {
  const { helper } = openPage(() => null);

  assert.equal(helper.gradeItemFromApi(row("finalGrade", "Total")), null);
  assert.equal(helper.gradeItemFromApi({ ...row("_1_1", "Gone"), column: { id: "_1_1", effectiveColumnName: "Gone", deleted: true } }), null);
  assert.equal(helper.gradeItemFromApi({ ...row("_1_1", ""), column: { id: "_1_1" } }), null);
  assert.equal(helper.gradeItemFromApi(null), null);
  // A score beyond what the app accepts is words, not points.
  assert.equal(plain(helper.gradeItemFromApi(row("_1_1", "Huge", { displayGrade: { score: 99999999 }, effectiveScore: undefined })))?.earned, null);
});

test("every page of the gradebook is read, following the answer's own next address, and asked for as the page asks", async () => {
  const second = "/learn/api/v1/courses/_203765_1/gradebook/grades?limit=25&offset=25";
  const { helper, asked } = openPage((path) => {
    if (path === FIRST) return { paging: { count: 3, nextPage: second }, results: [row("_1_1", "One"), row("_2_1", "Two")] };
    if (path === second) return { paging: { count: 3, nextPage: "" }, results: [row("_3_1", "Three", { status: "NOT_GRADED", displayGrade: {}, effectiveScore: undefined, lastAttempt: undefined })] };
    return null;
  });

  const items = plain(await helper.readGradesApi("_203765_1", "_1003488_1"));

  assert.deepEqual(items?.map((item) => item.title), ["One", "Two", "Three"]);
  assert.deepEqual(asked, [FIRST, second]);
});

test("a gradebook that stops short of what HuskyCT says is there is not sent as a whole one", async () => {
  const { helper } = openPage((path) => (path === FIRST ? { paging: { count: 40, nextPage: "" }, results: [row("_1_1", "One")] } : null));

  assert.equal(await helper.readGradesApi("_203765_1", "_1003488_1"), null);
});

test("an answer that is refused or not a list gives null, and a next address outside HuskyCT's data is never followed", async () => {
  assert.equal(await openPage(() => null).helper.readGradesApi("_203765_1", "_1003488_1"), null);
  assert.equal(await openPage(() => ({ nope: 1 })).helper.readGradesApi("_203765_1", "_1003488_1"), null);

  const { helper, asked } = openPage((path) => (path === FIRST ? { paging: { nextPage: "https://evil.example/x" }, results: [row("_1_1", "One")] } : null));
  assert.equal((await helper.readGradesApi("_203765_1", "_1003488_1"))?.length, 1);
  assert.equal(asked.length, 1, "a request went to an address the answer named");
});
