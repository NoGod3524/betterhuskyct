import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

import { decodeSyncPayload } from "../src/lib/sync.ts";

/**
 * The helper's basket, run as shipped — panel, timer and all — on pages shaped
 * like the live HuskyCT ones.
 *
 * The fixtures copy what the signed-in pages actually render, measured on
 * 2026-09-27: the Courses page links each course with its display name as the
 * link text, a course's Announcements page lists rows with the posted date in
 * `.list-item-date-sent`, and the course outline shows no announcements at all.
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
  courseLinksOnPage: (root: unknown) => Array<{ id: string; code: string }>;
  rememberAnnouncements: (
    basket: Basket,
    course: { id: string; code: string | null },
    records: Array<{ title: string; body?: string; posted?: string | null }>,
    now?: Date,
  ) => { basket: Basket; changed: boolean };
  rememberTodos: (basket: Basket, records: Basket["todos"], now?: Date) => { basket: Basket; changed: boolean };
  captureIntoBasket: (
    basket: Basket,
    root: unknown,
    pathname: string,
    now: Date,
    listSettled: boolean,
  ) => { basket: Basket; changed: boolean };
  basketSummary: (basket: Basket) => { courses: number; collected: number; announcements: number; deadlines: number };
  courseCardsOnPage: (root: unknown) => Array<{ id: string; code: string | null; term: string | null }>;
  coursesToCollect: (
    cards: Array<{ id: string; code: string | null; term: string | null }>,
    recent: Array<{ id: string; code: string }>,
    now?: Date,
  ) => Array<{ id: string; code: string | null }>;
  termCodeFor: (date: Date) => number;
  collectDueDates: (root: unknown) => Array<{ uid: string; title: string; course: string | null; due: Date }>;
  rememberDueDates: (basket: Basket, records: Basket["todos"], now?: Date) => { basket: Basket; changed: boolean };
  deadlineRecords: (basket: Basket) => Basket["todos"];
  readSyncState: (storage: unknown) => { at: string | null; auto: boolean; pending: boolean; grades: unknown };
  collectEverything: (options?: Record<string, unknown>) => Promise<{
    courses: number;
    collected: number;
    dueDates: number;
    skipped: string[];
    stopped: boolean;
    problems: Array<{ key: string; params?: Record<string, unknown> }>;
    grades: { courses: unknown[]; stopped: boolean; problems: unknown[] } | null;
    materials: { courses: unknown[]; stopped: boolean; problems: unknown[] } | null;
  }>;
  problemsText: (problems: Array<{ key: string; params?: Record<string, unknown> }>) => string;
  announcementsPathFor: (courseId: string) => string;
  basketContents: (basket: Basket) => { records: unknown[]; announcements: Array<{ courseCode: string; title: string }> };
  basketLink: (
    basket: Basket,
    now?: Date,
  ) => Promise<{ link: string; deadlines: number; announcements: number; leftOut: number }>;
  collectAnnouncements: (root: unknown) => Array<{ title: string; body: string; posted: string | null }>;
  setLocale: (locale: string) => void;
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

const MATH_LINK = `<a href="https://lms.uconn.edu/ultra/courses/_203765_1/outline"><span>1268-UCONN-MATH-1070Q-SEC100-1191</span><span>MATH-1070Q-Mathematics for Business and Economics-SEC100-1268</span></a>`;
const ECON_LINK = `<a href="https://lms.uconn.edu/ultra/courses/_198430_1/outline"><span>1268-UCONN-ECON-1201-SEC010-5757</span><span>ECON-1201-Principles of Microeconomics-SEC010-1268</span></a>`;
const TODO = `<div aria-label="Section 4.7 Homework, Homework · MATH-1070Q-Mathematics for Business and Economics-SEC100-1268 · _203765_1, due 9/25/26, 11:59 PM" data-analytics-id="student-todo.item._3867214_1"></div>`;

const COURSES_PAGE = `<h2>Courses</h2>${MATH_LINK}${ECON_LINK}<h2>To Do</h2>${TODO}`;

/** As the live row nests it: the title sits inside .click-message-detail, beside the body. */
function announcementRow(title: string, posted: string, body: string) {
  return (
    `<div class="announcement-item-row"><span class="list-item-date-sent">${posted}</span>` +
    `<div class="click-message-detail"><div class="announcement-title-detail"><a class="list-item-title" href="#">${title}</a></div>` +
    `<p class="MuiTypography-root list-item-body three-lines">${body}</p></div></div>`
  );
}

function announcementsPage(heading: string, courseLinkText: string, courseId: string, rows: string[]) {
  return (
    `<div class="courseTitle-abc">${heading}</div>` +
    // A course page links its own title; the basket must not mistake it for a new course.
    `<a href="https://lms.uconn.edu/ultra/courses/${courseId}/outline">${courseLinkText}</a>` +
    `<div class="announcement-list">${rows.join("")}</div>`
  );
}

