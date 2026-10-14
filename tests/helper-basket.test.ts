import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

import { onlyAtHuskyct } from "./support/huskyct-fetch.ts";

/**
 * The helper's basket and its panel, run as shipped, against HuskyCT's own data: what a sync
 * keeps, what the panel's Sync now and its switch do, and how a request from BetterHuskyCT is
 * answered. Nothing here reads a page: the helper does not.
 *
 * Each page gets its own happy-dom window, and the userscript runs inside it
 * through `vm`, the way a userscript manager would run it inside the tab.
 */
const SOURCE = readFileSync(
  new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url),
  "utf8",
);

type Basket = {
  version: number;
  courses: Array<{
    id: string;
    code: string | null;
    announcements: Array<{ title: string; body: string; posted: string | null }>;
    announcementsAt: string | null;
  }>;
  todos: Array<{ uid: string; start: string; title: string; course?: string | null }>;
  todosAt: string | null;
  dueDates?: Array<{ uid: string; start: string; title: string; course?: string | null }>;
  dueDatesAt?: string | null;
};

type Helper = {
  BASKET_KEY: string;
  emptyBasket: () => Basket;
  readBasket: (storage: unknown) => Basket;
  rememberAnnouncements: (
    basket: Basket,
    course: { id: string; code: string | null },
    records: Array<{ title: string; body?: string; posted?: string | null }>,
    now?: Date,
  ) => { basket: Basket; changed: boolean };
  rememberTodos: (basket: Basket, records: Basket["todos"], now?: Date) => { basket: Basket; changed: boolean };
  basketSummary: (basket: Basket) => { courses: number; collected: number; announcements: number; deadlines: number };
  coursesToCollect: (
    cards: Array<{ id: string; code: string | null; term: string | null }>,
    now?: Date,
  ) => Array<{ id: string; code: string | null }>;
  termCodeFor: (date: Date) => number;
  rememberDueDates: (basket: Basket, records: Basket["todos"], now?: Date) => { basket: Basket; changed: boolean };
  deadlineRecords: (basket: Basket) => Basket["todos"];
  readSyncState: (storage: unknown) => { at: string | null; auto: boolean; pending: boolean; grades: unknown };
  basketContents: (basket: Basket) => { records: unknown[]; announcements: Array<{ courseCode: string; title: string }> };
  setLocale: (locale: string) => void;
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

type Opened = { url: string; target: string };

/** A HuskyCT tab with the helper running in it. */
type PageExtras = {
  /** The helper's saved sync state. Off by default, so the sync that starts on its own does not run in the middle of other tests. */
  sync?: Record<string, unknown>;
  /** What HuskyCT's own data answers, where the default refuses everything. */
  fetch?: (path: string) => Promise<unknown>;
  /** What the page's window.open returns, where the default is a tab that answers nothing. */
  open?: (link: string, target: string) => unknown;
  /** The userscript manager's functions, where the default is none, as with an install from before 1.11.0. */
  gm?: Record<string, unknown>;
};

function openPage(url: string, html: string, stored?: Basket, extras: PageExtras = {}) {
  const window = new Window({ url });
  onlyAtHuskyct(window);
  windows.push(window);
  window.document.body.innerHTML = html;
  if (stored) window.localStorage.setItem("huskypilot.helper.basket.v1", JSON.stringify(stored));
  // The stand-in HuskyCT serves pages, not data: the helper's direct reading finds
  // nothing to ask and reads the page, which is what these tests are about. Nothing
  // here may reach the real network.
  (window as unknown as { fetch: unknown }).fetch = extras.fetch ?? (() => Promise.reject(new Error("no network in tests")));

  const opened: Opened[] = [];
  const fakeTab = { opener: {} as unknown, focus() {} };
  (window as unknown as { open: (url: string, target: string) => unknown }).open = (link, target) => {
    opened.push({ url: String(link), target: String(target) });
    return extras.open ? extras.open(link, target) : fakeTab;
  };

  const sandbox = {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    // The link is packed with the platform's own streams, as in a browser.
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
  // The sync that starts on its own when HuskyCT opens is tested on its own; here it would run in the middle of the tests.
  window.localStorage.setItem("huskypilot.helper.sync.v1", JSON.stringify(extras.sync ?? { auto: false }));
  Object.assign(sandbox, extras.gm ?? {});
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);

  const helper = (window as unknown as { __huskyctHelper: Helper }).__huskyctHelper;
  helper.setLocale("en");
  const shadow = window.document.querySelector("#huskypilot-helper")?.shadowRoot;
  assert.ok(shadow, "the panel did not mount");

  return {
    window,
    helper,
    opened,
    fakeTab,
    basket: () => plain(helper.readBasket(window.localStorage)),
    text: (selector: string) => shadow.querySelector(selector)?.textContent ?? "",
    button: (act: string) => shadow.querySelector(`[data-act="${act}"]`) as unknown as HTMLButtonElement,
  };
}

/** Values made inside the page's realm, flattened so `deepEqual` compares content, not prototypes. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

async function until(check: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// --- collecting ------------------------------------------------------------------

/** What the stand-in lets a sync read: no calendar, to-do list or files, and both courses' announcements and grades. */
const READ_REPORT = {
  dueDates: false,
  todo: false,
  courses: [
    { id: "_203765_1", code: "MATH 1070Q", announcements: true, grades: true, files: false },
    { id: "_198430_1", code: "ECON 1201", announcements: true, grades: true, files: false },
  ],
};

test("a revisit replaces a course's announcements, and an unchanged one writes nothing", () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  const course = { id: "_1_1", code: "MATH 1070Q" };
  const first = helper.rememberAnnouncements(helper.emptyBasket(), course, [
    { title: "A", body: "a" },
    { title: "B", body: "b" },
  ]);

  const same = helper.rememberAnnouncements(first.basket, course, [
    { title: "A", body: "a" },
    { title: "B", body: "b" },
  ]);
  assert.equal(same.changed, false, "an unchanged page rewrote storage");

  // The instructor deleted B: the page no longer lists it, so neither does the basket.
  const after = helper.rememberAnnouncements(first.basket, course, [{ title: "A", body: "a" }]);
  assert.equal(after.changed, true);
  assert.deepEqual(plain(after.basket.courses[0].announcements.map((a) => a.title)), ["A"]);
});

