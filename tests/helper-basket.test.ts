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
  todos: Array<{ uid: string; start: string; title: string }>;
  todosAt: string | null;
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
  ) => Array<{ id: string; code: string | null }>;
  collectEverything: (options?: Record<string, unknown>) => Promise<{
    courses: number;
    collected: number;
    skipped: string[];
    stopped: boolean;
  }>;
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
function openPage(url: string, html: string, stored?: Basket) {
  const window = new Window({ url });
  windows.push(window);
  window.document.body.innerHTML = html;
  if (stored) window.localStorage.setItem("huskypilot.helper.basket.v1", JSON.stringify(stored));

  const opened: Opened[] = [];
  const fakeTab = { opener: {} as unknown, focus() {} };
  (window as unknown as { open: (url: string, target: string) => unknown }).open = (link, target) => {
    opened.push({ url: String(link), target: String(target) });
    return fakeTab;
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
 * - The Courses page shows only the recently opened courses, a to-do list and a
 *   "View All" button. "View All" puts up one `article` per course with an empty
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

function fakeHuskyct(window: Window, delays = { render: 40, stale: 150 }) {
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
      render(RECENT_COURSES, delays.render);
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

const FAST = { every: 20, pageTimeout: 800, emptySettle: 250, todoSettle: 100, gap: 0 };

test("one press reads the to-do list and every current course, then goes back where it started", async () => {
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

  assert.equal(page.window.location.pathname, "/ultra/stream", "it did not go back to where it started");
});

test("stopping halfway keeps what was already read", async () => {
  const page = openPage("https://lms.uconn.edu/ultra/stream", "<main></main>");
  fakeHuskyct(page.window);
  let checks = 0;

  const report = plain(await page.helper.collectEverything({ ...FAST, shouldStop: () => checks++ >= 1 }));

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

test("only this term's courses are read, and a later term's too", () => {
  const { helper } = openPage("https://lms.uconn.edu/ultra/stream", "");
  const cards = [
    { id: "_1_1", code: "MATH 1070Q", term: "1268" },
    { id: "_2_1", code: "CHEM 1127Q", term: "1263" },
    { id: "_3_1", code: "ECON 1202", term: "1273" },
    { id: "_4_1", code: null, term: null },
  ];

  const chosen = plain(helper.coursesToCollect(cards, [{ id: "_1_1", code: "MATH 1070Q" }]));
  assert.deepEqual(chosen.map((course) => course.id), ["_1_1", "_3_1", "_4_1"]);

  // No recent course to go by: the newest term on the list stands in.
  const newest = plain(helper.coursesToCollect(cards, []));
  assert.deepEqual(newest.map((course) => course.id), ["_3_1", "_4_1"]);
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