const MATH_ANNOUNCEMENTS = announcementsPage(
  "MATH-1070Q-Mathematics for Business and Economics-SEC100-1268 • 1268-UCONN-MATH-1070Q-SEC100-1191",
  "MATH-1070Q-Mathematics for Business and Economics-",
  "_203765_1",
  [
    announcementRow("Exam 1 is NEXT Tuesday!", "9/22/26, 9:00 AM", "Exam 1 is on Tuesday September 29th and covers Chapter 4."),
    announcementRow("Office Hours", "9/20/26, 1:15 PM", "Online office hours today from 3pm-5pm."),
  ],
);

const ECON_ANNOUNCEMENTS = announcementsPage(
  "ECON-1201-Principles of Microeconomics-SEC010-1268 • 1268-UCONN-ECON-1201-SEC010-5757",
  "ECON-1201-Principles of Microeconomics-",
  "_198430_1",
  [announcementRow("Quiz 2 moved", "9/24/26, 8:00 AM", "Quiz 2 moves to Friday October 2.")],
);

type Opened = { url: string; target: string };

/** A HuskyCT tab with the helper running in it. */
type PageExtras = {
  /** The helper's saved sync state. Off by default, so the sync that starts on its own does not run in the middle of other tests. */
  sync?: Record<string, unknown>;
  /** What HuskyCT's own data answers, where the default refuses everything. */
  fetch?: (path: string) => Promise<unknown>;
  /** What the page's window.open returns, where the default is a tab that answers nothing. */
  open?: (link: string, target: string) => unknown;
};

function openPage(url: string, html: string, stored?: Basket, extras: PageExtras = {}) {
  const window = new Window({ url });
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

test("the Courses page puts every course and the to-do list in the basket as soon as the panel mounts", () => {
  const page = openPage("https://lms.uconn.edu/ultra/course", COURSES_PAGE);
  const basket = page.basket();

  assert.deepEqual(
    basket.courses.map((course) => [course.id, course.code]),
    [
      ["_203765_1", "MATH 1070Q"],
      ["_198430_1", "ECON 1201"],
    ],
  );
  assert.equal(basket.todos.length, 1);
  assert.match(page.text('[data-role="basket"]'), /1 deadline\(s\) and 0 announcement\(s\), from 0 of 2 course/);
  // With something to send, Send takes over as the leading button.
  assert.equal(page.button("todos").classList.contains("primary"), true);
  assert.equal(page.button("collectall").classList.contains("primary"), false);
});

test("a course's Announcements page adds them, with the posted date the live page shows", () => {
  const page = openPage("https://lms.uconn.edu/ultra/courses/_203765_1/announcements", MATH_ANNOUNCEMENTS);
  const math = page.basket().courses.find((course) => course.id === "_203765_1");

  assert.ok(math?.announcementsAt, "the course was not marked collected");
  assert.equal(math.code, "MATH 1070Q");
  assert.deepEqual(
    math.announcements.map((a) => [a.title, a.posted]),
    [
      ["Exam 1 is NEXT Tuesday!", "9/22/26, 9:00 AM"],
      ["Office Hours", "9/20/26, 1:15 PM"],
    ],
  );
  assert.equal(
    math.announcements[0].body,
    "Exam 1 is on Tuesday September 29th and covers Chapter 4.",
    "the body repeats the title",
  );
  // The course's own title link is the same course, not a second one.
  assert.equal(page.basket().courses.length, 1);
  assert.match(page.text('[data-role="hint"]'), /announcements are in the basket/);
});

test("the course outline, which shows no announcements, collects none and points to Collect everything", () => {
  const outline = `<div class="courseTitle-abc">MATH-1070Q-Mathematics for Business and Economics-SEC100-1268</div>`;
  const page = openPage("https://lms.uconn.edu/ultra/courses/_203765_1/outline", outline);

  assert.equal(page.basket().courses.every((course) => !course.announcementsAt), true);
  assert.match(page.text('[data-role="hint"]'), /Collect everything/);
});

test("announcements seen anywhere but a course's Announcements tab are left behind, not sent unattributed", () => {
  // The Stream page shows announcements from every course with nothing to say
  // which one each came from, and one nobody can place is worse than one not sent.
  const page = openPage(
    "https://lms.uconn.edu/ultra/stream",
    `<div class="announcement-list">${announcementRow("Orphaned", "9/20/26, 1:15 PM", "Whose is this?")}</div>`,
  );

  assert.deepEqual(page.basket().courses, []);
});

test("an empty Announcements page counts only once it has stayed empty", () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  const window = new Window({ url: "https://lms.uconn.edu/ultra/courses/_198430_1/announcements" });
  windows.push(window);
  window.document.body.innerHTML = announcementsPage(
    "ECON-1201-Principles of Microeconomics-SEC010-1268",
    "ECON-1201-",
    "_198430_1",
    [],
  );
  const path = "/ultra/courses/_198430_1/announcements";

  const loading = helper.captureIntoBasket(helper.emptyBasket(), window.document, path, new Date(), false);
  assert.equal(loading.basket.courses.some((course) => course.announcementsAt), false, "a loading page was taken as empty");

  const settled = helper.captureIntoBasket(helper.emptyBasket(), window.document, path, new Date(), true);
  const econ = settled.basket.courses.find((course) => course.id === "_198430_1");
  assert.ok(econ?.announcementsAt, "a course with no announcements was never ticked off");
  assert.deepEqual(plain(econ.announcements), []);
});

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