test("an empty to-do list does not wipe deadlines already collected", () => {
  // The list only spans a week either side of today, so empty is not "nothing due".
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  const withTodo = helper.rememberTodos(helper.emptyBasket(), [{ uid: "t1", start: "2026-10-01T03:59:00.000Z", title: "HW" }]);

  const quietWeek = helper.rememberTodos(withTodo.basket, []);

  assert.equal(quietWeek.changed, false);
  assert.equal(quietWeek.basket.todos.length, 1);
});

test("the basket survives a corrupt or foreign value in storage", () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  const storage = { getItem: () => "{not json" };
  assert.deepEqual(plain(helper.readBasket(storage)), plain(helper.emptyBasket()));
  assert.deepEqual(plain(helper.readBasket({ getItem: () => JSON.stringify({ version: 99 }) })), plain(helper.emptyBasket()));
});

// --- sending ---------------------------------------------------------------------

// --- collecting everything in one press ------------------------------------------

// --- the quick sync ---------------------------------------------------------------------

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** HuskyCT's own data for two courses: their list, the student, announcements and gradebooks. */
function syncData(log: string[] = []) {
  const membership = (id: string, displayName: string, courseId: string) => ({
    courseId: id,
    isAvailable: true,
    userHasHidden: false,
    course: { id, courseId, displayName, isOrganization: false, isAvailable: true, effectiveAvailability: true },
  });
  return async (path: string) => {
    log.push(path);
    if (path.startsWith("/learn/api/v1/users/me/memberships")) {
      return json({
        paging: { count: 2, nextPage: "" },
        results: [
          membership("_203765_1", "MATH-1070Q-Mathematics for Business and Economics-SEC100-1268", "1268-UCONN-MATH-1070Q-SEC100-1191"),
          membership("_198430_1", "ECON-1201-Principles of Microeconomics-SEC010-1268", "1268-UCONN-ECON-1201-SEC010-5757"),
        ],
      });
    }
    if (path === "/learn/api/v1/users/me") return json({ id: "_1003488_1" });
    if (/\/_203765_1\/announcements/.test(path)) {
      return json({ paging: { nextPage: "" }, results: [{ title: "Exam 1 is NEXT Tuesday!", body: { displayText: "<p>Covers Chapter 4.</p>" }, startDateRestriction: "2026-09-22T13:00:00.000Z", isDraft: false }] });
    }
    if (/\/announcements/.test(path)) return json({ paging: { nextPage: "" }, results: [] });
    if (/\/_203765_1\/gradebook\/grades/.test(path)) {
      return json({
        paging: { count: 1, nextPage: "" },
        results: [{ columnId: "_3876640_1", column: { id: "_3876640_1", effectiveColumnName: "Take-home Quiz 1" }, status: "GRADED", pointsPossible: 100, displayGrade: { score: 100 }, lastAttempt: { status: "COMPLETED" } }],
      });
    }
    if (/\/gradebook\/grades/.test(path)) return json({ paging: { count: 0, nextPage: "" }, results: [] });
    return new Response("{}", { status: 404 });
  };
}

