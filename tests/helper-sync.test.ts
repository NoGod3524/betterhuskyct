import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";
import { onlyAtHuskyct } from "./support/huskyct-fetch.ts";

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
  reason: string | null;
  detail: string | null;
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
  readBasket: (storage: unknown) => {
    courses: Array<{ id: string; announcements: Array<{ title: string }>; announcementsAt: string | null }>;
    dueDates?: Array<{ uid: string; title: string; course: string | null; start: string }>;
  };
  readDueDatesApi: (options?: Record<string, unknown>) => Promise<Array<{ uid: string; title: string; course: string | null; courseId: string | null; due: Date }> | null>;
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const pick = (out: Sync) => ({ ok: out.ok, reason: out.reason, detail: out.detail });

function openPage(
  serve: (path: string) => Promise<Response>,
  open?: (link: string, target: string) => unknown,
  mode: { autoSync?: boolean; bookmark?: boolean; timers?: number[] } = {},
) {
  const window = new Window({ url: "https://lms.uconn.edu/ultra/stream" });
  onlyAtHuskyct(window);
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
  window.localStorage.setItem("huskypilot.helper.sync.v1", JSON.stringify({ auto: mode.autoSync === true }));
  if (mode.bookmark) (window as unknown as { __bhcBookmarklet: number }).__bhcBookmarklet = 1;
  if (mode.timers) {
    // Only what the page schedules is wanted, not run: the sync that starts on its own waits a few seconds first.
    (window as unknown as { setTimeout: unknown }).setTimeout = (_run: unknown, ms: number) => mode.timers!.push(ms);
  }
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

const gradable = (title: string, endDate: string, calendarId: string, name: string) => ({
  itemSourceType: "blackboard.platform.gradebook2.GradableItem",
  itemSourceId: "_" + title.length + "_1",
  calendarId,
  calendarNameLocalizable: { rawValue: name },
  title,
  startDate: endDate,
  endDate,
});
const MATH_NAME = "1268-UCONN-MATH-1070Q-SEC100-1191: MATH-1070Q-Mathematics for Business and Economics-SEC100-1268";
const DUE = [
  gradable("Section 5.1 Homework", "2026-10-30T03:59:00.000Z", MATH, MATH_NAME),
  { ...gradable("Lecture", "2026-10-30T14:00:00.000Z", MATH, MATH_NAME), itemSourceType: "blackboard.data.calendar.CalendarEntry" },
  gradable("Final Project", "2026-12-12T04:59:00.000Z", MATH, MATH_NAME),
];

/** HuskyCT's data, with the parts a test wants to go wrong able to be switched off. */
function data(fail: { announcements?: string[]; grades?: string[]; list?: boolean; me?: boolean; calendar?: boolean; paged?: boolean } = {}) {
  return async (path: string) => {
    if (path.startsWith("/learn/api/v1/calendars/calendarItems")) {
      if (fail.calendar) return new Response("{}", { status: 500 });
      if (fail.paged) {
        return path.includes("offset=")
          ? json({ paging: { nextPage: "" }, results: DUE.slice(2) })
          : json({ paging: { nextPage: "/learn/api/v1/calendars/calendarItems?limit=2&offset=2" }, results: DUE.slice(0, 2) });
      }
      return json({ paging: { nextPage: "" }, results: DUE });
    }
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

test("a sync reads the term's due dates from the calendar's data: only what is due, under the uid the view gave", async () => {
  const { window, helper, moved } = openPage(data());

  const out = plain(await helper.syncLight()) as unknown as { ok: boolean; dueDates: number };

  assert.equal(out.ok, true);
  assert.equal(out.dueDates, 2, "the class meeting was counted as a deadline");
  const held = plain(helper.readBasket(window.localStorage)).dueDates ?? [];
  assert.deepEqual(held.map((item) => [item.uid, item.title, item.course, item.start]), [
    ["huskyct-due-_203765_1-Section-5.1-Homework", "Section 5.1 Homework", "MATH 1070Q", "2026-10-30T03:59:00.000Z"],
    ["huskyct-due-_203765_1-Final-Project", "Final Project", "MATH 1070Q", "2026-12-12T04:59:00.000Z"],
  ]);
  assert.equal(moved(), 0, "a page was opened for them");
});

test("the due dates are read across pages of the answer, and only HuskyCT's own next address is followed", async () => {
  const paged = openPage(data({ paged: true }));
  assert.deepEqual(plain(await paged.helper.readDueDatesApi())?.map((item) => item.title), ["Section 5.1 Homework", "Final Project"]);

  const elsewhere = openPage(async (path: string) =>
    path.startsWith("/learn/api/v1/calendars/calendarItems")
      ? json({ paging: { nextPage: "https://evil.example/steal" }, results: DUE.slice(0, 1) })
      : new Response("{}", { status: 404 }),
  );
  assert.deepEqual(plain(await elsewhere.helper.readDueDatesApi())?.map((item) => item.title), ["Section 5.1 Homework"]);
});

test("a calendar that will not answer leaves the deadlines out, and does not fail the sync", async () => {
  const { window, helper } = openPage(data({ calendar: true }));

  assert.equal(await helper.readDueDatesApi(), null);
  const out = plain(await helper.syncLight());

  assert.equal(out.ok, true, "the sync failed for want of the calendar");
  assert.equal(out.reason, null);
  assert.deepEqual(plain(helper.readBasket(window.localStorage)).dueDates ?? [], []);
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

test("a sync that reads nothing says which step stopped it and what HuskyCT answered", async () => {
  const refused = openPage(async (path) => (path.startsWith("/learn/api/v1/users/me/memberships") ? new Response("{}", { status: 403 }) : json({})));
  assert.deepEqual(pick(await refused.helper.syncLight()), { ok: false, reason: "courses", detail: "HTTP 403" });

  // A 401 is HuskyCT saying the student is signed out, whichever request heard it.
  const signedOut = openPage(async () => new Response("{}", { status: 401 }));
  assert.deepEqual(pick(await signedOut.helper.syncLight()), { ok: false, reason: "signedout", detail: "HTTP 401" });

  const unread = openPage(data({ announcements: [MATH, ECON], me: true }));
  assert.deepEqual(pick(await unread.helper.syncLight()), { ok: false, reason: "read", detail: "HTTP 500" });

  const unreachable = openPage(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.deepEqual(pick(await unreachable.helper.syncLight()), { ok: false, reason: "courses", detail: "no answer" });

  const garbled = openPage(async () => new Response("<html>", { status: 200 }));
  assert.deepEqual(pick(await garbled.helper.syncLight()), { ok: false, reason: "courses", detail: "not JSON" });

  // One that read something carries no reason.
  const fine = openPage(data());
  assert.deepEqual(pick(await fine.helper.syncLight()), { ok: true, reason: null, detail: null });
});

test("HuskyCT's data is asked for at HuskyCT's own address, whatever the page's base says", async () => {
  const { window, helper } = openPage(data());
  // As HuskyCT's pages are: every bare path resolves to Blackboard's file store.
  window.document.head.innerHTML = '<base href="https://ultra.content.blackboardcdn.com/ultra/uiv4001.0.0-rel.34_0818f6b">';
  const asked: string[] = [];
  const serve = data();
  Object.defineProperty(window, "fetch", {
    configurable: true,
    value: (url: string) => {
      asked.push(String(url));
      return serve(new URL(String(url)).pathname + new URL(String(url)).search);
    },
  });

  const out = plain(await helper.syncLight());

  assert.equal(out.ok, true);
  assert.ok(asked.length > 0);
  assert.deepEqual(asked.filter((url) => !url.startsWith("https://lms.uconn.edu/learn/api/v1/")), [], "a request went somewhere other than HuskyCT's own data");
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

test("a sync starts by itself as HuskyCT opens, unless the bookmark loaded the helper, which BetterHuskyCT is about to ask", () => {
  const unasked: number[] = [];
  openPage(data(), undefined, { autoSync: true, timers: unasked });
  assert.ok(unasked.includes(3000), "the sync that starts on its own was not scheduled: " + unasked.join(","));

  const asked: number[] = [];
  openPage(data(), undefined, { autoSync: true, bookmark: true, timers: asked });
  assert.ok(!asked.includes(3000), "it would have read HuskyCT twice: once by itself, once when asked");
});