function basketWith(courses: Basket["courses"], todos: Basket["todos"] = []): Basket {
  return { version: 1, courses, todos, todosAt: todos.length ? "2026-09-27T12:00:00.000Z" : null };
}

test("one Send carries every course's announcements and the deadlines, into one reused dashboard tab", async () => {
  // MATH was collected earlier; the student presses Send on ECON's Announcements page.
  const stored = basketWith(
    [
      {
        id: "_203765_1",
        code: "MATH 1070Q",
        announcements: [{ title: "Exam 1 is NEXT Tuesday!", body: "Covers Chapter 4.", posted: "9/22/26, 9:00 AM" }],
        announcementsAt: "2026-09-27T12:00:00.000Z",
      },
      { id: "_198430_1", code: "ECON 1201", announcements: [], announcementsAt: null },
    ],
    [
      {
        uid: "huskyct-todo-_3867214_1",
        start: "2026-09-26T03:59:00.000Z",
        title: "Section 4.7 Homework",
      },
    ],
  );
  const page = openPage("https://lms.uconn.edu/ultra/courses/_198430_1/announcements", ECON_ANNOUNCEMENTS, stored);

  page.button("todos").click();
  await until(() => page.opened.length > 0);

  assert.equal(page.opened.length, 1);
  assert.equal(page.opened[0].target, "betterhuskyct", "each Send would open a new tab");
  assert.equal(page.fakeTab.opener, null, "the dashboard tab kept a handle on HuskyCT");

  const packed = page.opened[0].url.split("#sync=")[1];
  const payload = await decodeSyncPayload(packed);
  assert.ok(payload, "the link did not decode");
  assert.deepEqual(
    payload.announcements.map((a) => [a.courseCode, a.title]).sort(),
    [
      ["ECON 1201", "Quiz 2 moved"],
      ["MATH 1070Q", "Exam 1 is NEXT Tuesday!"],
    ],
    "the page on screen, or an earlier course, was left out",
  );
  assert.equal(payload.feeds.flatMap((feed) => feed.events).length, 1);
  await until(() => /Opened BetterHuskyCT/.test(page.text('[data-role="status"]')));
});

test("Send with nothing collected says what to do instead of opening an empty dashboard", () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "");

  page.button("todos").click();

  assert.equal(page.opened.length, 0);
  assert.match(page.text('[data-role="status"]'), /Nothing collected yet/);
});

test("a basket too big for one link keeps every course's newest announcements", async () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  // Bodies that do not compress, so the link genuinely overflows.
  let seed = 7;
  const noise = (length: number) =>
    Array.from({ length }, () => String.fromCharCode(33 + ((seed = (seed * 48271) % 2147483647) % 90))).join("");
  const course = (id: string, code: string) => ({
    id,
    code,
    announcements: Array.from({ length: 25 }, (_, rank) => ({ title: `${code} #${rank}`, body: noise(1200), posted: null })),
    announcementsAt: "2026-09-27T12:00:00.000Z",
  });
  const basket = basketWith([course("_1_1", "MATH 1070Q"), course("_2_1", "ECON 1201"), course("_3_1", "STAT 1000Q")]);

  const built = await helper.basketLink(basket, new Date("2026-09-27T12:00:00Z"));
  const packed = built.link.split("#sync=")[1];

  assert.ok(packed.length <= 30000, `the link is over the limit: ${packed.length}`);
  assert.ok(built.leftOut > 0, "nothing was trimmed, so this test is not testing trimming");
  const payload = await decodeSyncPayload(packed);
  assert.ok(payload);
  for (const code of ["MATH 1070Q", "ECON 1201", "STAT 1000Q"]) {
    assert.ok(
      payload.announcements.some((a) => a.title === `${code} #0`),
      `${code} lost its newest announcement to trimming`,
    );
  }
});

test("Clear basket empties it", () => {
  const page = openPage("https://lms.uconn.edu/ultra/course", COURSES_PAGE);
  assert.equal(page.basket().courses.length, 2);

  // The Courses page would refill it on the next tick, so clear from a page with nothing on it.
  const quiet = openPage("https://lms.uconn.edu/ultra/stream", "", page.basket());
  quiet.button("emptybasket").click();

  assert.deepEqual(quiet.basket(), plain(quiet.helper.emptyBasket()));
  assert.match(quiet.text('[data-role="status"]'), /Basket cleared/);
});

// --- collecting everything in one press ------------------------------------------

/**
 * A small stand-in for HuskyCT's single-page app, shaped like what was measured
 * on 2026-09-27:
 *
 * - On a wide screen the Courses page lists every course as a card straight
 *   away. On a narrow one it shows only the recently opened courses, a to-do
 *   list and a "View All" button. "View All" puts up one `article` per course with an empty
 *   `data-course-id`, and fills them in a moment later — on the live page, as
 *   they scroll into view. Past terms and inaccessible courses are listed too.
 * - A course's Announcements page renders after a delay, and moving from one
 *   course to another leaves the previous course's rows on screen for a while
 *   under the new address — the case that must not be misfiled.
 * - One course's page never renders at all.
 */