/** A BetterHuskyCT tab that answers the helper's hello and stores what it is sent, as the app does. */
function appTab(getWindow: () => Window, messages: Array<{ protocol: string; kind: string }>, refuseGrades = false) {
  return {
    opener: {} as unknown,
    closed: false,
    focus() {},
    location: { href: "about:blank" },
    postMessage(message: { protocol: string; kind: string }) {
      messages.push(message);
      const answer = message.kind === "hello" ? { protocol: message.protocol, kind: "ready" } : ["sync", "grades"].includes(message.kind) ? { protocol: message.protocol, kind: "stored", ok: !(refuseGrades && message.kind === "grades") } : null;
      if (!answer) return;
      setTimeout(() => {
        const window = getWindow() as unknown as { dispatchEvent: (event: unknown) => void; MessageEvent: new (type: string, init: unknown) => unknown };
        window.dispatchEvent(new window.MessageEvent("message", { data: answer, origin: "https://betterhuskyct.vercel.app" }));
      }, 0);
    },
  };
}

// --- BetterHuskyCT's own Sync button asking the helper ----------------------------------

const BHC = "https://betterhuskyct.vercel.app";
const SYNC_PROTOCOL = "betterhuskyct/sync@1";

/** BetterHuskyCT's window, as the helper sees it: it records what it is sent, and answers like the app. */
function asker(getWindow: () => Window) {
  const heard: Array<Record<string, unknown>> = [];
  const tab = appTab(getWindow, heard as Array<{ protocol: string; kind: string }>);
  return { tab, heard };
}

function request(page: ReturnType<typeof openPage>, source: unknown, origin = BHC, data: unknown = { protocol: SYNC_PROTOCOL, kind: "request" }) {
  const target = page.window as unknown as { dispatchEvent: (event: unknown) => void; MessageEvent: new (type: string, init: unknown) => unknown };
  target.dispatchEvent(new target.MessageEvent("message", { data, origin, source }));
}

test("BetterHuskyCT's request is answered, reported on as it goes, and what is read is sent back to the window that asked", async () => {
  const page: ReturnType<typeof openPage> = openPage("https://lms.uconn.edu/ultra/course", "<main></main>", undefined, { fetch: syncData() });
  const { tab, heard } = asker(() => page.window);
  let moved = 0;
  page.window.addEventListener("popstate", () => moved++);

  request(page, tab);
  await until(() => heard.some((message) => message.protocol === SYNC_PROTOCOL && message.kind === "done"), 8000);

  const ofSync = plain(heard.filter((message) => message.protocol === SYNC_PROTOCOL));
  assert.deepEqual(ofSync[0], { protocol: SYNC_PROTOCOL, kind: "ack", state: "started" });
  assert.deepEqual(ofSync.filter((message) => message.kind === "progress").map((message) => [message.course, message.index, message.total]), [["MATH 1070Q", 1, 2], ["ECON 1201", 2, 2]]);
  const done = ofSync[ofSync.length - 1];
  assert.deepEqual(done, { protocol: SYNC_PROTOCOL, kind: "done", ok: true, courses: 2, announcements: 1, gradeItems: 1, skipped: [], sent: true, files: 0, status: READ_REPORT });
  // The announcements and the gradebooks went to the window that asked, nowhere else.
  assert.deepEqual(heard.filter((message) => message.kind === "sync" || message.kind === "grades").map((message) => message.protocol), ["betterhuskyct/tasks@1", "betterhuskyct/grades@1"]);
  assert.equal(page.opened.length, 0, "a tab was opened for a request that came from one");
  assert.equal(moved, 0, "a page was opened");
});

