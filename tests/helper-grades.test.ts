import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

import { createGradesReceiver, parseGradesSnapshot, type GradesStore } from "../src/lib/grades.ts";
import { onlyAtHuskyct } from "./support/huskyct-fetch.ts";
import { memoryGradesStore } from "./support/memory-stores.ts";

/**
 * The grades walk, run as shipped against HuskyCT's own data: the course list, the student, and
 * each course's gradebook, 25 rows to a page. How one row reads is helper-grades-api's; this is
 * the walk around it, and the gradebooks' way into BetterHuskyCT.
 */
const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");

type Item = {
  id: string;
  title: string;
  status: string | null;
  earned: number | null;
  possible: number | null;
  label: string | null;
};
type Manifest = {
  term: string | null;
  stopped: boolean;
  signedOut?: boolean;
  problems: Array<{ key: string; params?: Record<string, unknown> }>;
  courses: Array<{ id: string; code: string | null; items: Item[]; skipped: boolean }>;
};
type Helper = {
  collectGrades: (options?: Record<string, unknown>) => Promise<Manifest>;
  gradesSummary: (manifest: Manifest) => { courses: number; items: number; scored: number };
  gradesSnapshotFrom: (manifest: Manifest) => unknown;
  sendGradesToBhc: (
    target: { postMessage(message: unknown, origin: string): void },
    manifest: Manifest,
    options?: Record<string, unknown>,
  ) => Promise<{ connected: boolean; stored: boolean; courses: number; items: number }>;
  problemsText: (problems: Array<{ key: string; params?: Record<string, unknown> }>) => string;
  setLocale: (locale: string) => void;
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const MATH = "_203765_1";
const ECON = "_198430_1";
const SOCI = "_201463_1";
const ME = "_1003488_1";

// --- HuskyCT's data ------------------------------------------------------------------

const membership = (id: string, readableId: string, displayName: string) => ({
  courseId: id,
  isAvailable: true,
  userHasHidden: false,
  course: { id, courseId: readableId, displayName, isOrganization: false, isAvailable: true, effectiveAvailability: true },
});
const MEMBERSHIPS = {
  paging: { count: 3, nextPage: "" },
  results: [
    membership(MATH, "1268-UCONN-MATH-1070Q-SEC100-1191", "MATH-1070Q-Mathematics for Business and Economics-SEC100-1268"),
    membership(ECON, "1268-UCONN-ECON-1201-SEC010-5757", "ECON-1201-Principles of Microeconomics-SEC010-1268"),
    membership(SOCI, "1268-UCONN-SOCI-1501-SEC005-1068", "SOCI-1501-Race, Class, and Gender-SEC005-1268"),
  ],
};

const row = (n: number, score: number | null) => ({
  columnId: `_${3000 + n}_1`,
  column: { id: `_${3000 + n}_1`, effectiveColumnName: `Homework ${n}` },
  status: score === null ? "NEEDS_GRADING" : "GRADED",
  pointsPossible: 10,
  displayGrade: score === null ? {} : { score },
  lastAttempt: { status: "COMPLETED" },
});
/** MATH's gradebook: 35 items, in two pages; three of them scored. ECON has none; SOCI two, one scored. */
const GRADEBOOKS: Record<string, ReturnType<typeof row>[]> = {
  [MATH]: Array.from({ length: 35 }, (_, i) => row(i + 1, i < 3 ? 9 : null)),
  [ECON]: [],
  [SOCI]: [row(101, 8), row(102, null)],
};

type Trouble = {
  /** These courses' gradebooks are refused. */
  refused?: string[];
  /** Asking for this course's gradebook finds the student signed out. */
  signedOutAt?: string;
};

function huskyctData(trouble: Trouble, asked: string[]) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return async (path: string) => {
    asked.push(path);
    if (path.startsWith("/learn/api/v1/users/me/memberships")) return json(MEMBERSHIPS);
    if (path === "/learn/api/v1/users/me") return json({ id: ME });
    const match = /^\/learn\/api\/v1\/courses\/([^/]+)\/gradebook\/grades\?userId=_1003488_1&limit=25&offset=(\d+)/.exec(path);
    if (!match) return json({}, 404);
    const [, course, offset] = match;
    if (trouble.signedOutAt === course) return json({ status: 401 }, 401);
    if (trouble.refused?.includes(course)) return json({}, 500);
    const all = GRADEBOOKS[course] ?? [];
    const start = Number(offset);
    const next = start + 25 < all.length ? `/learn/api/v1/courses/${course}/gradebook/grades?userId=${ME}&limit=25&offset=${start + 25}` : "";
    return json({ paging: { count: all.length, nextPage: next }, results: all.slice(start, start + 25) });
  };
}