function card(id: string, idText: string, name: string, extraClass = "") {
  return (
    `<article class="element-card course-element-card ${extraClass}" data-course-id="${id}">` +
    `<span id="course-id-${id}">${idText}</span><h4 id="course-name-${id}">${name}</h4></article>`
  );
}

const ALL_COURSES = [
  card("_203765_1", "1268-UCONN-MATH-1070Q-SEC100-1191", "MATH-1070Q-Mathematics for Business and Economics-SEC100-1268"),
  card("_198430_1", "1268-UCONN-ECON-1201-SEC010-5757", "ECON-1201-Principles of Microeconomics-SEC010-1268"),
  card("_200541_1", "1268-UCONN-NRE-1000E-SEC002-3874", "NRE-1000E-Environmental Science-SEC002-1268"),
  card("_201693_1", "1268-UCONN-STAT-1000Q-SEC015D-3618", "STAT-1000Q-Introduction to Statistics I-SEC015D-1268"),
  card("_201463_1", "1268-UCONN-SOCI-1501-SEC005-1068", "SOCI-1501-Race, Class, and Gender-SEC005-1268"),
  card("_100001_1", "1263-UCONN-CHEM-1127Q-SEC001-1000", "CHEM-1127Q-General Chemistry-SEC001-1263"),
  card("_200999_1", "1268-UCONN-HIST-1300-SEC001-2000", "HIST-1300-United States History-SEC001-1268", "inactive-link"),
].join("");

const RECENT_COURSES =
  `<button data-analytics-id="base.courses.recentCoursesView.viewAllButton">View All</button>` +
  MATH_LINK +
  ECON_LINK +
  `<h2>To Do</h2>${TODO}`;

const NRE_ANNOUNCEMENTS = announcementsPage(
  "NRE-1000E-Environmental Science-SEC002-1268 • 1268-UCONN-NRE-1000E-SEC002-3874",
  "NRE-1000E-Environmental Science-",
  "_200541_1",
  [announcementRow("Field trip Friday", "9/23/26, 10:00 AM", "Meet at the Fenton River trailhead at 9.")],
);

const STAT_EMPTY = announcementsPage(
  "STAT-1000Q-Introduction to Statistics I-SEC015D-1268",
  "STAT-1000Q-Introduction to Statistics I-",
  "_201693_1",
  [],
);

const WIDE_COURSES = ALL_COURSES + `<h2>To Do</h2>${TODO}`;

/** A card from the Calendar's "Due dates" view, as the live page renders it. */
function dueItem(title: string, due: string, courseId: string, courseText: string) {
  return (
    `<div class="element-card due-item element-card-deadline course-color-8"><div class="element-details">` +
    `<div class="name"><a href="javascript:void(0);">${title}</a></div>` +
    `<div class="content"><span>Due date: ${due}</span><span> ∙ </span>` +
    `<a href="https://lms.uconn.edu/ultra//${courseId}/outline">${courseText}</a></div></div></div>`
  );
}

const MATH_TEXT = "1268-UCONN-MATH-1070Q-SEC100-1191: MATH-1070Q-Mathematics for Business and Economics-SEC100-1268";
const STAT_TEXT = "1268-UCONN-STAT-1000Q-SEC015D-3618: STAT-1000Q-Introduction to Statistics I-SEC015D-1268";
const DUE_SOON = [
  dueItem("Section 5.1 Homework", "10/2/26, 11:59 PM (EDT)", "_203765_1", MATH_TEXT),
  dueItem("Assignment 2", "10/9/26, 11:59 PM (EDT)", "_201693_1", STAT_TEXT),
].join("");
// What the view adds once scrolled: the rest of the term, past the switch to EST.
const DUE_LATER = dueItem("Assignment 9", "12/11/26, 11:59 PM (EST)", "_201693_1", STAT_TEXT);
const CALENDAR = `<button id="bb-calendar1-deadline" analytics-id="components.directives.calendar.viewSwitch.deadline">Due Dates</button>`;

/**
 * `broken` stands for a HuskyCT release that changed the Courses page past
 * recognition; `nocalendar` for one that moved the Calendar's Due dates view.
 */