test("a request while a sync is running is answered busy, and does not start a second one", async () => {
  const page: ReturnType<typeof openPage> = openPage("https://lms.uconn.edu/ultra/course", "<main></main>", undefined, { fetch: syncData() });
  const { tab, heard } = asker(() => page.window);

  request(page, tab);
  request(page, tab);
  await until(() => heard.some((message) => message.protocol === SYNC_PROTOCOL && message.kind === "done"), 8000);

  const acks = heard.filter((message) => message.protocol === SYNC_PROTOCOL && message.kind === "ack").map((message) => message.state);
  assert.deepEqual(acks, ["started", "busy"]);
  assert.equal(heard.filter((message) => message.kind === "done").length, 1, "two syncs ran");
});

test("a request reads HuskyCT's data, moves no page, says so in the panel, and keeps the reading", async () => {
  const page: ReturnType<typeof openPage> = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>", undefined, { fetch: syncData() });
  const { tab, heard } = asker(() => page.window);
  let moved = 0;
  page.window.addEventListener("popstate", () => moved++);

  request(page, tab);
  await until(() => /Sent to BetterHuskyCT/.test(page.text('[data-role="sync"]')), 8000);

  assert.match(page.text('[data-role="sync"]'), /Synced 2 course\(s\): 1 announcement\(s\), 1 grade item\(s\)/);
  // Deadlines and announcements, then the gradebooks.
  assert.deepEqual(heard.filter((message) => message.kind === "sync" || message.kind === "grades").map((message) => message.protocol), ["betterhuskyct/tasks@1", "betterhuskyct/grades@1"]);
  assert.equal(moved, 0, "a page was opened");
  assert.equal(page.window.location.pathname, "/ultra/stream");
  assert.deepEqual(page.basket().courses.find((course) => course.id === "_203765_1")?.announcements.map((a) => a.title), ["Exam 1 is NEXT Tuesday!"]);
  const state = plain(page.helper.readSyncState(page.window.localStorage));
  assert.equal(state.pending, false);
  assert.ok(state.grades, "the reading was not kept");
  // This stand-in answers no calendar, to-do list or files, so the sync is not counted as done: it tries again at the next opening.
  assert.equal(state.at, null);
  assert.match(page.text('[data-role="sync"]'), /Not read this time: due dates; the to-do list; some files/);
  assert.ok(page.button("sync"), "the panel has no Sync now button");
});

test("the panel's Sync now reads HuskyCT's data and sends it to BetterHuskyCT, which the press opens", async () => {
  let app: unknown = null;
  const page: ReturnType<typeof openPage> = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>", undefined, { fetch: syncData(), open: () => app });
  const asking = asker(() => page.window);
  app = asking.tab;
  let moved = 0;
  page.window.addEventListener("popstate", () => moved++);
  assert.match(page.text('[data-act="sync"]'), /Sync now/);

  page.button("sync").click();
  await until(() => /Sent to BetterHuskyCT/.test(page.text('[data-role="sync"]')), 8000);

  // A press may open BetterHuskyCT: nothing is read from a page, so HuskyCT can go behind it.
  assert.deepEqual(page.opened.map((open) => open.target), ["betterhuskyct"]);
  assert.equal(moved, 0, "a page was opened");
  const tasks = asking.heard.find((message) => message.protocol === "betterhuskyct/tasks@1" && message.kind === "sync");
  assert.ok(tasks, "the deadlines and announcements were not sent");
  // What the sync read goes with them, so the status is right with no BetterHuskyCT press behind it.
  assert.deepEqual(plain(tasks.status), READ_REPORT);
  assert.equal(page.button("sync").disabled, false, "the button stays off after the sync");
});

