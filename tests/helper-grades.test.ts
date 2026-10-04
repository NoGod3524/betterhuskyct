import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

import { createGradesReceiver, memoryGradesStore, parseGradesSnapshot, type GradesStore } from "../src/lib/grades.ts";

/**
 * "Collect grades", run as shipped on pages shaped like the live HuskyCT ones,
 * measured on 2026-09-28:
 *
 * - A gradebook row is `[data-grade-id]` with the item's link, an optional line
 *   under it, and a score in three spans — or "Not graded".
 * - Twenty-five rows to a page; Next is disabled on the last, Previous on the first.
 * - A course with no work shows a picture inside the loaded wrapper, not rows.
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
  readGradeRow: (row: unknown) => Item | null;
  pagerState: () => { page: number; pages: number } | null;
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

// --- the fake HuskyCT ----------------------------------------------------------------

const MATH = "_203765_1";
const ECON = "_198430_1";
const SOCI = "_201463_1";
const NEXT = "course.student.grade.components.common.pagination.pageUpButton";
const PREVIOUS = "course.student.grade.components.common.pagination.pageDownButton";

type RowOptions = { status?: string; score?: [number, number]; label?: string };

/** A gradebook row, marked up as the live page marks it. */
function gradeRow(id: string, title: string, options: RowOptions = {}) {
  const description = options.status ? `<div><div data-testid="item-description">${options.status}</div></div>` : "";
  const result = options.score
    ? `<div><div><span aria-hidden="true"><span>${options.score[0]}</span><span>/</span><span>${options.score[1]}</span></span>` +
      `<div>Final Grade: ${options.score[0]} points out of ${options.score[1]} points possible</div></div></div>` +
      `<div><button tabindex="0" type="button" data-analytics-id="components.directives.grade.course-grades-student.results.button">View</button></div>`
    : `<div><div><span>${options.label ?? "Not graded"}</span></div></div><div></div>`;
  return (
    `<div data-grade-id="${id}"><div><div></div><span></span><div>` +
    `<div><a href="#" id="course-student-grades-item-name-${id}" data-analytics-id="course.student.grade.card.table.item.link"><div>${title}</div></a></div>` +
    description +
    result +
    `</div></div></div>`
  );
}

const pager = (page: number, pages: number) =>
  `<button aria-label="Previous Page" data-analytics-id="${PREVIOUS}"${page === 1 ? " disabled" : ""}></button>` +
  `<button aria-label="Page ${page} of ${pages}" data-analytics-id="course.student.grade.components.common.pagination.pageSelectDropdown.button">${page}</button>` +
  `<button aria-label="Next Page" data-analytics-id="${NEXT}"${page === pages ? " disabled" : ""}></button>`;

const loaded = (inside: string) => `<div bb-load-bundle="components/directives/grade/course-grades-student">${inside}</div>`;

/** MATH: 35 rows, so two pages of 25 and 10. */
function mathRow(i: number) {
  const id = `_${3000 + i}_1`;
  if (i === 1) return gradeRow(id, "Section 4.1 Homework", { status: "1 attempt submitted (1 Late)", score: [81.3, 100] });
  if (i === 2) return gradeRow(id, "Section 4.2 Homework", { status: "1 attempt submitted", score: [105, 100] });
  if (i === 3) return gradeRow(id, "Practice Test for Ch 4", { status: "Attempt 2 started", score: [0, 0] });
  if (i === 30) return gradeRow(id, "Exam 1: Chapter 4(Content isn't available)", { label: "Exempt" });
  return gradeRow(id, `Homework ${i}`);
}
const mathPage = (page: number, withPager = true) => {
  const from = page === 1 ? 1 : 26;
  const to = page === 1 ? 25 : 35;
  let rows = "";
  for (let i = from; i <= to; i++) rows += mathRow(i);
  return loaded(rows + (withPager ? pager(page, 2) : ""));
};

const LOGIN_PAGE = `<form id="loginFormDiv"><input name="user_id"></form>`;

const SOCI_PAGE = loaded(
  gradeRow("_4001_1", "EA 1: When Did You First Realize You Had a Race?", { status: "First participated on 9/22/26", score: [10, 10] }) +
    gradeRow("_4002_1", "EA 12: Assimilation: Into What?", { status: "No participation (Late)", score: [5, 10] }) +
    pager(1, 1),
);
const ECON_PAGE = loaded(`<div><img src="./static/images/ftue/ftuMMicon_StudentNoGrades.png" alt=""><h1>Kick back and relax for now!</h1></div>`);