function fakeHuskyct(
  window: Window,
  layout: "narrow" | "wide" | "broken" | "nocalendar" = "narrow",
  delays = { render: 40, stale: 150 },
) {
  const main = window.document.querySelector("main")!;
  const visited: string[] = [];
  let generation = 0;

  const announcementPages: Record<string, string> = {
    _203765_1: MATH_ANNOUNCEMENTS,
    _198430_1: ECON_ANNOUNCEMENTS,
    _200541_1: NRE_ANNOUNCEMENTS,
    _201693_1: STAT_EMPTY,
    // _201463_1 (SOCI) never renders.
  };

  window.addEventListener("popstate", () => {
    const path = window.location.pathname;
    visited.push(path);
    const mine = ++generation;
    const render = (html: string, after: number) =>
      setTimeout(() => {
        if (mine === generation) main.innerHTML = html;
      }, after);

    if (path === "/ultra/course") {
      render(
        layout === "broken" ? "<p>A new Courses page</p>" : layout === "wide" ? WIDE_COURSES : RECENT_COURSES,
        delays.render,
      );
      return;
    }
    if (path === "/ultra/calendar" && layout !== "nocalendar") {
      render(CALENDAR, delays.render);
      return;
    }
    const match = path.match(/^\/ultra\/courses\/([^/]+)\/announcements/);
    if (match) {
      const html = announcementPages[match[1]];
      // The previous page stays up for a while under the new address.
      if (html) render(html, delays.stale);
      return;
    }
    render(`<p>${path}</p>`, delays.render);
  });

  window.document.addEventListener("click", (event) => {
    const target = event.target as unknown as { getAttribute?: (name: string) => string | null };
    if (target.getAttribute?.("id") === "bb-calendar1-deadline") {
      // A few weeks first; the rest of the term arrives as the list scrolls.
      setTimeout(() => {
        main.innerHTML = CALENDAR + DUE_SOON;
      }, delays.render);
      setTimeout(() => {
        main.innerHTML = CALENDAR + DUE_SOON + DUE_LATER;
      }, delays.render + 120);
    }
    if (target.getAttribute?.("data-analytics-id") === "base.courses.recentCoursesView.viewAllButton") {
      setTimeout(() => {
        main.innerHTML = `<article class="element-card inactive-link" data-course-id=""></article>`.repeat(7);
      }, delays.render);
      setTimeout(() => {
        main.innerHTML = ALL_COURSES;
      }, delays.render + 200);
    }
  });

  return { visited };
}

// The grades and files walks run inside a collection too, so they are given the
// same short waits: a course page that never comes must not cost the real pause.
const FAST = {
  every: 20,
  pageTimeout: 800,
  emptySettle: 250,
  todoSettle: 100,
  gap: 0,
  retryPause: 0,
  settle: 0,
  outlineTimeout: 800,
  documentTimeout: 800,
  expandPause: 0,
  documentSettle: 0,
};

test("one press also reads every course's gradebook and files, not only its announcements", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main><p>Activity stream</p></main>");
  fakeHuskyct(page.window);

  const report = plain(await page.helper.collectEverything(FAST));

  // The same walks the Grades and Materials buttons make, run inside the press.
  assert.ok(report.grades, "the gradebooks were walked");
  assert.ok(report.materials, "the course files were walked");
  assert.ok(Array.isArray(report.grades.courses));
  assert.ok(Array.isArray(report.materials.courses));
});

test("a walk that falls short in a tab in the background says why", async () => {
  const keys = async (hidden: boolean) => {
    const page = openPage("https://lms.uconn.edu/ultra/stream", "<main><p>Activity stream</p></main>");
    fakeHuskyct(page.window);
    Object.defineProperty(page.window.document, "hidden", { value: hidden, configurable: true });
    const report = plain(await page.helper.collectEverything(FAST));
    return { keys: report.problems.map((problem) => problem.key), short: [report.grades, report.materials].some((walked) => walked && (walked.courses as Array<{ skipped?: boolean }>).some((course) => course.skipped)) };
  };

  const back = await keys(true);
  assert.ok(back.short, "the stand-in HuskyCT does not serve every gradebook, so something fell short");
  assert.ok(back.keys.includes("problemBackground"), "a walk that fell short in the background is told why");
  assert.ok(!(await keys(false)).keys.includes("problemBackground"), "in the front it is not blamed on the background");
});

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

test("pressing Sync reads HuskyCT's data, opens no page, and sends it to BetterHuskyCT", async () => {
  const messages: Array<{ protocol: string; kind: string }> = [];
  const page: ReturnType<typeof openPage> = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>", undefined, {
    fetch: syncData(),
    open: () => appTab(() => page.window, messages),
  });
  let moved = 0;
  page.window.addEventListener("popstate", () => moved++);

  page.button("sync").click();
  await until(() => /Sent to BetterHuskyCT/.test(page.text('[data-role="sync"]')), 8000);

  assert.match(page.text('[data-role="sync"]'), /Synced 2 course\(s\): 1 announcement\(s\), 1 grade item\(s\)/);
  assert.equal(page.opened.length, 1);
  assert.equal(page.opened[0].target, "betterhuskyct");
  // Deadlines and announcements, then the gradebooks.
  assert.deepEqual(messages.filter((message) => message.kind !== "hello").map((message) => message.protocol), ["betterhuskyct/tasks@1", "betterhuskyct/grades@1"]);
  assert.equal(moved, 0, "a page was opened");
  assert.equal(page.window.location.pathname, "/ultra/stream");
  assert.deepEqual(page.basket().courses.find((course) => course.id === "_203765_1")?.announcements.map((a) => a.title), ["Exam 1 is NEXT Tuesday!"]);
  const state = plain(page.helper.readSyncState(page.window.localStorage));
  assert.equal(state.pending, false);
  assert.ok(state.at && state.grades, "the reading was not kept");
  assert.equal(page.text('[data-act="sync"]'), "Sync", "the button did not come back");
});

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
  assert.deepEqual(done, { protocol: SYNC_PROTOCOL, kind: "done", ok: true, courses: 2, announcements: 1, gradeItems: 1, skipped: [], sent: true });
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
});