test("only BetterHuskyCT's origin is heard, and only a request in the right shape", async () => {
  const asked: string[] = [];
  const page = openPage("https://lms.uconn.edu/ultra/course", "<main></main>", undefined, { fetch: syncData(asked) });
  const { tab, heard } = asker(() => page.window);

  request(page, tab, "https://evil.example");
  request(page, tab, BHC, { protocol: SYNC_PROTOCOL, kind: "something-else" });
  request(page, tab, BHC, { protocol: "other", kind: "request" });
  request(page, tab, BHC, "request");
  request(page, null);
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(heard.length, 0, "something that should not have been answered was");
  assert.deepEqual(asked, [], "a sync ran for a request that should have been refused");
});

test("a request on the sign-in page is answered, and then says nothing could be read", async () => {
  const page = openPage("https://lms.uconn.edu/", `<form id="loginFormDiv"><input name="user_id"></form>`, undefined, { fetch: syncData() });
  const { tab, heard } = asker(() => page.window);

  request(page, tab);
  await until(() => heard.some((message) => message.protocol === SYNC_PROTOCOL && message.kind === "done"), 3000);

  assert.deepEqual(heard.filter((message) => message.protocol === SYNC_PROTOCOL).map((message) => [message.kind, message.ok ?? message.state]), [["ack", "started"], ["done", false]]);
  // Said as a sign-in, so BetterHuskyCT can offer one rather than call it unreadable.
  assert.equal(heard.find((message) => message.kind === "done")?.reason, "signedout");
});

test("a sync that arrives only in part is not called sent, and stays waiting", async () => {
  const messages: Array<{ protocol: string; kind: string }> = [];
  const page: ReturnType<typeof openPage> = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>", undefined, { fetch: syncData() });

  request(page, appTab(() => page.window, messages, true));
  await until(() => /Only part of it reached/.test(page.text('[data-role="sync"]')), 8000);

  assert.doesNotMatch(page.text('[data-role="sync"]'), /Sent to BetterHuskyCT/);
  assert.equal(plain(page.helper.readSyncState(page.window.localStorage)).pending, true, "a half-sent sync was marked as done");
});

test("when nothing can be read this way, Sync says so, moves nothing, and gives the screen back", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>");
  let moved = 0;
  page.window.addEventListener("popstate", () => moved++);

  request(page, asker(() => page.window).tab);
  await until(() => /Nothing could be read from HuskyCT/.test(page.text('[data-role="sync"]')), 8000);

  assert.equal(moved, 0, "it fell back to opening pages");
  assert.equal(page.button("sync").disabled, false);
});

test("on its own at open: a sync is read in the background, sends nowhere without a tab, and waits for a press", async () => {
  const asked: string[] = [];
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>", undefined, { fetch: syncData(asked), sync: { auto: true, at: null } });
  let moved = 0;
  page.window.addEventListener("popstate", () => moved++);

  await until(() => /Read on its own/.test(page.text('[data-role="sync"]')), 8000);

  assert.ok(asked.some((path) => path.includes("/announcements")), "nothing was read");
  assert.equal(page.opened.length, 0, "a tab was opened with no press");
  assert.equal(moved, 0);
  assert.equal(plain(page.helper.readSyncState(page.window.localStorage)).pending, true);
});

test("on its own at open: not when it was done recently, not when it is switched off, not when HuskyCT cannot be read", async () => {
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const askedRecent: string[] = [];
  const askedOff: string[] = [];
  openPage("https://lms.uconn.edu/ultra/stream", "<main></main>", undefined, { fetch: syncData(askedRecent), sync: { auto: true, at: recent } });
  openPage("https://lms.uconn.edu/ultra/stream", "<main></main>", undefined, { fetch: syncData(askedOff), sync: { auto: false, at: null } });
  const signedOut = openPage("https://lms.uconn.edu/", `<form id="loginFormDiv"><input name="user_id"></form>`, undefined, { fetch: syncData(), sync: { auto: true, at: null } });

  await new Promise((resolve) => setTimeout(resolve, 3600));

  assert.deepEqual(askedRecent, [], "it ran again within hours");
  assert.deepEqual(askedOff, [], "it ran when switched off");
  assert.equal(signedOut.text('[data-role="sync"]'), "", "it ran on the sign-in page");
});