const COURSE_CARDS =
  `<article class="element-card" data-course-id="${MATH}"><span>1268-UCONN-MATH-1070Q-SEC100-1191</span><h4>MATH-1070Q-Mathematics for Business and Economics-SEC100-1268</h4></article>` +
  `<article class="element-card" data-course-id="${ECON}"><span>1268-UCONN-ECON-1201-SEC010-5757</span><h4>ECON-1201-Principles of Microeconomics-SEC010-1268</h4></article>` +
  `<article class="element-card" data-course-id="${SOCI}"><span>1268-UCONN-SOCI-1501-SEC005-1068</span><h4>SOCI-1501-Race, Class, and Gender-SEC005-1268</h4></article>`;

const TITLES: Record<string, string> = {
  [MATH]: "Gradebook / MATH-1070Q-SEC100.120-1268",
  [ECON]: "Gradebook / ECON-1201-Principles of Microeconomics-SEC010-1268",
  [SOCI]: "Gradebook / SOCI-1501-Race, Class, and Gender-SEC005-1268",
};

type Trouble = {
  neverLoads?: string[];
  noSecondPage?: boolean;
  /** MATH's rows draw first and its pager this many ms later, as on a slow day. */
  slowPager?: number;
  /** The first time each of these is opened it draws nothing; the second time it is fine. */
  failFirstLoad?: string[];
  /** The first press of Next is lost. */
  ignoreFirstNext?: boolean;
  /** Opening this course sends the tab to the sign-in page. */
  signedOutAt?: string;
};

function fakeHuskyct(window: Window, visited: string[], trouble: Trouble = {}) {
  const main = window.document.querySelector("main")!;
  let generation = 0;
  const opened = new Map<string, number>();
  let presses = 0;
  window.addEventListener("popstate", () => {
    const path = window.location.pathname;
    visited.push(path);
    const mine = ++generation;
    // The previous page stays up for a while under the new address.
    const render = (html: string, title?: string) =>
      setTimeout(() => {
        if (mine !== generation) return;
        main.innerHTML = html;
        if (title) window.document.title = title;
      }, 60);
    const grades = /^\/ultra\/courses\/(_\d+_\d+)\/grades$/.exec(path);
    if (path === "/ultra/course") render(COURSE_CARDS);
    else if (grades && trouble.neverLoads?.includes(grades[1])) render(`<p>${path}</p>`);
    else if (grades && trouble.signedOutAt === grades[1]) render(LOGIN_PAGE);
    else if (grades && trouble.failFirstLoad?.includes(grades[1]) && !opened.has(grades[1])) {
      opened.set(grades[1], 1);
      render(`<p>${path}</p>`);
    } else if (grades && grades[1] === MATH && trouble.slowPager) {
      render(mathPage(1, false), TITLES[MATH]);
      setTimeout(() => {
        if (mine === generation) main.querySelector("[bb-load-bundle]")?.insertAdjacentHTML("beforeend", pager(1, 2));
      }, 60 + trouble.slowPager);
    } else if (grades && grades[1] === MATH) render(mathPage(1), TITLES[MATH]);
    else if (grades && grades[1] === ECON) render(ECON_PAGE, TITLES[ECON]);
    else if (grades && grades[1] === SOCI) render(SOCI_PAGE, TITLES[SOCI]);
    else render(`<p>${path}</p>`);
  });

  window.document.addEventListener("click", (event) => {
    const target = event.target as unknown as HTMLButtonElement;
    if (target.getAttribute?.("data-analytics-id") !== NEXT || target.disabled || trouble.noSecondPage) return;
    if (trouble.ignoreFirstNext && presses++ === 0) return;
    setTimeout(() => {
      main.innerHTML = mathPage(2);
    }, 30);
  });
}

function openPage() {
  const window = new Window({ url: "https://lms.uconn.edu/ultra/stream" });
  windows.push(window);
  window.document.body.innerHTML = "<main><p>Activity stream</p></main>";
  window.localStorage.clear();
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
  const helper = (window as unknown as { __huskyctHelper: Helper }).__huskyctHelper;
  helper.setLocale("en");
  return { window, helper };
}

function openHuskyct(trouble: Trouble = {}) {
  const page = openPage();
  const visited: string[] = [];
  fakeHuskyct(page.window, visited, trouble);
  return { ...page, visited };
}

const FAST = { every: 20, pageTimeout: 500, settle: 40, gap: 0 };

// --- reading rows --------------------------------------------------------------------