test("a sync that arrives only in part is not called sent, and stays waiting", async () => {
  const messages: Array<{ protocol: string; kind: string }> = [];
  const page: ReturnType<typeof openPage> = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>", undefined, {
    fetch: syncData(),
    open: () => appTab(() => page.window, messages, true),
  });

  page.button("sync").click();
  await until(() => /Only part of it reached/.test(page.text('[data-role="sync"]')), 8000);

  assert.doesNotMatch(page.text('[data-role="sync"]'), /Sent to BetterHuskyCT/);
  assert.equal(plain(page.helper.readSyncState(page.window.localStorage)).pending, true, "a half-sent sync was marked as done");
});

test("when the browser refuses the tab, the reading is kept and the Send buttons carry it on", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>", undefined, { fetch: syncData(), open: () => null });

  page.button("sync").click();
  await until(() => /Not sent yet/.test(page.text('[data-role="sync"]')), 8000);

  assert.equal(plain(page.helper.readSyncState(page.window.localStorage)).pending, true);
  assert.equal(page.button("sendgrades").hidden, false, "the gradebooks cannot be sent from here");
  assert.equal(page.button("todos").classList.contains("primary"), true, "the announcements cannot be sent from here");
});

test("when nothing can be read this way, Sync says so, moves nothing, and gives the screen back", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>");
  let moved = 0;
  page.window.addEventListener("popstate", () => moved++);

  page.button("sync").click();
  await until(() => /Nothing could be read this way/.test(page.text('[data-role="sync"]')), 8000);

  assert.equal(moved, 0, "it fell back to opening pages");
  assert.equal(page.text('[data-act="sync"]'), "Sync");
  assert.equal(page.button("collectall").disabled, false);
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

test("the course list comes from HuskyCT's data, while the to-do list is still read from the Courses page", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main><p>Activity stream</p></main>");
  const huskyct = fakeHuskyct(page.window);
  const membership = (id: string, displayName: string, courseId: string) => ({
    courseId: id,
    isAvailable: true,
    userHasHidden: false,
    course: { id, courseId, displayName, isOrganization: false, isAvailable: true, effectiveAvailability: true },
  });
  (page.window as unknown as { fetch: unknown }).fetch = async (path: string) =>
    path.startsWith("/learn/api/v1/users/me/memberships")
      ? new Response(
          JSON.stringify({
            paging: { count: 2, nextPage: "" },
            results: [
              membership("_203765_1", "MATH-1070Q-Mathematics for Business and Economics-SEC100-1268", "1268-UCONN-MATH-1070Q-SEC100-1191"),
              membership("_198430_1", "ECON-1201-Principles of Microeconomics-SEC010-1268", "1268-UCONN-ECON-1201-SEC010-5757"),
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      : new Response("{}", { status: 404 });

  const report = plain(await page.helper.collectEverything(FAST));

  // Two courses from the data, where the pages would have found five.
  assert.equal(report.courses, 2);
  assert.equal(report.collected, 2);
  assert.ok(huskyct.visited.includes("/ultra/course"), "the to-do list was not read from the Courses page");
  assert.equal(page.basket().todos.length, 1);
  assert.deepEqual(plain(page.basket().courses.map((course) => course.id)).sort(), ["_198430_1", "_203765_1"]);
});

test("announcements come from HuskyCT's own data when it answers, and from the page for a course whose answer fails", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main><p>Activity stream</p></main>");
  const huskyct = fakeHuskyct(page.window);
  const answers: Record<string, unknown> = {
    _203765_1: { paging: { nextPage: "" }, results: [{ title: "From the data", body: { displayText: "<p>Straight <b>from</b> HuskyCT</p>" }, startDateRestriction: "2026-09-25T20:00:00.000Z", isDraft: false }] },
    _198430_1: { paging: { nextPage: "" }, results: [] },
  };
  (page.window as unknown as { fetch: unknown }).fetch = async (path: string) => {
    const id = /courses\/([^/]+)\/announcements/.exec(path)?.[1] ?? "";
    return id in answers
      ? new Response(JSON.stringify(answers[id]), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("{}", { status: 500 });
  };

  const report = plain(await page.helper.collectEverything(FAST));

  const basket = page.basket();
  const course = (id: string) => basket.courses.find((entry) => entry.id === id);
  assert.deepEqual(course("_203765_1")?.announcements.map((a) => [a.title, a.body]), [["From the data", "Straight from HuskyCT"]]);
  assert.ok(course("_198430_1")?.announcementsAt, "a course with no announcements was not ticked off");
  // Those two never had their Announcements page opened; the course whose answer failed did.
  assert.ok(!huskyct.visited.some((path) => /_203765_1\/announcements|_198430_1\/announcements/.test(path)), "opened a page it had the data for");
  assert.ok(huskyct.visited.some((path) => /_200541_1\/announcements/.test(path)), "did not fall back to the page");
  assert.deepEqual(course("_200541_1")?.announcements.map((a) => a.title), ["Field trip Friday"]);
  assert.equal(report.collected, 4);
});

test("one press reads the to-do list and every current course, then goes back where it started (narrow screen)", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main><p>Activity stream</p></main>");
  const huskyct = fakeHuskyct(page.window);

  const report = plain(await page.helper.collectEverything(FAST));

  // Five current courses: the two recent ones and three found only under View All.
  // The past-term CHEM course and the inaccessible HIST one are not visited.
  assert.equal(report.courses, 5);
  assert.equal(report.collected, 4);
  assert.deepEqual(report.skipped, ["SOCI 1501"], "the course whose page never loads was not reported");
  assert.ok(!huskyct.visited.some((path) => /_100001_1|_200999_1/.test(path)), "walked into a course it should skip");

  const basket = page.basket();
  const titles = (id: string) => basket.courses.find((course) => course.id === id)?.announcements.map((a) => a.title);
  assert.deepEqual(titles("_203765_1"), ["Exam 1 is NEXT Tuesday!", "Office Hours"]);
  assert.deepEqual(titles("_198430_1"), ["Quiz 2 moved"]);
  // Reached straight from ECON's page, whose rows linger for a while: they must
  // not be filed under NRE.
  assert.deepEqual(titles("_200541_1"), ["Field trip Friday"]);
  assert.ok(basket.courses.find((course) => course.id === "_201693_1")?.announcementsAt, "an empty course was not ticked off");
  assert.equal(basket.courses.find((course) => course.id === "_201463_1")?.announcementsAt, null);
  assert.equal(basket.todos.length, 1);
  // The whole term's due dates, including the ones that only load on scrolling.
  assert.equal(report.dueDates, 3);
  assert.deepEqual(basket.dueDates?.map((item) => item.title), ["Section 5.1 Homework", "Assignment 2", "Assignment 9"]);
  assert.equal(page.helper.basketSummary(basket).deadlines, 4);

  assert.equal(page.window.location.pathname, "/ultra/stream", "it did not go back to where it started");
});

test("stopping halfway keeps what was already read", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>");
  fakeHuskyct(page.window);
  let checks = 0;

  const report = plain(await page.helper.collectEverything({ ...FAST, shouldStop: () => checks++ >= 2 }));

  assert.equal(report.stopped, true);
  assert.equal(report.collected, 1);
  assert.equal(page.basket().courses.filter((course) => course.announcementsAt).length, 1);
  assert.equal(page.window.location.pathname, "/ultra/stream");
});

test("the panel's Collect everything turns into Stop while it runs, and Send leads afterwards", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>");
  fakeHuskyct(page.window);

  page.button("collectall").click();
  await until(() => page.text('[data-act="collectall"]') === "Stop");
  assert.equal(page.button("todos").disabled, true, "Send stayed usable in the middle of a walk");
  await until(() => /Reading/.test(page.text('[data-role="status"]')));

  page.button("collectall").click();
  await until(() => page.text('[data-act="collectall"]') === "Collect everything", 10000);

  assert.match(page.text('[data-role="status"]'), /Stopped/);
  assert.equal(page.button("todos").disabled, false);
  // The to-do list was read before the stop, so there is something to send.
  assert.equal(page.button("todos").classList.contains("primary"), true);
});

test("Collect everything opens no tab on the press, so HuskyCT stays in front for the whole walk", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>");
  fakeHuskyct(page.window);

  page.button("collectall").click();
  await until(() => page.text('[data-act="collectall"]') === "Stop");
  // A tab opened now would take the focus, and a tab in the back does not load its pages.
  assert.equal(page.opened.length, 0, "a tab was opened while the walk was still to run");

  page.button("collectall").click();
  await until(() => page.text('[data-act="collectall"]') === "Collect everything", 10000);
  assert.equal(page.opened.length, 0, "a stopped walk is not sent, so it looks for no tab");
});