test("the switch for the sync on its own is kept, and says which way it is", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>");
  assert.match(page.text('[data-act="autosync"]'), /: off$/, "the tests start with it off");

  page.button("autosync").click();
  await until(() => /: on$/.test(page.text('[data-act="autosync"]')));
  assert.equal(plain(page.helper.readSyncState(page.window.localStorage)).auto, true);

  page.button("autosync").click();
  await until(() => /: off$/.test(page.text('[data-act="autosync"]')));
  assert.equal(plain(page.helper.readSyncState(page.window.localStorage)).auto, false);
});

test("only this term's courses are read, and a later term's too", () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>");
  const cards = [
    { id: "_1_1", code: "MATH 1070Q", term: "1268" },
    { id: "_2_1", code: "CHEM 1127Q", term: "1263" },
    { id: "_3_1", code: "ECON 1201", term: "1273" },
    { id: "_4_1", code: "SOCI 1501", term: null },
  ];
  // Fall 2026: last spring's course is left out, a coming term's is not, and one with no term is kept rather than guessed away.
  assert.deepEqual(plain(helper.coursesToCollect(cards, new Date(2026, 8, 27))).map((course) => course.id), ["_1_1", "_3_1", "_4_1"]);
  // A break between terms, with every course on the list older than today's term: the newest stands in.
  const old = [{ id: "_1_1", code: "A 1000", term: "1263" }, { id: "_2_1", code: "B 1000", term: "1268" }];
  assert.deepEqual(plain(helper.coursesToCollect(old, new Date(2027, 0, 15))).map((course) => course.id), ["_2_1"]);
});

test("UConn term codes follow the calendar", () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  assert.equal(helper.termCodeFor(new Date("2026-09-27T12:00:00")), 1268);
  assert.equal(helper.termCodeFor(new Date("2027-02-01T12:00:00")), 1273);
  assert.equal(helper.termCodeFor(new Date("2027-06-15T12:00:00")), 1275);
  assert.equal(helper.termCodeFor(new Date("2026-12-10T12:00:00")), 1268);
});

// --- the whole term's due dates ---------------------------------------------------

test("a partial look at the due dates does not drop the ones read before", () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  const record = (uid: string, start: string) => ({ uid, title: uid, start, course: "MATH 1070Q" });
  const first = helper.rememberDueDates(helper.emptyBasket(), [record("a", "2026-10-03T03:59:00.000Z"), record("b", "2026-10-10T03:59:00.000Z")]);

  // The view reopened at today shows only the first few weeks, one of them moved.
  const later = helper.rememberDueDates(first.basket, [record("a", "2026-10-04T03:59:00.000Z")]);

  assert.deepEqual(
    plain(later.basket.dueDates)?.map((item) => [item.uid, item.start]),
    [
      ["a", "2026-10-04T03:59:00.000Z"],
      ["b", "2026-10-10T03:59:00.000Z"],
    ],
  );
  const same = helper.rememberDueDates(later.basket, [record("a", "2026-10-04T03:59:00.000Z")]);
  assert.equal(same.changed, false, "an unchanged view rewrote storage");
});

test("a deadline on both the to-do list and the Calendar is sent once, as the to-do item", () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  const start = "2026-10-03T03:59:00.000Z";
  const basket: Basket = {
    ...helper.emptyBasket(),
    todos: [{ uid: "huskyct-todo-_3867214_1", title: "Section 5.1 Homework", course: "MATH 1070Q", start }],
    dueDates: [
      { uid: "huskyct-due-_203765_1-Section-5.1-Homework", title: "Section 5.1 Homework", course: "MATH 1070Q", start },
      { uid: "huskyct-due-_201693_1-Assignment-2", title: "Assignment 2", course: "STAT 1000Q", start },
    ],
  };

  const records = plain(helper.deadlineRecords(basket));

  assert.deepEqual(records.map((record) => record.uid), ["huskyct-todo-_3867214_1", "huskyct-due-_201693_1-Assignment-2"]);
  assert.equal(helper.basketSummary(basket).deadlines, 2);
});