test("a row reads as its title, its line, and a score or what is shown instead", () => {
  const { window, helper } = openPage();
  const page = new Window({ url: "https://lms.uconn.edu/ultra/courses/_1_1/grades" });
  windows.push(page);
  page.document.body.innerHTML =
    gradeRow("_1_1", "Scored", { status: "1 attempt submitted", score: [81.3, 100] }) +
    gradeRow("_2_1", "Not scored") +
    gradeRow("_3_1", "Lettered", { label: "B+" }) +
    gradeRow("_4_1", "Zero of zero", { score: [0, 0] }) +
    gradeRow("_5_1", "Huge", { score: [99999999, 100] }) +
    `<div data-grade-id="not-an-id"><a id="course-student-grades-item-name-x"><div>Bad id</div></a></div>` +
    `<div data-grade-id="_6_1"><span>No title</span></div>`;
  const rows = [...page.document.querySelectorAll("[data-grade-id]")];

  const read = rows.map((row) => plain(helper.readGradeRow(row)));

  assert.deepEqual(read[0], { id: "_1_1", title: "Scored", status: "1 attempt submitted", earned: 81.3, possible: 100, label: null });
  assert.deepEqual(read[1], { id: "_2_1", title: "Not scored", status: null, earned: null, possible: null, label: "Not graded" });
  assert.equal(read[2]?.label, "B+");
  assert.deepEqual([read[3]?.earned, read[3]?.possible], [0, 0]);
  // Points beyond what the app accepts are shown as words, not as a score.
  assert.equal(read[4]?.earned, null);
  assert.equal(read[5], null, "a row without a HuskyCT id was read");
  assert.equal(read[6], null, "a row without a title was read");
  assert.ok(window);
});

// --- walking the gradebooks ------------------------------------------------------------

test("every course's gradebook is read, all its pages, empty courses included", async () => {
  const { window, helper, visited } = openHuskyct();

  const manifest = plain(await helper.collectGrades(FAST));

  assert.equal(manifest.term, "Fall 2026");
  assert.deepEqual(manifest.problems, []);
  assert.deepEqual(manifest.courses.map((course) => [course.code, course.items.length, course.skipped]), [
    ["MATH 1070Q", 35, false],
    ["ECON 1201", 0, false],
    ["SOCI 1501", 2, false],
  ]);

  const math = manifest.courses[0].items;
  // Both pages, in the order HuskyCT lists them, each row once.
  assert.equal(math[0].title, "Section 4.1 Homework");
  assert.equal(math[25].title, "Homework 26");
  assert.equal(new Set(math.map((item) => item.id)).size, 35);
  assert.deepEqual(math[0], { id: "_3001_1", title: "Section 4.1 Homework", status: "1 attempt submitted (1 Late)", earned: 81.3, possible: 100, label: null });
  assert.deepEqual([math[2].earned, math[2].possible], [0, 0]);
  assert.equal(math[29].label, "Exempt");
  assert.equal(math[34].label, "Not graded");

  // SOCI came after MATH: nothing of MATH's page, which lingers, is in it.
  const soci = manifest.courses[2].items;
  assert.deepEqual(soci.map((item) => item.id), ["_4001_1", "_4002_1"]);
  assert.equal(soci[0].status, "First participated on 9/22/26");

  assert.deepEqual(plain(helper.gradesSummary(manifest)), { courses: 3, items: 37, scored: 5 });
  assert.equal(window.location.pathname, "/ultra/stream", "it did not go back to where it started");
  assert.ok(visited.includes(`/ultra/courses/${MATH}/grades`));
});

