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
  readBasket: (storage: unknown) => { courses: Array<{ id: string; announcements: Array<{ title: string }>; announcementsAt: string | null }> };
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const pick = (out: Sync) => ({ ok: out.ok, reason: out.reason, detail: out.detail });

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
    CustomEvent: window.CustomEvent,
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

test("a sync that reads nothing says which step stopped it and what HuskyCT answered", async () => {
  // Refused, then asked through a page that would not run the agent (scripts do not run here).
  const refused = openPage(async (path) => (path.startsWith("/learn/api/v1/users/me/memberships") ? new Response("{}", { status: 403 }) : json({})));
  assert.deepEqual(pick(await refused.helper.syncLight()), { ok: false, reason: "courses", detail: "HTTP 403 then page blocked" });

  // A 401 is HuskyCT saying the student is signed out, whichever request heard it.
  const signedOut = openPage(async () => new Response("{}", { status: 401 }));
  assert.deepEqual(pick(await signedOut.helper.syncLight()), { ok: false, reason: "signedout", detail: "HTTP 401" });

  const unread = openPage(data({ announcements: [MATH, ECON], me: true }));
  assert.deepEqual(pick(await unread.helper.syncLight()), { ok: false, reason: "read", detail: "HTTP 500" });

  const unreachable = openPage(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.deepEqual(pick(await unreachable.helper.syncLight()), { ok: false, reason: "courses", detail: "no answer then page blocked" });

  const garbled = openPage(async () => new Response("<html>", { status: 200 }));
  assert.deepEqual(pick(await garbled.helper.syncLight()), { ok: false, reason: "courses", detail: "not JSON" });

  // One that read something carries no reason.
  const fine = openPage(data());
  assert.deepEqual(pick(await fine.helper.syncLight()), { ok: true, reason: null, detail: null });
});

/** An event that carries a string, as the helper and the page speak to each other. */
const pageEvent = (window: Window, type: string, detail: string) => new window.CustomEvent(type, { detail: detail as unknown as object });

/**
 * The page's side of asking through the page, played by the test: scripts do not run in this
 * document, so the agent the helper puts in it never starts. This answers as the agent would,
 * from `serve`, the page's own fetch.
 */
function pageAnswers(window: Window, serve: (path: string) => Promise<Response>, options: { copied?: number; appAfter?: number } = {}) {
  const asked: string[] = [];
  const document = window.document;
  document.documentElement.setAttribute("data-betterhuskyct-api", "1");
  // HuskyCT's own code has asked for its data: at once, or after a while, as in a tab just opened.
  const appStarts = () => document.documentElement.setAttribute("data-betterhuskyct-app", "1");
  if (options.appAfter === undefined) appStarts();
  else setTimeout(appStarts, options.appAfter);
  document.addEventListener("betterhuskyct:api-request", (event) => {
    const ask = JSON.parse(String((event as unknown as { detail: string }).detail)) as { id: string; path: string };
    asked.push(ask.path);
    void serve(ask.path).then(async (response) => {
      const detail = JSON.stringify({ id: ask.id, status: response.status, text: await response.text(), copied: options.copied ?? 0 });
      document.dispatchEvent(pageEvent(window, "betterhuskyct:api-answer", detail));
    });
  });
  return asked;
}

test("refused as coming from elsewhere, HuskyCT's data is asked for through the page, and then only there", async () => {
  let direct = 0;
  const { window, helper } = openPage(async () => {
    direct++;
    return new Response('{"status":403,"message":"Invalid CORS request."}', { status: 403 });
  });
  const throughPage = pageAnswers(window, data());

  const out = plain(await helper.syncLight());

  assert.equal(out.ok, true);
  assert.deepEqual([out.courses, out.announcements, out.gradeItems], [2, 1, 1]);
  assert.equal(direct, 1, "it kept asking from the sandbox after the page had answered");
  assert.ok(throughPage.some((path) => path.startsWith("/learn/api/v1/users/me/memberships")));
  assert.ok(throughPage.some((path) => path.includes("/gradebook/grades")));
});

test("what the page got is said too, and a 401 there is still a sign-in", async () => {
  const forbidden = openPage(async () => new Response("{}", { status: 403 }));
  pageAnswers(forbidden.window, async () => new Response('{"status":403,"message":"Invalid CORS request."}', { status: 403 }), { copied: 2 });
  assert.deepEqual(pick(await forbidden.helper.syncLight()), { ok: false, reason: "courses", detail: "HTTP 403 then page HTTP 403 h2 Invalid CORS request." });

  // An S3-style refusal is told by its code.
  const s3 = openPage(async () => new Response("{}", { status: 403 }));
  pageAnswers(s3.window, async () => new Response("<?xml version=\"1.0\"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>", { status: 403 }));
  assert.deepEqual(pick(await s3.helper.syncLight()), { ok: false, reason: "courses", detail: "HTTP 403 then page HTTP 403 h0 AccessDenied" });

  const signedOut = openPage(async () => new Response("{}", { status: 403 }));
  pageAnswers(signedOut.window, async () => new Response("{}", { status: 401 }));
  assert.deepEqual(pick(await signedOut.helper.syncLight()), { ok: false, reason: "signedout", detail: "HTTP 403 then page HTTP 401 h0" });

  // Other failures are not asked again: a 500 or a timeout would only fail twice.
  let asked = 0;
  const broken = openPage(async () => new Response("{}", { status: 500 }));
  pageAnswers(broken.window, async () => {
    asked++;
    return json(LIST);
  });
  assert.deepEqual(pick(await broken.helper.syncLight()), { ok: false, reason: "courses", detail: "HTTP 500" });
  assert.equal(asked, 0);
});

test("the first ask through the page waits for HuskyCT's own code to have asked for its data", async () => {
  const { window, helper } = openPage(async () => new Response("{}", { status: 403 }));
  const started = Date.now();
  const throughPage = pageAnswers(window, data(), { appAfter: 600 });

  const out = plain(await helper.syncLight());

  assert.equal(out.ok, true);
  assert.ok(throughPage.length > 0);
  assert.ok(Date.now() - started >= 550, "it asked before HuskyCT's own code had");
});

test("the agent puts the headers HuskyCT's own code uses for its data on its own requests", async () => {
  const inits: Array<{ path: string; headers: Record<string, string> }> = [];
  const { window, helper } = openPage(async (path, init?: { headers?: Record<string, string> }) => {
    inits.push({ path, headers: { ...(init?.headers ?? {}) } });
    return json(LIST);
  });
  // No request leaves this document: what the app would send is only recorded.
  const proto = (window as unknown as { XMLHttpRequest: { prototype: { send: () => void } } }).XMLHttpRequest.prototype;
  proto.send = () => undefined;
  (helper as unknown as { pageApiAgent: () => void }).pageApiAgent();
  const root = window.document.documentElement;

  const XHR = (window as unknown as { XMLHttpRequest: new () => { open: (m: string, u: string) => void; setRequestHeader: (n: string, v: string) => void; send: () => void } }).XMLHttpRequest;
  const other = new XHR();
  other.open("GET", "/ultra/course");
  other.setRequestHeader("X-Elsewhere", "no");
  other.send();
  assert.equal(root.hasAttribute("data-betterhuskyct-app"), false, "a request for something other than HuskyCT's data counted as the app's");

  const app = new XHR();
  app.open("GET", "/learn/api/v1/users/me");
  app.setRequestHeader("X-Blackboard-XSRF", "token-1");
  app.setRequestHeader("Content-Type", "application/json");
  app.send();
  assert.equal(root.getAttribute("data-betterhuskyct-app"), "1");

  const answers: Array<{ id: string; copied: number }> = [];
  window.document.addEventListener("betterhuskyct:api-answer", (event) => answers.push(JSON.parse(String((event as unknown as { detail: string }).detail))));
  window.document.dispatchEvent(pageEvent(window, "betterhuskyct:api-request", JSON.stringify({ id: "one", path: "/learn/api/v1/users/me/memberships" })));
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(inits.map((init) => init.headers), [{ accept: "application/json", "x-blackboard-xsrf": "token-1" }]);
  assert.deepEqual(answers.map((answer) => [answer.id, answer.copied]), [["one", 1]]);
});

test("the agent in the page fetches HuskyCT's data with the page's fetch, once, and nothing else", async () => {
  const fetched: string[] = [];
  const { window, helper } = openPage(async (path) => {
    fetched.push(path);
    return json(LIST);
  });
  const agent = (helper as unknown as { pageApiAgent: () => void }).pageApiAgent;
  agent();
  agent();
  const answers: Array<{ id: string; status: number; text: string }> = [];
  window.document.addEventListener("betterhuskyct:api-answer", (event) => answers.push(JSON.parse(String((event as unknown as { detail: string }).detail))));
  const ask = (id: string, path: string) =>
    window.document.dispatchEvent(pageEvent(window, "betterhuskyct:api-request", JSON.stringify({ id, path })));

  ask("one", "/learn/api/v1/users/me/memberships?limit=50");
  ask("two", "/ultra/course");
  ask("three", "https://evil.example/learn/api/v1/");
  window.document.dispatchEvent(pageEvent(window, "betterhuskyct:api-request", "{not json"));
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(fetched, ["/learn/api/v1/users/me/memberships?limit=50"], "it fetched something other than HuskyCT's data, or twice");
  assert.deepEqual(answers.map((answer) => [answer.id, answer.status]), [["one", 200]]);
  assert.deepEqual(JSON.parse(answers[0].text), LIST);
  assert.equal(window.document.documentElement.getAttribute("data-betterhuskyct-api"), "1");
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