function openHuskyct(trouble: Trouble = {}) {
  const window = new Window({ url: "https://lms.uconn.edu/ultra/stream" });
  onlyAtHuskyct(window);
  windows.push(window);
  window.document.body.innerHTML = "<main><p>Activity stream</p></main>";
  window.localStorage.clear();
  const asked: string[] = [];
  (window as unknown as { fetch: unknown }).fetch = huskyctData(trouble, asked);
  const sandbox = { window, document: window.document, navigator: window.navigator, localStorage: window.localStorage, Blob, CompressionStream, Response, TextEncoder, btoa, URL, console, setTimeout, clearTimeout };
  // The sync that starts on its own when HuskyCT opens is tested on its own; here it would run in the middle of the tests.
  window.localStorage.setItem("huskypilot.helper.sync.v1", JSON.stringify({ auto: false }));
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  const helper = (window as unknown as { __huskyctHelper: Helper }).__huskyctHelper;
  helper.setLocale("en");
  let moved = 0;
  window.addEventListener("popstate", () => moved++);
  return { window, helper, asked, moved: () => moved };
}

const FAST = { gap: 0 };

// --- the walk --------------------------------------------------------------------------

test("every course's gradebook is read, all its pages, empty courses included, and no page is opened", async () => {
  const { window, helper, moved } = openHuskyct();

  const manifest = plain(await helper.collectGrades(FAST));

  assert.equal(manifest.term, "Fall 2026");
  assert.deepEqual(manifest.problems, []);
  assert.deepEqual(manifest.courses.map((course) => [course.code, course.items.length, course.skipped]), [
    ["MATH 1070Q", 35, false],
    ["ECON 1201", 0, false],
    ["SOCI 1501", 2, false],
  ]);
  // Both pages, in HuskyCT's order, each row once.
  const math = manifest.courses[0].items;
  assert.equal(math[25].title, "Homework 26");
  assert.equal(new Set(math.map((item) => item.id)).size, 35);
  assert.deepEqual(plain(helper.gradesSummary(manifest)), { courses: 3, items: 37, scored: 4 });
  assert.equal(moved(), 0, "a page was opened");
  assert.equal(window.location.pathname, "/ultra/stream");
});