test("a gradebook that never shows is left out, and reported", async () => {
  const { helper } = openHuskyct({ neverLoads: [ECON] });

  const manifest = plain(await helper.collectGrades(FAST));

  assert.deepEqual(manifest.courses.map((course) => [course.code, course.skipped]), [
    ["MATH 1070Q", false],
    ["ECON 1201", true],
    ["SOCI 1501", false],
  ]);
  // The course is named, and so is what the page showed when it would not open.
  assert.equal(manifest.problems.length, 1);
  assert.equal(manifest.problems[0].key, "problemGrades");
  const named = String((manifest.problems[0].params as { courses: string }).courses);
  assert.match(named, /^ECON 1201 \[ECON 1201: path=\/ultra\/courses\/\S+\/grades rows=0 empty=0 pager=no hidden=(yes|no) signin=no title="/);
  assert.match(helper.problemsText(manifest.problems), /^Self-check: these courses' grades did not open completely: ECON 1201 \[/);
  // What was not read is not sent, so it cannot replace what the app has.
  const sent = plain(helper.gradesSnapshotFrom(manifest)) as { courses: Array<{ code: string }> };
  assert.deepEqual(sent.courses.map((course) => course.code), ["MATH 1070Q", "SOCI 1501"]);
});

test("a gradebook whose next page never comes is left out rather than sent half-read", async () => {
  const { helper } = openHuskyct({ noSecondPage: true });

  const manifest = plain(await helper.collectGrades(FAST));

  const math = manifest.courses.find((course) => course.code === "MATH 1070Q")!;
  assert.equal(math.skipped, true);
  assert.deepEqual(manifest.problems, [{ key: "problemGrades", params: { courses: "MATH 1070Q (page 1/2)" } }]);
  assert.deepEqual((plain(helper.gradesSnapshotFrom(manifest)) as { courses: unknown[] }).courses.length, 2);
});

test("stopping keeps what was read so far", async () => {
  const { helper } = openHuskyct();
  let checks = 0;

  const manifest = plain(await helper.collectGrades({ ...FAST, shouldStop: () => checks++ >= 1 }));

  assert.equal(manifest.stopped, true);
  assert.deepEqual(manifest.courses.map((course) => course.code), ["MATH 1070Q"]);
});

test("a pager that draws late does not make a two-page gradebook look like one page", async () => {
  // Rows first, the pager (and so its enabled Next) a moment later: the walk used to
  // see no enabled Next, call page 1 the last, and report 25 of 35 rows as complete.
  const { helper } = openHuskyct({ slowPager: 700 });

  const manifest = plain(await helper.collectGrades({ ...FAST, pageTimeout: 2000 }));

  const math = manifest.courses.find((course) => course.code === "MATH 1070Q")!;
  assert.equal(math.items.length, 35, "rows were lost to a slow pager");
  assert.equal(math.skipped, false);
  assert.deepEqual(manifest.problems, []);
});

test("a gradebook that fails to draw the first time is tried once more", async () => {
  const { helper } = openHuskyct({ failFirstLoad: [SOCI] });

  const manifest = plain(await helper.collectGrades({ ...FAST, retryPause: 20 }));

  const soci = manifest.courses.find((course) => course.code === "SOCI 1501")!;
  assert.equal(soci.skipped, false, "one slow load lost a whole course");
  assert.equal(soci.items.length, 2);
  assert.deepEqual(manifest.problems, []);
});

test("a press of Next that is lost is pressed again", async () => {
  const { helper } = openHuskyct({ ignoreFirstNext: true });

  const manifest = plain(await helper.collectGrades({ ...FAST, pageTimeout: 800 }));

  const math = manifest.courses.find((course) => course.code === "MATH 1070Q")!;
  assert.equal(math.items.length, 35);
  assert.equal(math.skipped, false);
});

test("a course that never draws is tried twice, then named, and the others are still read", async () => {
  const { helper } = openHuskyct({ neverLoads: [ECON] });

  const manifest = plain(await helper.collectGrades({ ...FAST, retryPause: 20 }));

  assert.equal(manifest.problems.length, 1);
  assert.match(String((manifest.problems[0].params as { courses: string }).courses), /^ECON 1201 \[ECON 1201: path=/);
  assert.equal(manifest.courses.find((course) => course.code === "SOCI 1501")?.items.length, 2);
});

test("when HuskyCT asks for the sign-in again, the walk stops there and says so", async () => {
  const { helper } = openHuskyct({ signedOutAt: ECON });

  const manifest = plain(await helper.collectGrades({ ...FAST, retryPause: 20 }));

  assert.equal(manifest.signedOut, true);
  assert.deepEqual(manifest.problems, [{ key: "problemSignedOut" }]);
  // Courses before it are kept; the ones after were not tried, not timed out one by one.
  assert.deepEqual(manifest.courses.map((course) => course.code), ["MATH 1070Q", "ECON 1201"]);
  assert.match(helper.problemsText(manifest.problems), /sign in again/);
  helper.setLocale("zh-CN");
  assert.match(helper.problemsText(manifest.problems), /重新登录/);
  helper.setLocale("en");
});

test("the pager's label is read for the page and the page count, in any language", () => {
  const { window, helper } = openPage();
  const read = (label: string | null) => {
    window.document.body.innerHTML =
      label === null
        ? "<main></main>"
        : `<button data-analytics-id="course.student.grade.components.common.pagination.pageSelectDropdown.button" aria-label="${label}">1</button>`;
    return plain(helper.pagerState());
  };

  assert.deepEqual(read("Page 1 of 2"), { page: 1, pages: 2 });
  assert.deepEqual(read("Page 3 of 12"), { page: 3, pages: 12 });
  assert.deepEqual(read("第 2 页，共 5 页"), { page: 2, pages: 5 });
  // Not drawn yet, or drawn without numbers: no answer, so the walk waits rather than guesses.
  assert.equal(read(null), null);
  assert.equal(read("Page"), null);
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
  const { window, helper } = openHuskyct({ neverLoads: [ECON] });
  const app = appTab(window);
  const first = plain(await helper.collectGrades(FAST));
  await helper.sendGradesToBhc(app.target, first, SEND);

  // ECON's gradebook did not open this time; MATH's rows are the ones sent.
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
