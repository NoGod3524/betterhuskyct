import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

/**
 * The course list read from HuskyCT's own data, shaped as the Courses page's request was
 * recorded on 2026-10-04: memberships, each holding the course.
 */
const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");

type Card = { id: string; code: string | null; term: string | null };
type Found = { recent: unknown[]; cards: Card[]; queue: Array<{ id: string; code: string | null }>; pageFound: boolean };
type Helper = {
  readCoursesApi: () => Promise<Found | null>;
  courseCardFromApi: (membership: unknown) => Card | null;
  termOfCourse: (course: unknown) => string | null;
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

/** A membership as the recording showed one. */
const membership = (id: string, displayName: string, course: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  role: "S",
  courseId: id,
  isAvailable: true,
  userHasHidden: false,
  course: {
    id,
    courseId: "1268-UCONN-X-0000-SEC001-0001",
    displayName,
    isOrganization: false,
    isAvailable: true,
    effectiveAvailability: true,
    term: { name: "Fall 2026" },
    ...course,
  },
  ...extra,
});

const FIRST = "/learn/api/v1/users/me/memberships?includeCount=true&limit=50&offset=0&expand=course.effectiveAvailability&sort=lastAccessDate(desc:nullslast)";

test("a course is its id, its code from the display name, and its term from the readable id", () => {
  const { helper } = openPage(() => null);

  assert.deepEqual(
    plain(helper.courseCardFromApi(membership("_203765_1", "MATH-1070Q-Mathematics for Business and Economics-SEC100-1268", { courseId: "1268-UCONN-MATH-1070Q-SEC100-1191" }))),
    { id: "_203765_1", code: "MATH 1070Q", term: "1268" },
  );
});

test("the term is the readable id's prefix, else read from the term's name, else unknown", () => {
  const { helper } = openPage(() => null);

  assert.equal(helper.termOfCourse({ courseId: "1263-UCONN-CHEM-1127Q-SEC001-1" }), "1263");
  assert.equal(helper.termOfCourse({ courseId: "no-prefix", term: { name: "Fall 2026" } }), "1268");
  assert.equal(helper.termOfCourse({ term: { name: "Spring 2027" } }), "1273");
  assert.equal(helper.termOfCourse({ term: { name: "Summer 2026" } }), "1265");
  assert.equal(helper.termOfCourse({ term: { name: "Whenever" } }), null);
  assert.equal(helper.termOfCourse({}), null);
});

test("organizations, courses the student cannot open, and ones they hid are not on the list", () => {
  const { helper } = openPage(() => null);
  const name = "ECON-1201-Principles of Microeconomics-SEC010-1268";

  assert.equal(helper.courseCardFromApi(membership("_1_1", name, { isOrganization: true })), null);
  assert.equal(helper.courseCardFromApi(membership("_1_1", name, { effectiveAvailability: false })), null);
  assert.equal(helper.courseCardFromApi(membership("_1_1", name, { isAvailable: false })), null);
  assert.equal(helper.courseCardFromApi(membership("_1_1", name, {}, { isAvailable: false })), null);
  assert.equal(helper.courseCardFromApi(membership("_1_1", name, {}, { userHasHidden: true })), null);
  assert.equal(helper.courseCardFromApi(membership("not-an-id", name)), null);
  assert.equal(helper.courseCardFromApi(null), null);
  assert.ok(helper.courseCardFromApi(membership("_1_1", name)), "an ordinary course was left out");
});

test("every page of the list is read and the courses to collect are this term's and later ones", async () => {
  const second = "/learn/api/v1/users/me/memberships?limit=50&offset=50&includeCount=true";
  const { helper, asked } = openPage((path) => {
    if (path === FIRST) {
      return {
        paging: { count: 3, nextPage: second },
        results: [
          membership("_203765_1", "MATH-1070Q-Mathematics-SEC100-1268", { courseId: "1268-UCONN-MATH-1070Q-SEC100-1191" }),
          membership("_100001_1", "CHEM-1127Q-General Chemistry-SEC001-1263", { courseId: "1263-UCONN-CHEM-1127Q-SEC001-1" }),
        ],
      };
    }
    if (path === second) return { paging: { count: 3, nextPage: "" }, results: [membership("_198430_1", "ECON-1201-Micro-SEC010-1268", { courseId: "1268-UCONN-ECON-1201-SEC010-5757" })] };
    return null;
  });

  const found = plain(await helper.readCoursesApi());

  assert.deepEqual(asked, [FIRST, second]);
  assert.deepEqual(found?.cards.map((card) => card.id), ["_203765_1", "_100001_1", "_198430_1"]);
  // Last term's CHEM is on the list but not in the walk.
  assert.deepEqual(found?.queue, [{ id: "_203765_1", code: "MATH 1070Q" }, { id: "_198430_1", code: "ECON 1201" }]);
  assert.equal(found?.pageFound, true);
});

test("a list that is refused, empty, not a list, or short of its count is not trusted", async () => {
  assert.equal(await openPage(() => null).helper.readCoursesApi(), null);
  assert.equal(await openPage(() => ({ nope: true })).helper.readCoursesApi(), null);
  assert.equal(await openPage((path) => (path === FIRST ? { paging: { count: 0, nextPage: "" }, results: [] } : null)).helper.readCoursesApi(), null);
  assert.equal(
    await openPage((path) => (path === FIRST ? { paging: { count: 9, nextPage: "" }, results: [membership("_1_1", "ECON-1201-Micro-SEC010-1268")] } : null)).helper.readCoursesApi(),
    null,
  );
});

test("a next address outside the student's own memberships is never followed", async () => {
  const { helper, asked } = openPage((path) =>
    path === FIRST ? { paging: { nextPage: "https://evil.example/x" }, results: [membership("_1_1", "ECON-1201-Micro-SEC010-1268")] } : null,
  );

  assert.equal(plain(await helper.readCoursesApi())?.cards.length, 1);
  assert.equal(asked.length, 1, "a request went to an address the answer named");
});