test("the diagnose button records, then stops and says when there was nothing to record", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>");
  const start = page.text('[data-act="recapi"]');

  page.button("recapi").click();
  await until(() => page.text('[data-act="recapi"]') !== start);
  assert.match(page.text('[data-role="rec"]'), /Recording/);

  page.button("recapi").click();
  await until(() => page.text('[data-act="recapi"]') === start);
  assert.match(page.text('[data-role="rec"]'), /Nothing was recorded/);
});

test("only this term's courses are read, and a later term's too", () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  const cards = [
    { id: "_1_1", code: "MATH 1070Q", term: "1268" },
    { id: "_2_1", code: "CHEM 1127Q", term: "1263" },
    { id: "_3_1", code: "ECON 1202", term: "1273" },
    { id: "_4_1", code: null, term: null },
  ];

  const fall = new Date("2026-09-27T12:00:00");

  const chosen = plain(helper.coursesToCollect(cards, [{ id: "_1_1", code: "MATH 1070Q" }], fall));
  assert.deepEqual(chosen.map((course) => course.id), ["_1_1", "_3_1", "_4_1"]);

  // A wide screen shows no recent courses: the date says Fall 2026, so next
  // spring's course, enrolled early, must not push this term's out.
  const byDate = plain(helper.coursesToCollect(cards, [], fall));
  assert.deepEqual(byDate.map((course) => course.id), ["_1_1", "_3_1", "_4_1"]);

  // A break between terms, with nothing current: the newest term stands in.
  const pastOnly = cards.filter((card) => card.term === "1263" || card.term === null);
  const inBreak = plain(helper.coursesToCollect(pastOnly, [], fall));
  assert.deepEqual(inBreak.map((course) => course.id), ["_2_1", "_4_1"]);
});