test("a gradebook HuskyCT will not give is left out and named, and its page is not read instead", async () => {
  const { helper, moved } = openHuskyct({ refused: [ECON] });

  const manifest = plain(await helper.collectGrades(FAST));

  assert.deepEqual(manifest.courses.map((course) => [course.code, course.skipped]), [
    ["MATH 1070Q", false],
    ["ECON 1201", true],
    ["SOCI 1501", false],
  ]);
  assert.deepEqual(manifest.problems, [{ key: "problemGrades", params: { courses: "ECON 1201" } }]);
  assert.match(helper.problemsText(manifest.problems), /^Self-check: these courses' grades could not be read completely: ECON 1201/);
  // What was not read is not sent, so it cannot replace what the app has.
  const sent = plain(helper.gradesSnapshotFrom(manifest)) as { courses: Array<{ code: string }> };
  assert.deepEqual(sent.courses.map((course) => course.code), ["MATH 1070Q", "SOCI 1501"]);
  assert.equal(moved(), 0);
});

test("stopping keeps what was read so far", async () => {
  const { helper } = openHuskyct();
  let checks = 0;

  const manifest = plain(await helper.collectGrades({ ...FAST, shouldStop: () => checks++ >= 1 }));

  assert.equal(manifest.stopped, true);
  assert.deepEqual(manifest.courses.map((course) => course.code), ["MATH 1070Q"]);
});

test("when HuskyCT says the student is signed out, the walk stops there and says so", async () => {
  const { helper, asked } = openHuskyct({ signedOutAt: ECON });

  const manifest = plain(await helper.collectGrades(FAST));

  assert.equal(manifest.signedOut, true);
  assert.deepEqual(manifest.problems, [{ key: "problemSignedOut" }]);
  // Courses before it are kept; the ones after are not asked for.
  assert.deepEqual(manifest.courses.map((course) => course.code), ["MATH 1070Q", "ECON 1201"]);
  assert.ok(!asked.some((path) => path.includes(SOCI)), "kept asking after the sign-out");
  assert.match(helper.problemsText(manifest.problems), /sign in again/);
  helper.setLocale("zh-CN");
  assert.match(helper.problemsText(manifest.problems), /重新登录/);
  helper.setLocale("en");
});

// --- into BetterHuskyCT ------------------------------------------------------------------

/**
 * The app's Grades page, as far as the helper can tell: its real receiver (the
 * code the page runs), fed what the helper posts, answering back into the
 * helper's window as a message from the app's origin.
 */
function appTab(window: Window, store: GradesStore = memoryGradesStore()) {
  const receive = createGradesReceiver({ store });
  const posted: Array<{ kind: unknown; origin: string }> = [];
  const target = {
    postMessage(message: unknown, origin: string) {
      posted.push({ kind: (message as { kind?: unknown }).kind, origin });
      void receive({
        origin: "https://lms.uconn.edu",
        data: message,
        source: {
          postMessage(reply: unknown) {
            window.dispatchEvent(new window.MessageEvent("message", { data: reply, origin: "https://betterhuskyct.vercel.app" }));
          },
        },
      });
    },
  };
  return { store, target, posted };
}

const SEND = { helloEvery: 20, connectTimeout: 500, storedTimeout: 500 };

test("sent to BetterHuskyCT: the app keeps exactly what was read", async () => {
  const { window, helper } = openHuskyct();
  const manifest = plain(await helper.collectGrades(FAST));
  const app = appTab(window);

  const result = plain(await helper.sendGradesToBhc(app.target, manifest, SEND));

  assert.deepEqual(result, { connected: true, stored: true, courses: 3, items: 37 });
  assert.ok(app.posted.every((post) => post.origin === "https://betterhuskyct.vercel.app"), "posted to another origin");
  const stored = await app.store.get();
  assert.deepEqual(stored?.courses.map((course) => [course.code, course.items.length]), [
    ["ECON 1201", 0],
    ["MATH 1070Q", 35],
    ["SOCI 1501", 2],
  ]);
  assert.equal(stored?.term, "Fall 2026");
  // What the helper sends passes the app's own strict reader untouched.
  assert.ok(parseGradesSnapshot(plain(helper.gradesSnapshotFrom(manifest))), "the app would drop what the helper sends");
});

test("a second reading updates its courses and leaves the others", async () => {
  const { window, helper } = openHuskyct({ refused: [ECON] });
  const app = appTab(window);
  const first = plain(await helper.collectGrades(FAST));
  await helper.sendGradesToBhc(app.target, first, SEND);

  // ECON's gradebook was refused this time; MATH's rows are the ones sent.
  const stored = await app.store.get();
  assert.deepEqual(stored?.courses.map((course) => course.code), ["MATH 1070Q", "SOCI 1501"]);

  await app.store.put({ ...stored!, courses: [...stored!.courses, { id: ECON, code: "ECON 1201", items: [] }] });
  await helper.sendGradesToBhc(app.target, first, SEND);
  assert.deepEqual((await app.store.get())?.courses.map((course) => course.code), ["ECON 1201", "MATH 1070Q", "SOCI 1501"]);
});

test("an app that never answers is reported, not waited on forever", async () => {
  const { helper } = openHuskyct();
  const manifest = plain(await helper.collectGrades(FAST));
  const nobody = { postMessage() {} };

  const result = plain(await helper.sendGradesToBhc(nobody, manifest, { ...SEND, connectTimeout: 100 }));

  assert.deepEqual(result, { connected: false, stored: false, courses: 0, items: 0 });
});

test("an app that cannot keep the grades says so", async () => {
  const { window, helper } = openHuskyct();
  const manifest = plain(await helper.collectGrades(FAST));
  const failing: GradesStore = {
    get: async () => null,
    put: async () => {
      throw new Error("quota");
    },
    clear: async () => undefined,
  };

  const result = plain(await helper.sendGradesToBhc(appTab(window, failing).target, manifest, SEND));

  assert.equal(result.connected, true);
  assert.equal(result.stored, false);
});

test("a reply from any other page is ignored", async () => {
  const { window, helper } = openHuskyct();
  const manifest = plain(await helper.collectGrades(FAST));
  const impostor = {
    postMessage(message: unknown) {
      const data = message as { kind?: string };
      if (data.kind === "hello") {
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: { protocol: "betterhuskyct/grades@1", kind: "ready" },
            origin: "https://evil.example",
          }),
        );
      }
    },
  };

  const result = plain(await helper.sendGradesToBhc(impostor, manifest, { ...SEND, connectTimeout: 200 }));

  assert.equal(result.connected, false);
});
