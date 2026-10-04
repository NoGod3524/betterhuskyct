import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

/**
 * The quick sync: courses, announcements and grades from HuskyCT's own data, with no page
 * opened. What matters is that a course it cannot read this way is skipped and never read
 * from its page, because reading a page would take the screen away from the student.
 */
const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");

type Sync = {
  ok: boolean;
  courses: number;
  announcements: number;
  gradeItems: number;
  skipped: string[];
  stopped: boolean;
  grades: { courses: Array<{ code: string | null; skipped: boolean; items: unknown[] }> } | null;
};
type State = { at: string | null; auto: boolean; pending: boolean; grades: unknown };
type Tab = { postMessage: (message: unknown, origin: string) => void; closed?: boolean; location?: { href: string }; close?: () => void };
type Helper = {
  syncLight: (options?: Record<string, unknown>) => Promise<Sync>;
  readSyncState: (storage: unknown) => State;
  writeSyncState: (storage: unknown, state: unknown) => void;
  autoSyncDue: (state: State, now: Date) => boolean;
  deliverSync: (tab: Tab, basket: unknown, grades: unknown, timing?: Record<string, unknown>) => Promise<{ parts: string[]; failed: boolean }>;
  findBhcTab: () => Tab | null;
  readBasket: (storage: unknown) => { courses: Array<{ id: string; announcements: Array<{ title: string }>; announcementsAt: string | null }> };
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function openPage(serve: (path: string) => Promise<Response>, open?: (link: string, target: string) => unknown) {
  const window = new Window({ url: "https://lms.uconn.edu/ultra/stream" });
  windows.push(window);
  window.localStorage.clear();
  window.sessionStorage.clear();
  (window as unknown as { fetch: unknown }).fetch = serve;
  const opened: string[] = [];
  (window as unknown as { open: unknown }).open = (link: string, target: string) => {
    opened.push(target);
    return open ? open(link, target) : null;
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
  // This is the quick sync's own test; the one that starts when the page opens would only get in the way.
  window.localStorage.setItem("huskypilot.helper.sync.v1", JSON.stringify({ auto: false }));
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  let moved = 0;
  window.addEventListener("popstate", () => moved++);
  return { window, helper: (window as unknown as { __huskyctHelper: Helper }).__huskyctHelper, opened, moved: () => moved };
}

const membership = (id: string, displayName: string, courseId: string) => ({
  courseId: id,
  isAvailable: true,
  userHasHidden: false,
  course: { id, courseId, displayName, isOrganization: false, isAvailable: true, effectiveAvailability: true },
});
const MATH = "_203765_1";
const ECON = "_198430_1";
const LIST = {
  paging: { count: 2, nextPage: "" },
  results: [
    membership(MATH, "MATH-1070Q-Mathematics for Business and Economics-SEC100-1268", "1268-UCONN-MATH-1070Q-SEC100-1191"),
    membership(ECON, "ECON-1201-Principles of Microeconomics-SEC010-1268", "1268-UCONN-ECON-1201-SEC010-5757"),
  ],
};
const ANNOUNCEMENT = { title: "Exam moved", body: { displayText: "<p>Friday</p>" }, startDateRestriction: "2026-09-22T13:00:00.000Z", isDraft: false };
const GRADE = {
  columnId: "_3876640_1",
  column: { id: "_3876640_1", effectiveColumnName: "Quiz 1" },
  status: "GRADED",
  pointsPossible: 100,
  displayGrade: { score: 90 },
};

/** HuskyCT's data, with the parts a test wants to go wrong able to be switched off. */
function data(fail: { announcements?: string[]; grades?: string[]; list?: boolean; me?: boolean } = {}) {
  return async (path: string) => {
    if (path.startsWith("/learn/api/v1/users/me/memberships")) return fail.list ? new Response("{}", { status: 500 }) : json(LIST);
    if (path === "/learn/api/v1/users/me") return fail.me ? new Response("{}", { status: 500 }) : json({ id: "_1003488_1" });
    const course = /courses\/([^/]+)\//.exec(path)?.[1] ?? "";
    if (path.includes("/announcements")) {
      return fail.announcements?.includes(course) ? new Response("{}", { status: 500 }) : json({ paging: { nextPage: "" }, results: course === MATH ? [ANNOUNCEMENT] : [] });
    }
    if (path.includes("/gradebook/grades")) {
      return fail.grades?.includes(course) ? new Response("{}", { status: 500 }) : json({ paging: { count: course === MATH ? 1 : 0, nextPage: "" }, results: course === MATH ? [GRADE] : [] });
    }
    return new Response("{}", { status: 404 });
  };
}

test("a sync reads the courses, their announcements and their grades, and opens no page", async () => {
  const { window, helper, opened, moved } = openPage(data());

  const out = plain(await helper.syncLight());

  assert.equal(out.ok, true);
  assert.deepEqual([out.courses, out.announcements, out.gradeItems, out.skipped], [2, 1, 1, []]);
  assert.deepEqual(out.grades?.courses.map((course) => [course.code, course.skipped, course.items.length]), [["MATH 1070Q", false, 1], ["ECON 1201", false, 0]]);
  assert.deepEqual(plain(helper.readBasket(window.localStorage)).courses.find((course) => course.id === MATH)?.announcements.map((a) => a.title), ["Exam moved"]);
  assert.equal(moved(), 0, "a page was opened");
  assert.equal(opened.length, 0);
  assert.equal(window.location.pathname, "/ultra/stream");
});

test("a course whose data cannot be read is skipped and named, never read from its page", async () => {
  const { helper, moved } = openPage(data({ announcements: [ECON], grades: [ECON] }));

  const out = plain(await helper.syncLight());

  assert.equal(out.ok, true, "the course that did read was thrown away with the one that did not");
  assert.deepEqual(out.skipped, ["ECON 1201"]);
  // The gradebook of the course that failed is marked unread, so it cannot replace what the app holds.
  assert.deepEqual(out.grades?.courses.map((course) => [course.code, course.skipped]), [["MATH 1070Q", false], ["ECON 1201", true]]);
  assert.equal(moved(), 0, "it fell back to opening a page");
});

test("with no course list, or nothing readable, a sync is not ok, and still opens no page", async () => {
  const noList = openPage(data({ list: true }));
  assert.equal((await noList.helper.syncLight()).ok, false);
  assert.equal(noList.moved(), 0, "it went to the Courses page");

  const nothing = openPage(data({ announcements: [MATH, ECON], me: true }));
  assert.equal((await nothing.helper.syncLight()).ok, false);
  assert.equal(nothing.moved(), 0);
});

test("without the student's id the announcements still come, and no gradebook is claimed", async () => {
  const { helper } = openPage(data({ me: true }));

  const out = plain(await helper.syncLight());

  assert.equal(out.ok, true);
  assert.equal(out.announcements, 1);
  assert.equal(out.grades, null);
});

test("a sync stops when asked, keeping what it had read", async () => {
  const { window, helper } = openPage(data());
  let checks = 0;

  const out = plain(await helper.syncLight({ shouldStop: () => checks++ >= 1 }));

  assert.equal(out.stopped, true);
  assert.equal(plain(helper.readBasket(window.localStorage)).courses.find((course) => course.id === MATH)?.announcements.length, 1);
});

test("the saved sync state is read back, and a damaged one reads as the start", () => {
  const { window, helper } = openPage(data());
  const storage = window.localStorage;
  helper.writeSyncState(storage, { at: "2026-10-04T10:00:00.000Z", auto: false, pending: true, grades: { courses: [] } });

  assert.deepEqual(plain(helper.readSyncState(storage)), { at: "2026-10-04T10:00:00.000Z", auto: false, pending: true, grades: { courses: [] } });

  storage.setItem("huskypilot.helper.sync.v1", "{not json");
  assert.deepEqual(plain(helper.readSyncState(storage)), { at: null, auto: true, pending: false, grades: null });
  storage.setItem("huskypilot.helper.sync.v1", JSON.stringify({ at: "not a time", auto: "yes", grades: { courses: "no" } }));
  assert.deepEqual(plain(helper.readSyncState(storage)), { at: null, auto: true, pending: false, grades: null });
});

test("an automatic sync is due when it is on and none ran in the last six hours", () => {
  const { helper } = openPage(data());
  const now = new Date("2026-10-04T12:00:00.000Z");
  const state = (over: Partial<State>): State => ({ at: null, auto: true, pending: false, grades: null, ...over });

  assert.equal(helper.autoSyncDue(state({}), now), true, "never synced");
  assert.equal(helper.autoSyncDue(state({ at: "2026-10-04T05:59:00.000Z" }), now), true, "over six hours ago");
  assert.equal(helper.autoSyncDue(state({ at: "2026-10-04T06:01:00.000Z" }), now), false, "within six hours");
  assert.equal(helper.autoSyncDue(state({ auto: false }), now), false, "switched off");
});

test("the earlier BetterHuskyCT tab is looked for only if this tab opened one, and a blank one that comes back is shut", () => {
  // Never opened one: nothing is tried, so no popup is attempted or flagged.
  const never = openPage(data(), () => ({}));
  assert.equal(never.helper.findBhcTab(), null);
  assert.equal(never.opened.length, 0, "tried to open a tab with no press");

  // Opened one, and it is still there (another origin's address cannot be read).
  const stillThere = { get location(): never { throw new Error("another origin"); }, closed: false, postMessage() {} };
  const there = openPage(data(), () => stillThere);
  there.window.sessionStorage.setItem("huskypilot.helper.bhcOpened", "1");
  assert.equal(there.helper.findBhcTab(), stillThere);

  // Opened one, but it was closed: the browser gives a blank tab back, which is shut, and the flag is cleared.
  let shut = false;
  const blank = { location: { href: "about:blank" }, closed: false, postMessage() {}, close: () => { shut = true; } };
  const gone = openPage(data(), () => blank);
  gone.window.sessionStorage.setItem("huskypilot.helper.bhcOpened", "1");
  assert.equal(gone.helper.findBhcTab(), null);
  assert.equal(shut, true, "the blank tab was left open");
  assert.equal(gone.window.sessionStorage.getItem("huskypilot.helper.bhcOpened"), null);

  // The browser refused: no tab, flag cleared.
  const refused = openPage(data(), () => null);
  refused.window.sessionStorage.setItem("huskypilot.helper.bhcOpened", "1");
  assert.equal(refused.helper.findBhcTab(), null);
  assert.equal(refused.window.sessionStorage.getItem("huskypilot.helper.bhcOpened"), null);
});

test("delivery reports what arrived and what did not, so a half-sent sync is not called sent", async () => {
  const { window, helper } = openPage(data());
  const basket = { version: 1, courses: [{ id: MATH, code: "MATH 1070Q", announcements: [{ title: "Exam moved", body: "", posted: null, announced: "2026-09-22T13:00:00.000Z" }], announcementsAt: "2026-09-22T13:00:00.000Z" }], todos: [], todosAt: null, dueDates: [], dueDatesAt: null };
  const grades = { term: "Fall 2026", courses: [{ id: MATH, code: "MATH 1070Q", items: [], skipped: false }] };
  // A tab that stores the basket but never answers about the gradebooks.
  const tab: Tab = {
    postMessage(message) {
      const { protocol, kind } = message as { protocol: string; kind: string };
      if (protocol !== "betterhuskyct/tasks@1") return;
      const answer = kind === "hello" ? { protocol, kind: "ready" } : kind === "sync" ? { protocol, kind: "stored", ok: true } : null;
      if (!answer) return;
      const target = window as unknown as { dispatchEvent: (event: unknown) => void; MessageEvent: new (type: string, init: unknown) => unknown };
      setTimeout(() => target.dispatchEvent(new target.MessageEvent("message", { data: answer, origin: "https://betterhuskyct.vercel.app" })), 0);
    },
  };

  const sent = plain(await helper.deliverSync(tab, basket, grades, { connectTimeout: 150, storedTimeout: 150 }));

  assert.equal(sent.parts.length, 1, "the basket arrived");
  assert.equal(sent.failed, true, "the gradebooks never did");
});