test("a course page still showing the last course's heading is not filed under the new one", () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  const window = new Window({ url: "https://lms.uconn.edu/ultra/courses/_198430_1/announcements" });
  windows.push(window);
  // ECON's address, MATH's page: the moment between the two.
  window.document.body.innerHTML = MATH_ANNOUNCEMENTS;
  const basket = basketWith([{ id: "_198430_1", code: "ECON 1201", announcements: [], announcementsAt: null }]);

  const result = helper.captureIntoBasket(basket, window.document, "/ultra/courses/_198430_1/announcements", new Date(), true);

  assert.equal(plain(result.basket).courses[0].announcementsAt, null, "MATH's announcements were filed under ECON");
});

test("UConn term codes follow the calendar", () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  assert.equal(helper.termCodeFor(new Date("2026-09-27T12:00:00")), 1268);
  assert.equal(helper.termCodeFor(new Date("2027-02-01T12:00:00")), 1273);
  assert.equal(helper.termCodeFor(new Date("2027-06-15T12:00:00")), 1275);
  assert.equal(helper.termCodeFor(new Date("2026-12-10T12:00:00")), 1268);
});

test("on a wide screen, where the Courses page lists every course as a card, one press still reads them all", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main><p>Activity stream</p></main>");
  const huskyct = fakeHuskyct(page.window, "wide");

  const report = plain(await page.helper.collectEverything(FAST));

  assert.equal(report.courses, 5, "the wide layout's course cards were not read");
  assert.equal(report.collected, 4);
  assert.ok(!huskyct.visited.some((path) => /_100001_1|_200999_1/.test(path)), "walked into a course it should skip");
  assert.equal(page.basket().todos.length, 1);
  assert.equal(page.window.location.pathname, "/ultra/stream");
});

test("opening the wide Courses page puts its course cards in the basket, this term's only", () => {
  const page = openPage("https://lms.uconn.edu/ultra/course", WIDE_COURSES);
  const ids = page.basket().courses.map((course) => course.id);

  assert.ok(ids.includes("_200541_1"), "a course listed only as a card was missed");
  assert.ok(!ids.includes("_100001_1"), "a past term's course was added");
  assert.ok(!ids.includes("_200999_1"), "an inaccessible course was added");
});

// --- the whole term's due dates ---------------------------------------------------

test("a due time with its zone is read as that exact instant, wherever the reader is", () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  const window = new Window({ url: "https://lms.uconn.edu/ultra/calendar" });
  windows.push(window);
  window.document.body.innerHTML = DUE_SOON + DUE_LATER;

  const items = helper.collectDueDates(window.document);

  assert.deepEqual(
    plain(items.map((item) => [item.title, item.course, new Date(item.due).toISOString()])),
    [
      ["Section 5.1 Homework", "MATH 1070Q", "2026-10-03T03:59:00.000Z"],
      ["Assignment 2", "STAT 1000Q", "2026-10-10T03:59:00.000Z"],
      // EST after the clocks change: an hour later in UTC.
      ["Assignment 9", "STAT 1000Q", "2026-12-12T04:59:00.000Z"],
    ],
  );
  assert.equal(items[0].uid, "huskyct-due-_203765_1-Section-5.1-Homework");
});

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

test("a walk that finds nothing where it should says which step, instead of reporting done", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>");
  fakeHuskyct(page.window, "broken");

  const report = plain(await page.helper.collectEverything(FAST));

  assert.deepEqual(report.problems.map((problem) => problem.key), ["problemCoursesPage"]);
  assert.match(page.helper.problemsText(report.problems), /^Self-check: the Courses page did not show its course list/);
});

test("a missing Due dates view is reported, and the rest of the walk still runs", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>");
  fakeHuskyct(page.window, "nocalendar");

  const report = plain(await page.helper.collectEverything(FAST));

  assert.deepEqual(report.problems.map((problem) => problem.key), ["problemDueDatesView"]);
  assert.equal(report.collected, 4, "one missing view stopped the announcements too");
});

test("a walk with nothing wrong reports no problems", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>");
  fakeHuskyct(page.window);

  const report = plain(await page.helper.collectEverything(FAST));

  assert.deepEqual(report.problems, []);
  assert.equal(page.helper.problemsText(report.problems), "");
});


test("pressed on a course's page, the walk still reads every course, not the page it left", async () => {
  // The course page is full of links into /ultra/courses/, and stays on screen
  // for a moment after the move — it used to be read as the Courses page.
  const page = openPage("https://lms.uconn.edu/ultra/courses/_203765_1/announcements", `<main>${MATH_ANNOUNCEMENTS}</main>`);
  // A Courses page slower to draw than the to-do list's wait, as a busy one is.
  fakeHuskyct(page.window, "narrow", { render: 150, stale: 150 });

  const report = plain(await page.helper.collectEverything(FAST));

  assert.equal(report.courses, 5, "the walk read the course page it started on as the course list");
  assert.deepEqual(report.problems, []);
});