test("a basket saved before due dates existed still reads", () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  const old = JSON.stringify({ version: 1, courses: [], todos: [{ uid: "t", start: "2026-10-01T00:00:00.000Z", title: "HW" }], todosAt: null });

  const basket = plain(helper.readBasket({ getItem: () => old }));

  assert.equal(basket.todos.length, 1);
  assert.deepEqual(basket.dueDates, []);
});

// --- the self-check -----------------------------------------------------------------


// --- the bridge: BetterHuskyCT's Sync button and a HuskyCT tab it did not open ---------------

const BRIDGE_CONTROL = "betterhuskyct/bridge@1";
const BRIDGE_OUT = "betterhuskyct/bridge-out@1";
const BRIDGE_IN = "betterhuskyct/bridge-in@1";

/** The userscript manager: one storage every tab running the script shares, and background tabs. */
function userscriptManager() {
  const values = new Map<string, unknown>();
  const listeners: Array<{ key: string; run: (...args: unknown[]) => void }> = [];
  const tabs: Array<{ url: string; options: Record<string, unknown>; closed: boolean; close: () => void }> = [];
  const clone = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  return {
    tabs,
    values,
    gm: {
      GM_getValue: (key: string, fallback: unknown) => (values.has(key) ? clone(values.get(key)) : fallback),
      GM_setValue: (key: string, value: unknown) => {
        const old = values.get(key);
        values.set(key, clone(value));
        for (const listener of listeners) if (listener.key === key) setTimeout(() => listener.run(key, clone(old), clone(value), true), 0);
      },
      GM_addValueChangeListener: (key: string, run: (...args: unknown[]) => void) => {
        listeners.push({ key, run });
        return listeners.length;
      },
      GM_openInTab: (url: string, options: Record<string, unknown>) => {
        const tab = { url, options, closed: false, close: () => (tab.closed = true) };
        tabs.push(tab);
        return tab;
      },
    },
  };
}

/**
 * A BetterHuskyCT page with the helper on it, and a stand-in for the app: it answers what comes
 * through the bridge as the app's receivers do, and keeps what it heard.
 */
function openBhcPage(gm?: Record<string, unknown>) {
  const window = new Window({ url: "https://betterhuskyct.vercel.app/" });
  windows.push(window);
  const sandbox = { window, document: window.document, navigator: window.navigator, localStorage: window.localStorage, URL, console, setTimeout, clearTimeout };
  Object.assign(sandbox, gm ?? {});
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);

  const heard: Array<Record<string, unknown>> = [];
  const page = window as unknown as {
    postMessage: (message: unknown, origin: string) => void;
    addEventListener: (type: string, run: (event: { data: Record<string, unknown> }) => void) => void;
  };
  const send = (message: unknown) => page.postMessage(message, "https://betterhuskyct.vercel.app");
  page.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.protocol === BRIDGE_CONTROL && data.kind === "pong") heard.push(data);
    if (data.protocol !== BRIDGE_IN) return;
    const message = data.data as { protocol: string; kind: string };
    heard.push(message as unknown as Record<string, unknown>);
    const answer =
      message.kind === "hello" ? { protocol: message.protocol, kind: "ready" } : ["sync", "grades"].includes(message.kind) ? { protocol: message.protocol, kind: "stored", ok: true } : null;
    if (answer) send({ protocol: BRIDGE_OUT, data: answer });
  });
  return { window, heard, send, ask: () => send({ protocol: BRIDGE_OUT, data: { protocol: SYNC_PROTOCOL, kind: "request" } }) };
}

const doneHeard = (heard: Array<Record<string, unknown>>) => heard.some((message) => message.protocol === SYNC_PROTOCOL && message.kind === "done");

test("BetterHuskyCT's Sync reaches a HuskyCT tab it did not open, through the userscript manager, and the reading comes back", async () => {
  const manager = userscriptManager();
  const huskyct = openPage("https://lms.uconn.edu/ultra/course", "<main></main>", undefined, { fetch: syncData(), gm: manager.gm });
  const bhc = openBhcPage(manager.gm);

  bhc.send({ protocol: BRIDGE_CONTROL, kind: "ping" });
  await until(() => bhc.heard.some((message) => message.kind === "pong"));

  // A HuskyCT tab is already open, so none is opened.
  bhc.send({ protocol: BRIDGE_CONTROL, kind: "open" });
  bhc.ask();
  await until(() => doneHeard(bhc.heard), 8000);

  assert.equal(manager.tabs.length, 0, "a second HuskyCT tab was opened");
  const ofSync = plain(bhc.heard.filter((message) => message.protocol === SYNC_PROTOCOL));
  assert.deepEqual(ofSync[0], { protocol: SYNC_PROTOCOL, kind: "ack", state: "started" });
  assert.deepEqual(ofSync[ofSync.length - 1], { protocol: SYNC_PROTOCOL, kind: "done", ok: true, courses: 2, announcements: 1, gradeItems: 1, skipped: [], sent: true, files: 0, status: READ_REPORT });
  assert.deepEqual(
    bhc.heard.filter((message) => message.kind === "sync" || message.kind === "grades").map((message) => message.protocol),
    ["betterhuskyct/tasks@1", "betterhuskyct/grades@1"],
  );
  assert.equal(huskyct.opened.length, 0, "the HuskyCT tab opened a window of its own");
});

test("with no HuskyCT tab open, one is opened behind BetterHuskyCT, answers the request waiting for it, and is closed after", async () => {
  const manager = userscriptManager();
  const bhc = openBhcPage(manager.gm);

  bhc.send({ protocol: BRIDGE_CONTROL, kind: "open" });
  await until(() => manager.tabs.length === 1);
  assert.equal(manager.tabs[0].url, "https://lms.uconn.edu/ultra/course");
  assert.equal(manager.tabs[0].options.active, false, "HuskyCT was brought to the front");
  bhc.ask();
  await new Promise((resolve) => setTimeout(resolve, 50));

  // The tab finishes loading after the request was written, and finds it.
  openPage("https://lms.uconn.edu/ultra/course", "<main></main>", undefined, { fetch: syncData(), gm: manager.gm });
  await until(() => doneHeard(bhc.heard), 8000);
  await until(() => manager.tabs[0].closed, 5000);
});

test("of two HuskyCT tabs, one answers, so HuskyCT is read once", async () => {
  const manager = userscriptManager();
  const asked: string[] = [];
  openPage("https://lms.uconn.edu/ultra/course", "<main></main>", undefined, { fetch: syncData(asked), gm: manager.gm });
  await new Promise((resolve) => setTimeout(resolve, 5));
  openPage("https://lms.uconn.edu/ultra/stream", "<main></main>", undefined, { fetch: syncData(asked), gm: manager.gm });
  const bhc = openBhcPage(manager.gm);

  bhc.ask();
  await until(() => doneHeard(bhc.heard), 8000);
  await new Promise((resolve) => setTimeout(resolve, 200));

  const acks = bhc.heard.filter((message) => message.protocol === SYNC_PROTOCOL && message.kind === "ack");
  assert.equal(acks.length, 1, "both tabs answered");
  assert.equal(asked.filter((path) => /memberships/.test(path)).length, 1, "HuskyCT was read twice");
});

test("without the userscript manager's storage the helper offers nothing, and BetterHuskyCT opens HuskyCT as before", async () => {
  const bhc = openBhcPage();
  bhc.send({ protocol: BRIDGE_CONTROL, kind: "ping" });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(bhc.heard.length, 0, "it answered without a way to reach HuskyCT");
  assert.equal(bhc.window.document.querySelector("#huskypilot-helper"), null, "the HuskyCT panel was put on BetterHuskyCT");
});
