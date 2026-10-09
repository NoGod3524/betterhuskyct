// ==UserScript==
// @name         HuskyCT Helper
// @namespace    https://github.com/NoGod3524/betterhuskyct
// @version      1.16.0
// @description  Collects your HuskyCT deadlines, announcements and course files, and sends them to BetterHuskyCT. Nothing leaves your browser.
// @author       Yinuo (NoGod3524)
// @homepageURL  https://github.com/NoGod3524/betterhuskyct
// @supportURL   https://github.com/NoGod3524/betterhuskyct/issues
// @license      MIT
// @match        https://lms.uconn.edu/*
// @match        https://huskyct.uconn.edu/*
// @match        https://betterhuskyct.vercel.app/*
// @updateURL    https://raw.githubusercontent.com/NoGod3524/betterhuskyct/main/tools/huskyct-helper/huskyct-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/NoGod3524/betterhuskyct/main/tools/huskyct-helper/huskyct-helper.user.js
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        unsafeWindow
// ==/UserScript==

/**
 * HuskyCT Helper.
 *
 * HuskyCT is Blackboard Ultra at lms.uconn.edu — the "huskyct" hostname is kept
 * as a second match only because it may still redirect there.
 *
 * Why this exists: HuskyCT hands out one calendar feed per course, so a semester
 * is a dozen links, and BetterHuskyCT can only take one at a time. This runs inside
 * the browser you are already signed in to and gets the calendar off the page —
 * merging the feed links it can see, or falling back to the events the calendar
 * has already loaded when the page exposes no feeds.
 *
 * What it does NOT do, on purpose:
 *   - It never asks for, stores, or transmits your NetID or password. It uses
 *     the session your browser already has, exactly as the page itself does.
 *   - It never sends anything to a server. There is no network call to anywhere
 *     but lms.uconn.edu.
 *   - The "Report" buttons strip query strings, because a calendar feed URL
 *     carries a token and a report is something you paste into a chat window.
 *
 * It reads pages slowly and only when you press a button, so it does not hammer
 * UConn's systems.
 */

/*
 * `window` below is the page's own window. Granting the userscript manager's storage (1.11.0) also
 * put the script in the manager's sandbox, where `window` is a stand-in: calling the page's fetch
 * through it fails, and a message from the page is not from it. So the page's window is handed in
 * as `window`, and everything reads HuskyCT exactly as it did when the script ran in the page.
 */
(function (window) {
  "use strict";

  // Shown in the panel header and in the PRODID of every file this writes, so
  // it has to agree with `@version` in the metadata block above — otherwise the
  // panel reports a version the browser never installed. A test enforces it.
  const VERSION = "1.16.0";
  const PANEL_WIDTH = 340;

  // ----------------------------------------------------------------- language

  /**
   * The panel speaks the same two languages the dashboard does.
   *
   * The dashboard keeps its choice in `huskypilot.locale.v1`, but the two run on
   * different origins — this one on `lms.uconn.edu`, the dashboard on
   * `betterhuskyct.vercel.app` — and a page cannot read another origin's
   * localStorage. So the two cannot literally share one setting. What they can
   * do is agree: same key name, same two values, same default derived from the
   * browser, so someone who has picked Chinese gets Chinese on both sides
   * without telling either one twice.
   *
   * The chosen language also rides in the sync link, so opening the dashboard
   * after using the panel does not silently switch the reader back.
   */
  const LOCALE_KEY = "huskypilot.locale.v1";
  const LOCALES = ["en", "zh-CN"];

  function detectLocale() {
    try {
      const stored = window.localStorage.getItem(LOCALE_KEY);
      if (LOCALES.indexOf(stored) !== -1) return stored;
    } catch {
      /* a page that blocks storage still gets the browser's own answer */
    }
    const language = String(
      (navigator && (navigator.language || navigator.userLanguage)) || "en",
    );
    return /^zh\b/i.test(language) ? "zh-CN" : "en";
  }

  let locale = detectLocale();

  function setLocale(next) {
    locale = LOCALES.indexOf(next) !== -1 ? next : "en";
    try {
      window.localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      /* not being able to remember it is not a reason to refuse to use it */
    }
  }

  const STRINGS = {
    en: {
      panelTitle: "HuskyCT Helper",
      chip: "HuskyCT Helper",
      showPanel: "Show the HuskyCT Helper panel",
      hidePanel: "Hide the panel",
      sendDeadlines: "Send everything to BetterHuskyCT",
      privacy: "Nothing is uploaded. Everything stays in this browser.",
      autoOn: "Sync on its own when HuskyCT opens: on",
      autoOff: "Sync on its own when HuskyCT opens: off",
      syncing: "Syncing your courses, announcements and grades…",
      syncingCourse: "Syncing {course} ({index} of {total})…",
      syncDone: "Synced {courses} course(s): {announcements} announcement(s), {items} grade item(s).",
      syncSkipped: " Could not read: {courses}.",
      syncNotSent: " Not sent yet. Press Sync on BetterHuskyCT to bring it over.",
      syncAutoReady: " Read on its own. Press Sync to send it to BetterHuskyCT.",
      syncNoData: "Nothing could be read this way. Press Collect everything instead.",
      syncNoDataWhy: " (HuskyCT said: {detail}.)",
      guideTodo:
        "Press Collect everything: the panel reads this to-do list, every course's announcements, gradebooks and files by itself, then sends them to BetterHuskyCT.",
      guideCourse: "Press Collect everything to read every course's announcements, this one included.",
      guideAnnouncements: "This course's announcements are in the basket.",
      guideNeither:
        "Press Collect everything: the panel opens the Courses page and each course by itself, then brings you back here.",
      languageLabel: "中文",
      basketEmpty: "The basket is empty.",
      basketSummary:
        "In the basket: {deadlines} deadline(s) and {announcements} announcement(s), from {collected} of {courses} course(s).",
      collectAll: "Collect everything",
      stopCollecting: "Stop",
      collectingCourses: "Reading your courses and to-do list…",
      collectingGrades: "Reading {course}'s gradebook ({index} of {total})…",
      collectingMaterials: "Reading {course}'s files ({index} of {total})…",
      problemGradesWalk: "The gradebooks could not be read this time. Press Grades to try them alone.",
      problemMaterialsWalk: "The course files could not be read this time. Press Materials to try them alone.",
      sentPartTasks: "{deadlines} deadline(s) and {announcements} announcement(s)",
      sentPartGrades: "the gradebooks of {courses} course(s)",
      sentPartFiles: "{files} file(s)",
      sentPartsJoin: "; ",
      sentAll: " Sent to BetterHuskyCT: {parts}.",
      sentPartial: " Only part of it reached BetterHuskyCT ({parts}). Press Sync on BetterHuskyCT for the rest.",
      collectingDueDates: "Reading the term's due dates…",
      selfCheck: "Self-check: {problems}",
      problemCoursesPage: "the Courses page did not show its course list — HuskyCT may have changed.",
      problemNoCourses: "HuskyCT's course list gave no current-term course.",
      problemDueDatesView:
        "HuskyCT's calendar data gave no due dates — it may have changed, so only this week's to-do list was read.",
      problemOutlines: "these courses' content could not be read: {courses}.",
      problemFileAddress: "{count} file(s) had no download address — HuskyCT may have changed.",
      problemNoContent: "no course showed any content — HuskyCT may have changed.",
      materialsFound:
        "Found {files} file(s), {videos} video(s), {links} link(s) and {tools} tool(s) in {courses} course(s).",
      materialsStopped: "Stopped. What was found so far is below.",
      gradesFound: "Found {items} gradebook item(s), {scored} with a score, in {courses} course(s).",
      gradesStopped: "Stopped. What was found so far is below.",
      problemGrades: "these courses' grades could not be read completely: {courses}.",
      problemSignedOut: "HuskyCT asked you to sign in again part-way through. Sign in, then press Collect everything once more.",
      sendingMaterial: "Sending {index} of {total}: {name}",
      collectingCourse: "Reading {course} ({index} of {total})…",
      collectedAll: "Done: {courses} course(s) read.",
      collectSkipped: " Could not open: {courses}.",
      collectStopped: "Stopped. What was read so far is in the basket.",
      collectFailed: "Collecting stopped with an error: {message}",
      sendingToBhc: " Sending it to BetterHuskyCT…",
      sendToBhcFailed: " Could not reach BetterHuskyCT on its own. Open it and press Sync there.",
      clearBasket: "Clear basket",
      basketCleared: "Basket cleared.",
      basketNothing: "Nothing collected yet.",
      basketNothingHint: "Press Collect everything first.",
      leftOut: " {count} older announcement(s) stayed behind to keep the link small.",
      // Status and hint lines, reached through the panel rather than baked in at
      // the point of use, so nothing has to be re-translated after the fact.
      popupBlocked:
        "Your browser blocked the new tab, so nothing opened. Open it from here:",
      popupBlockedHint:
        "Look for a popup-blocked icon in the address bar and allow popups for HuskyCT, or use the link above.",
      openedTitle: "Opened BetterHuskyCT with {deadlines} deadline(s){announcements}.",
      openedHint:
        "Press Apply there and they are in. Nothing was uploaded — the data travels inside the link.",
      sentWithAnnouncements: " and {count} announcement(s)",
      sendingTitle: "Sending {deadlines} deadline(s){announcements} to BetterHuskyCT…",
      linkFailed: "Could not build the link: {message}",
    },
    "zh-CN": {
      panelTitle: "HuskyCT 助手",
      chip: "HuskyCT 助手",
      showPanel: "显示 HuskyCT 助手面板",
      hidePanel: "收起面板",
      sendDeadlines: "全部发给 BetterHuskyCT",
      privacy: "不上传任何东西，全部留在这个浏览器里。",
      autoOn: "打开 HuskyCT 时自动同步：开",
      autoOff: "打开 HuskyCT 时自动同步：关",
      syncing: "正在同步课程、公告和成绩……",
      syncingCourse: "正在同步 {course}（第 {index} / {total} 门）……",
      syncDone: "已同步 {courses} 门课：{announcements} 条公告、{items} 项成绩。",
      syncSkipped: " 没能读取：{courses}。",
      syncNotSent: " 还没发送，在 BetterHuskyCT 上按「同步」就会送过去。",
      syncAutoReady: " 已自动读取，按「同步」发给 BetterHuskyCT。",
      syncNoData: "这种方式读不到任何东西，请改按「一键收集全部」。",
      syncNoDataWhy: "（HuskyCT 的回应：{detail}）",
      guideTodo: "按「一键收集全部」：面板会自己读取待办、每门课的公告、成绩册和课件，然后发给 BetterHuskyCT。",
      guideCourse: "按「一键收集全部」，读取每门课的公告，包括这一门。",
      guideAnnouncements: "这门课的公告已经收进篮子。",
      guideNeither: "按「一键收集全部」：面板会自己打开 Courses 页和每门课，收完再回到这里。",
      languageLabel: "English",
      basketEmpty: "篮子是空的。",
      basketSummary: "篮子里：{deadlines} 个 deadline、{announcements} 条公告，来自 {courses} 门课中的 {collected} 门。",
      collectAll: "一键收集全部",
      stopCollecting: "停止",
      collectingCourses: "正在读取课程列表和待办……",
      collectingGrades: "正在读取 {course} 的成绩册（第 {index} / {total} 门）……",
      collectingMaterials: "正在读取 {course} 的课件（第 {index} / {total} 门）……",
      problemGradesWalk: "这次没读到成绩册。可以单独按一下「成绩」再试。",
      problemMaterialsWalk: "这次没读到课件。可以单独按一下「课件」再试。",
      sentPartTasks: "{deadlines} 条 deadline、{announcements} 条公告",
      sentPartGrades: "{courses} 门课的成绩册",
      sentPartFiles: "{files} 个课件",
      sentPartsJoin: "；",
      sentAll: " 已发给 BetterHuskyCT：{parts}。",
      sentPartial: " 只有一部分发到了 BetterHuskyCT（{parts}）。剩下的在 BetterHuskyCT 上按「同步」。",
      collectingDueDates: "正在读取整个学期的截止日期……",
      selfCheck: "自检：{problems}",
      problemCoursesPage: "Courses 页没有显示课程列表——HuskyCT 可能改版了。",
      problemNoCourses: "HuskyCT 的课程列表里没有本学期的课程。",
      problemDueDatesView: "读不到 HuskyCT 日历里的截止日期——它可能改版了，所以只读到了本周的待办。",
      problemOutlines: "这些课的课件读取不到：{courses}。",
      problemFileAddress: "有 {count} 个文件找不到下载地址——HuskyCT 可能改版了。",
      problemNoContent: "所有课程的内容页都是空的——HuskyCT 可能改版了。",
      materialsFound: "在 {courses} 门课里找到 {files} 个文件、{videos} 个视频、{links} 个链接、{tools} 个工具。",
      materialsStopped: "已停止。下面是目前找到的内容。",
      gradesFound: "在 {courses} 门课里找到 {items} 项成绩册条目，其中 {scored} 项有分数。",
      gradesStopped: "已停止。下面是目前读到的。",
      problemGrades: "这些课的成绩没能完整读取：{courses}。",
      problemSignedOut: "读取到一半时 HuskyCT 让你重新登录了。请登录后再按一次「一键收集全部」。",
      sendingMaterial: "正在发送 {index}/{total}：{name}",
      collectingCourse: "正在读取 {course}（{index}/{total}）……",
      collectedAll: "完成：读取了 {courses} 门课。",
      collectSkipped: "打不开的课程：{courses}。",
      collectStopped: "已停止。已经读到的内容都在篮子里。",
      collectFailed: "收集时出错停止了：{message}",
      sendingToBhc: "正在发给 BetterHuskyCT……",
      sendToBhcFailed: "没能自动连上 BetterHuskyCT，打开它按一下「同步」。",
      clearBasket: "清空篮子",
      basketCleared: "篮子已清空。",
      basketNothing: "还没有收集到任何内容。",
      basketNothingHint: "先按「一键收集全部」。",
      leftOut: "另有 {count} 条较早的公告为了让链接不太长没有带上。",
      popupBlocked: "浏览器拦下了新标签页，所以什么都没打开。从这里打开：",
      popupBlockedHint: "看看地址栏有没有「已拦截弹窗」的图标，允许 HuskyCT 弹窗；或者点上面的链接。",
      openedTitle: "已打开 BetterHuskyCT，带上了 {deadlines} 条 deadline{announcements}。",
      openedHint: "在那里按 Apply 就进去了。没有上传任何东西——数据就在链接里。",
      sentWithAnnouncements: "和 {count} 条公告",
      sendingTitle: "正在把 {deadlines} 条 deadline{announcements} 发给 BetterHuskyCT…",
      linkFailed: "生成链接失败：{message}",
    },
  };

  function t(key, params) {
    const table = STRINGS[locale] || STRINGS.en;
    let text = table[key] ?? STRINGS.en[key] ?? key;
    if (params) {
      for (const name of Object.keys(params)) {
        text = text.split("{" + name + "}").join(String(params[name]));
      }
    }
    return text;
  }

  function otherLocale() {
    return locale === "zh-CN" ? "en" : "zh-CN";
  }

  // ------------------------------------------------- reading the course page

  /**
   * Everything in this section reads what the browser has already rendered.
   *
   * The rendered page has announcements, the content outline and the course's
   * name on screen, and reading it sends no request at all. Where HuskyCT's own
   * data serves better, it is read from there (below), at HuskyCT's own address:
   * the 403 with an S3-style AccessDenied that a script's request got on
   * 2026-09-19 came from the page's `<base>`, which sends a bare path to
   * Blackboard's file store (see huskyctUrl).
   */

  function textOf(node) {
    return node ? String(node.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  /** `MATH-1070Q-Mathematics for Business and Economics-SEC100-1268` -> `MATH 1070Q` */
  function courseCodeFromDisplay(value) {
    if (!value) return null;
    const match = String(value).match(/\b([A-Z]{2,6})-(\d{2,4}[A-Z]?)-/);
    return match ? match[1] + " " + match[2] : null;
  }

  /** The readable middle of that same string, with the section suffix dropped. */
  function courseTitleFromDisplay(value) {
    if (!value) return null;
    const match = String(value).match(/^[A-Z]{2,6}-\S*?-(.+?)-SEC\d+/);
    return match ? match[1].replace(/-/g, " ").trim() : null;
  }

  /**
   * When an announcement was posted, in the page's own words.
   *
   * It is relative ("7 hours ago, at 5:31 PM") or absolute ("9/17/26, 4:47 PM").
   * The wording is kept rather than converted: turning a relative time into an
   * instant needs a clock reading that may not match the person reading this.
   */
  function postedFromText(value) {
    const match = String(value || "").match(
      /(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago,\s+at\s+[^,]+|\d{1,2}\/\d{1,2}\/\d{2,4},\s+\d{1,2}:\d{2}\s*[AP]M)/i,
    );
    return match ? match[1].trim() : null;
  }

  /**
   * Announcements, from either place they are rendered.
   *
   * The Announcements page uses .announcement-item-row with
   * .announcement-title-detail and .click-message-detail. The course page shows
   * the same announcements in a dialog using .announcement-card with
   * .announcement-title, .announcement-sent-date and .body-text.message-entries.
   * Same records, two renderings, so both are read.
   */
  function collectAnnouncements(root) {
    const scope = root || document;
    const records = [];
    const seen = new Set();

    for (const row of scope.querySelectorAll(".announcement-item-row, .announcement-card")) {
      const title =
        textOf(row.querySelector(".announcement-title-detail")) ||
        textOf(row.querySelector(".announcement-title"));
      if (!title) continue;

      // Prefer the element built for the timestamp; fall back to finding one in
      // the row's text for renderings that do not have it. The Announcements
      // page puts it in .list-item-date-sent ("9/25/26, 4:00 PM") — measured on
      // the live page on 2026-09-27, where .announcement-sent-date matched
      // nothing and every posted line was lost.
      const posted =
        textOf(row.querySelector(".list-item-date-sent")) ||
        textOf(row.querySelector(".announcement-sent-date")) ||
        postedFromText(textOf(row));

      const key = title + "|" + posted;
      if (seen.has(key)) continue;
      seen.add(key);

      // .click-message-detail wraps the title as well as the body, so read the
      // body's own paragraph first; its three-line clamp is CSS only, and the
      // text underneath is whole.
      records.push({
        title,
        body:
          textOf(row.querySelector(".list-item-body")) ||
          textOf(row.querySelector(".click-message-detail")) ||
          textOf(row.querySelector(".body-text.message-entries")),
        posted: posted || null,
      });
    }

    return records;
  }

  // --- announcements, read from HuskyCT's own data -------------------------------------

  /**
   * A course's announcements, asked for as the Announcements page itself asks.
   *
   * Recorded on 2026-10-04: `GET /learn/api/v1/courses/<id>/announcements?limit=10&offset=0
   * &sort=startDateRestriction(desc)` answers `{ paging: { nextPage }, results: [...] }`, each
   * result holding `title`, `body.displayText` (HTML), `startDateRestriction` (an ISO time),
   * `isDraft` and `readStatus`. `paging.nextPage` is the next request's address, a path.
   *
   * It is one request a page of announcements, with no page to open and no scrolling, so it is
   * quick and does not move the tab the student is on. It sends the student's own session,
   * as the page does, and only to HuskyCT. Anything unexpected gives null, and the caller
   * reads the page instead.
   */
  const ANNOUNCEMENTS_PAGE = 50;
  const ANNOUNCEMENTS_PER_COURSE = 100;

  /**
   * Why the last read of HuskyCT's data came back empty: "HTTP 403", "timeout", "no answer",
   * "not JSON" or "no fetch". A sync that reads nothing says it, so the cause can be told apart
   * from afar.
   */
  let lastApiFailure = null;

  /**
   * Where a HuskyCT path is asked for: HuskyCT's own address, never the page's base. Measured on
   * 2026-10-06: HuskyCT's pages carry `<base href="https://ultra.content.blackboardcdn.com/ultra/…">`,
   * so a path given to fetch as it is goes to Blackboard's file store, which answers every path
   * with an S3 AccessDenied (and refuses outright one with a header of its own). That was every
   * 403 the helper ever got from HuskyCT's data.
   */
  function huskyctUrl(path) {
    return new URL(String(path), window.location.origin).href;
  }

  /** A GET of HuskyCT's own data as JSON, or null if it did not answer in time or well. */
  async function fetchJson(path, timeout) {
    if (typeof window.fetch !== "function") {
      lastApiFailure = "no fetch";
      return null;
    }
    const controller = typeof window.AbortController === "function" ? new window.AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    let response;
    try {
      response = await window.fetch(huskyctUrl(path), {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller ? controller.signal : undefined,
      });
    } catch (error) {
      lastApiFailure = error && error.name === "AbortError" ? "timeout" : "no answer";
      if (timer) clearTimeout(timer);
      return null;
    }
    try {
      if (!response.ok) {
        lastApiFailure = "HTTP " + response.status;
        return null;
      }
      return await response.json();
    } catch (error) {
      lastApiFailure = error && error.name === "AbortError" ? "timeout" : "not JSON";
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** The text of an HTML fragment, read in a document of its own so nothing in it runs. */
  function htmlToText(html) {
    if (!html) return "";
    try {
      const parsed = new window.DOMParser().parseFromString(String(html), "text/html");
      // Code and styling are not words an announcement says.
      for (const node of parsed.querySelectorAll("script, style, noscript")) node.remove();
      return textOf(parsed.body);
    } catch {
      return "";
    }
  }

  /**
   * A time as the Announcements page writes it, "9/25/26, 4:00 PM". An announcement's id is
   * made from this text, so the same announcement must come out the same whichever way it was read.
   */
  function postedText(iso) {
    const at = new Date(iso);
    if (Number.isNaN(at.valueOf())) return null;
    return at
      .toLocaleString("en-US", { year: "2-digit", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })
      .replace(/[  ]/g, " ");
  }

  /** The course's announcements as { title, body, posted } rows, newest first, or null if they could not be read this way. */
  async function readAnnouncementsApi(courseId, opts) {
    const timeout = (opts && opts.apiTimeout) || 8000;
    const rows = [];
    let next = "/learn/api/v1/courses/" + encodeURIComponent(courseId) + "/announcements?limit=" + ANNOUNCEMENTS_PAGE + "&offset=0&sort=startDateRestriction(desc)";

    for (let page = 0; next && rows.length < ANNOUNCEMENTS_PER_COURSE; page++) {
      const answer = await fetchJson(next, timeout);
      if (!answer || !Array.isArray(answer.results)) return null;
      for (const item of answer.results) {
        if (!item || item.isDraft) continue;
        const title = textOf({ textContent: item.title });
        if (!title) continue;
        const body = item.body || {};
        rows.push({
          title,
          body: htmlToText(body.displayText || body.rawText),
          posted: postedText(item.startDateRestriction || item.createdDate),
        });
      }
      // Only HuskyCT's own data address is followed, never one the answer names elsewhere.
      const following = answer.paging && answer.paging.nextPage ? String(answer.paging.nextPage) : "";
      next = /^\/learn\/api\/v1\/courses\//.test(following) && answer.results.length > 0 ? following : null;
    }
    return rows.slice(0, ANNOUNCEMENTS_PER_COURSE);
  }

  const CALENDAR_PAGE = 200;
  const CALENDAR_PAGES = 10;
  /** How far ahead the due dates are read: a term, with room to spare. */
  const CALENDAR_AHEAD_DAYS = 240;

  /**
   * Every due date from today on, from HuskyCT's own calendar data, as the records the basket
   * keeps ({ uid, title, course, courseId, dueText, due }), or null if it could not be read this
   * way. Measured on 2026-10-08: `/learn/api/v1/calendars/calendarItems` answers with the term's
   * graded items (`GradableItem`, each with its course in `calendarId`, a title and an exact
   * `endDate`) beside the class meetings and the student's own entries, which are left out here,
   * since only what is due is a deadline.
   *
   * The uid is the one the Calendar's Due dates view used to give (the course and the title), so
   * a deadline BetterHuskyCT already holds from that view is updated in place, not added twice.
   */
  async function readDueDatesApi(opts) {
    const timeout = (opts && opts.apiTimeout) || 8000;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const until = new Date(since.getTime() + CALENDAR_AHEAD_DAYS * 86400000);
    let next =
      "/learn/api/v1/calendars/calendarItems?since=" + encodeURIComponent(since.toISOString()) +
      "&until=" + encodeURIComponent(until.toISOString()) + "&limit=" + CALENDAR_PAGE;
    const records = [];
    const seen = new Set();

    for (let page = 0; next && page < CALENDAR_PAGES; page++) {
      const answer = await fetchJson(next, timeout);
      if (!answer || !Array.isArray(answer.results)) return null;
      for (const item of answer.results) {
        if (!item || String(item.itemSourceType || "").indexOf("GradableItem") === -1) continue;
        const title = textOf({ textContent: item.title });
        const due = new Date(item.endDate || item.startDate || "");
        if (!title || Number.isNaN(due.valueOf())) continue;
        const courseId = typeof item.calendarId === "string" ? item.calendarId : null;
        const name = item.calendarNameLocalizable && item.calendarNameLocalizable.rawValue;
        const uid = "huskyct-due-" + ((courseId || "course") + "-" + title).replace(/[^\w.-]+/g, "-");
        if (seen.has(uid)) continue;
        seen.add(uid);
        records.push({ uid, title, course: courseCodeFromDisplay(name), courseId, dueText: "", due });
      }
      // Only HuskyCT's own calendar address is followed, never one the answer names elsewhere.
      const following = answer.paging && answer.paging.nextPage ? String(answer.paging.nextPage) : "";
      next = /^\/learn\/api\/v1\/calendars\//.test(following) && answer.results.length > 0 ? following : null;
    }
    return records;
  }

  /** The course id out of a course URL, e.g. `/ultra/courses/_203765_1/outline`. */
  function currentCourseId() {
    const match = window.location.pathname.match(/\/ultra\/courses\/([^/]+)/);
    return match ? match[1] : null;
  }

  /** The course this page belongs to, from what its header renders. */
  function collectCourse(root) {
    const scope = root || document;
    const heading =
      textOf(scope.querySelector("[class*='courseTitle']")) ||
      textOf(scope.querySelector("h1")) ||
      "";
    return {
      id: currentCourseId(),
      code: courseCodeFromDisplay(heading),
      title: courseTitleFromDisplay(heading),
      heading,
    };
  }

  /**
   * Announcements in the shape the dashboard's announcement reader accepts.
   *
   * The course is named by its *code* rather than its id, because the code is
   * the only handle both sides understand: HuskyCT's `_203765_1` means nothing
   * to the dashboard, while `MATH 1070Q` is what its course book is keyed on.
   *
   * `announced` is when this page was read, not when the announcement was
   * posted. The posted time is relative prose that only holds at the moment it
   * is read — see `postedFromText` — so it travels as text and is never used as
   * a sort key. Anything else would be inventing a date the page never gave.
   */
  function announcementsToCandidates(records, courseCode, now) {
    const stamp = (now || new Date()).toISOString();
    return (records || [])
      .filter((record) => record && record.title)
      .map((record) => ({
        courseCode: courseCode || null,
        title: record.title,
        body: record.body || "",
        posted: record.posted || null,
        announced: stamp,
      }));
  }

  // ------------------------------------------------------- the to-do panel

  /**
   * The application renders each to-do item as one link, and puts its whole
   * record in that link's aria-label:
   *
   *   "Section 4.7 Homework, Homework · MATH-1070Q-SEC100.120-1268 · _203765_1,
   *    due 9/25/26, 11:59 PM"
   *
   * That is far steadier than the markup around it. The classes there carry
   * build hashes — `makeStylesdueDateDefault-0-2-1013` — and change with every
   * release, while an aria-label is part of the page's contract with screen
   * readers and only changes when the meaning does.
   */
  function todoFromLabel(label) {
    const text = String(label || "").trim();
    const dueSplit = text.lastIndexOf(", due ");
    if (dueSplit === -1) return null;

    const head = text.slice(0, dueSplit);
    const dueText = text.slice(dueSplit + ", due ".length).trim();

    // "<title>, <kind> · <course> · <course id>"
    const parts = head.split(" · ").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return null;

    // The kind is a trailing clause, and a title may contain its own comma, so
    // only the last comma separates them.
    const lastComma = parts[0].lastIndexOf(", ");
    return {
      title: lastComma === -1 ? parts[0] : parts[0].slice(0, lastComma).trim(),
      kind: lastComma === -1 ? null : parts[0].slice(lastComma + 2).trim(),
      course: courseCodeFromDisplay(parts[0]) || courseCodeFromDisplay(parts[1]),
      courseName: parts[1],
      courseId: parts[2] || null,
      dueText,
      due: dueDateFromText(dueText),
    };
  }

  /** Hours from UTC for the zone abbreviations HuskyCT prints after a due time. */
  const ZONE_OFFSETS = { EDT: -4, EST: -5, CDT: -5, CST: -6, MDT: -6, MST: -7, PDT: -7, PST: -8, UTC: 0, GMT: 0 };

  /**
   * `9/25/26, 11:59 PM` -> an instant.
   *
   * The to-do list shows a wall-clock time with no zone on it, so that one is
   * read in the reader's own timezone — right for someone sitting in the same
   * timezone as their classes, and the only reading the page offers. The
   * Calendar's due dates add the zone — `10/2/26, 11:59 PM (EDT)` — and then
   * the instant is exact wherever the reader is.
   */
  function dueDateFromText(value) {
    const match = String(value || "").match(
      /(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*([AP])M(?:\s*\(([A-Z]{2,4})\))?/i,
    );
    if (!match) return null;

    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    // 12 AM is hour 0 and 12 PM is hour 12; the modulo handles both.
    const hour = (Number(match[4]) % 12) + (/p/i.test(match[6]) ? 12 : 0);
    const zone = match[7] ? match[7].toUpperCase() : null;

    const date =
      zone && Object.prototype.hasOwnProperty.call(ZONE_OFFSETS, zone)
        ? new Date(Date.UTC(year, Number(match[1]) - 1, Number(match[2]), hour - ZONE_OFFSETS[zone], Number(match[5])))
        : new Date(year, Number(match[1]) - 1, Number(match[2]), hour, Number(match[5]), 0, 0);
    return Number.isNaN(date.valueOf()) ? null : date;
  }

  /** Every to-do item the page is currently showing. */
  function collectTodos(root) {
    const scope = root || document;
    const records = [];
    const seen = new Set();

    for (const node of scope.querySelectorAll("[aria-label]")) {
      const label = node.getAttribute("aria-label") || "";
      if (label.indexOf(", due ") === -1) continue;

      const todo = todoFromLabel(label);
      if (!todo || !todo.due) continue;

      const key = (node.getAttribute("data-analytics-id") || "") + "|" + label;
      if (seen.has(key)) continue;
      seen.add(key);

      // The application's own id for the item, so collecting twice does not put
      // the same deadline into BetterHuskyCT twice.
      const analytics = node.getAttribute("data-analytics-id") || "";
      const stable = analytics.split(".").pop() || todo.title + "@" + todo.dueText;
      todo.uid = "huskyct-todo-" + stable.replace(/[^\w.-]+/g, "-");
      records.push(todo);
    }

    return records;
  }

  /**
   * The Calendar's "Due dates" view: every due date from today to the end of
   * the term, across courses. The to-do list only reaches a week ahead, so in a
   * quiet week it is empty while the term is full of deadlines — measured on
   * 2026-09-27, an empty to-do list beside 29 due dates running to December 11.
   *
   * Each card has the item's name, `Due date: 10/2/26, 11:59 PM (EDT)`, and a
   * link to its course. The date is found by its shape rather than by the
   * words around it, which change with the interface language. HuskyCT gives
   * the card no id, so the uid is the course and the title: a rescheduled item
   * keeps it and simply takes the new time.
   */
  function collectDueDates(root) {
    const scope = root || document;
    const records = [];
    const seen = new Set();

    for (const card of scope.querySelectorAll(".element-card.due-item")) {
      const title = textOf(card.querySelector(".name"));
      const content = card.querySelector(".content");
      const courseLink = content ? content.querySelector("a") : null;
      const dueText =
        (textOf(content).match(/\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*[AP]M(?:\s*\([A-Z]{2,4}\))?/i) || [])[0] || "";
      const due = dueDateFromText(dueText);
      if (!title || !due) continue;

      const courseId = (String((courseLink && courseLink.getAttribute("href")) || "").match(/(_\d+_\d+)/) || [])[1] || null;
      const course = courseCodeFromDisplay(textOf(courseLink));
      const uid = "huskyct-due-" + ((courseId || course || "course") + "-" + title).replace(/[^\w.-]+/g, "-");
      if (seen.has(uid)) continue;
      seen.add(uid);
      records.push({ uid, title, course, courseId, dueText, due });
    }

    return records;
  }

  /** To-do items in the shape the calendar writer already understands. */
  function todosToRecords(todos) {
    return todos.map((todo) => ({
      uid: todo.uid,
      title: todo.title,
      course: todo.course,
      start: todo.due.toISOString(),
      end: null,
      allDay: false,
      kind: "assignment",
    }));
  }

  // ------------------------------------------------------------------ the basket

  /**
   * What the panel has read across pages, kept until it is sent.
   *
   * Every course used to be its own round trip: open the course, press Send, a
   * new dashboard tab, press Apply — six courses, six tabs, six Applies. Nothing
   * carried from one page to the next. The basket fixes that without asking
   * HuskyCT for anything: it keeps what the pages the student opens anyway
   * already show, and one press sends all of it.
   *
   * It still reads only the rendered page. Measured again on 2026-09-27: a
   * script's own request to /learn/api/v1/users/me and to a course's
   * announcements endpoint both returned 403 AccessDenied, as the README
   * records. So a course's announcements are in the basket once its
   * Announcements page has been open — the course outline does not show them.
   *
   * It lives in this site's localStorage, so it survives HuskyCT's full page
   * loads, and it never leaves the browser except inside the link the student
   * chooses to send.
   */
  const BASKET_KEY = "huskypilot.helper.basket.v1";
  const BASKET_VERSION = 1;
  /** The dashboard cuts bodies here anyway; cutting them first keeps the link small. */
  const BASKET_BODY_LIMIT = 1200;
  /** The newest this many per course: a term's worth, not an archive. */
  const BASKET_PER_COURSE = 25;
  /** The dashboard refuses a packed payload past 32,768 characters; stay clear of it. */
  const PACKED_LIMIT = 30000;

  function emptyBasket() {
    return { version: BASKET_VERSION, courses: [], todos: [], todosAt: null, dueDates: [], dueDatesAt: null };
  }

  /**
   * The saved basket, or an empty one.
   *
   * Tolerant on purpose: a basket from an older helper, or one another script
   * scribbled on, is not worth a broken panel. What does not read starts over.
   */
  function readBasket(storage) {
    try {
      const raw = storage && storage.getItem(BASKET_KEY);
      if (!raw) return emptyBasket();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== BASKET_VERSION) return emptyBasket();
      return {
        version: BASKET_VERSION,
        courses: (Array.isArray(parsed.courses) ? parsed.courses : [])
          .filter((course) => course && typeof course.id === "string")
          .map((course) => ({
            id: course.id,
            code: typeof course.code === "string" ? course.code : null,
            announcements: Array.isArray(course.announcements) ? course.announcements : [],
            announcementsAt: typeof course.announcementsAt === "string" ? course.announcementsAt : null,
          })),
        todos: (Array.isArray(parsed.todos) ? parsed.todos : []).filter(
          (todo) => todo && typeof todo.uid === "string" && typeof todo.start === "string",
        ),
        todosAt: typeof parsed.todosAt === "string" ? parsed.todosAt : null,
        // Added in 0.16.2. A basket saved before then has none, which reads as
        // "not collected yet" rather than as a broken basket.
        dueDates: (Array.isArray(parsed.dueDates) ? parsed.dueDates : []).filter(
          (item) => item && typeof item.uid === "string" && typeof item.start === "string",
        ),
        dueDatesAt: typeof parsed.dueDatesAt === "string" ? parsed.dueDatesAt : null,
      };
    } catch {
      return emptyBasket();
    }
  }

  function writeBasket(storage, basket) {
    try {
      storage.setItem(BASKET_KEY, JSON.stringify(basket));
    } catch {
      /* a full or blocked storage loses the basket at reload; the page still works */
    }
  }

  /**
   * The courses a page links to, by HuskyCT id and course code.
   *
   * The Courses page lists each one as a link to /ultra/courses/<id>/outline
   * whose text is the display name — "1268-UCONN-MATH-1070Q-SEC100-1191MATH-
   * 1070Q-Mathematics…" on the live page — and the code is read out of that the
   * same way the course heading is. Links whose text names no course (a
   * course's own Content or Gradebook tab) are skipped.
   */
  function courseLinksOnPage(root) {
    const scope = root || document;
    const found = [];
    const seen = new Set();
    for (const link of scope.querySelectorAll('a[href*="/ultra/courses/"]')) {
      const match = String(link.getAttribute("href") || "").match(/\/ultra\/courses\/(_\d+_\d+)/);
      if (!match || seen.has(match[1])) continue;
      const code = courseCodeFromDisplay(textOf(link));
      if (!code) continue;
      seen.add(match[1]);
      found.push({ id: match[1], code });
    }
    return found;
  }

  /** Adds courses not seen before, at the end, keeping what is known about the rest. */
  function rememberCourses(basket, courses) {
    const known = new Set(basket.courses.map((course) => course.id));
    const added = courses
      .filter((course) => !known.has(course.id))
      .map((course) => ({ id: course.id, code: course.code, announcements: [], announcementsAt: null }));
    if (added.length === 0) return { basket, changed: false };
    return { basket: { ...basket, courses: basket.courses.concat(added) }, changed: true };
  }

  /**
   * A course's announcements as its Announcements page shows them now.
   *
   * Replaced rather than merged: the page lists all of them, so an announcement
   * the instructor deleted leaves the basket too. `announcementsAt` only moves
   * when something changed, so a page left open does not rewrite storage every
   * few seconds.
   */
  function rememberAnnouncements(basket, course, records, now) {
    const kept = (records || []).slice(0, BASKET_PER_COURSE).map((record) => ({
      title: record.title,
      body: String(record.body || "").slice(0, BASKET_BODY_LIMIT),
      posted: record.posted || null,
    }));
    const index = basket.courses.findIndex((entry) => entry.id === course.id);
    const previous = index === -1 ? null : basket.courses[index];
    if (
      previous &&
      previous.announcementsAt &&
      JSON.stringify(previous.announcements) === JSON.stringify(kept)
    ) {
      return { basket, changed: false };
    }

    const entry = {
      id: course.id,
      code: course.code || (previous && previous.code) || null,
      announcements: kept,
      announcementsAt: (now || new Date()).toISOString(),
    };
    const courses = basket.courses.slice();
    if (index === -1) courses.push(entry);
    else courses[index] = entry;
    return { basket: { ...basket, courses }, changed: true };
  }

  /**
   * The to-do list, replaced when the page shows one.
   *
   * An empty list is not taken as "nothing is due": the list only ever shows a
   * week either side of today, so a page that has not rendered it yet, or a
   * quiet week, must not wipe deadlines already collected.
   */
  function rememberTodos(basket, records, now) {
    if (!records || records.length === 0) return { basket, changed: false };
    if (JSON.stringify(basket.todos) === JSON.stringify(records)) return { basket, changed: false };
    return { basket: { ...basket, todos: records, todosAt: (now || new Date()).toISOString() }, changed: true };
  }

  /**
   * The Calendar's due dates, merged by uid rather than replaced.
   *
   * The view starts at today and loads more as it scrolls, so one look at it
   * may show only part of the term; replacing would throw away the rest. A
   * rescheduled item keeps its uid and takes its new time.
   */
  function rememberDueDates(basket, records, now) {
    if (!records || records.length === 0) return { basket, changed: false };
    const byUid = new Map((basket.dueDates || []).map((item) => [item.uid, item]));
    let changed = false;
    for (const record of records) {
      const previous = byUid.get(record.uid);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(record)) {
        byUid.set(record.uid, record);
        changed = true;
      }
    }
    if (!changed) return { basket, changed: false };
    return {
      basket: { ...basket, dueDates: [...byUid.values()], dueDatesAt: (now || new Date()).toISOString() },
      changed: true,
    };
  }

  /**
   * Every deadline in the basket, once.
   *
   * The to-do list and the Calendar overlap for the coming week. The to-do
   * list's copy wins — it carries HuskyCT's own item id, and it is the only one
   * of the two that shows overdue work — and a due date is dropped when the
   * to-do list has the same course, title and time.
   */
  function deadlineRecords(basket) {
    const key = (record) => [record.course || "", record.title, record.start].join("|");
    const fromTodos = new Set(basket.todos.map(key));
    return basket.todos.concat((basket.dueDates || []).filter((record) => !fromTodos.has(key(record))));
  }

  /**
   * Reads the page into the basket.
   *
   * `listSettled` is the panel's word that an Announcements page has shown its
   * list for a while with no rows in it — a course with no announcements, as
   * opposed to one still loading — so it can be ticked off as collected.
   */
  function captureIntoBasket(basket, root, pathname, now, listSettled) {
    const scope = root || document;
    let current = basket;
    let changed = false;
    const apply = (result) => {
      current = result.basket;
      changed = changed || result.changed;
    };

    const links = courseLinksOnPage(scope);
    apply(rememberCourses(current, links));
    apply(rememberCourses(current, coursesToCollect(courseCardsOnPage(scope), links, now)));
    apply(rememberTodos(current, todosToRecords(collectTodos(scope)), now));
    apply(rememberDueDates(current, todosToRecords(collectDueDates(scope)), now));

    const match = String(pathname || "").match(/^\/ultra\/courses\/([^/]+)\/announcements/);
    if (match) {
      // Moving between two courses can leave the last course's page on screen
      // for a moment under the new address. A heading naming a different course
      // than the one already known for this id means exactly that.
      const code = collectCourse(scope).code;
      const known = current.courses.find((course) => course.id === match[1]);
      const mismatched = Boolean(code && known && known.code && known.code !== code);
      const rows = collectAnnouncements(scope);
      if (!mismatched && (rows.length > 0 || (listSettled && scope.querySelector(".announcement-list")))) {
        apply(rememberAnnouncements(current, { id: match[1], code }, rows, now));
      }
    }

    return { basket: current, changed };
  }

  function basketSummary(basket) {
    const collected = basket.courses.filter((course) => course.announcementsAt);
    return {
      courses: basket.courses.length,
      collected: collected.length,
      announcements: collected.reduce((total, course) => total + course.announcements.length, 0),
      deadlines: deadlineRecords(basket).length,
    };
  }

  // --- collecting everything in one press -------------------------------------

  /**
   * The basket used to fill only as the student opened each course's
   * Announcements tab by hand, which is the chore it was meant to remove.
   * "Collect everything" gathers it all in one press: the to-do list from the
   * Courses page (the one thing still read off a page), and the due dates, each
   * course's announcements, gradebook and files from HuskyCT's own data, then
   * back to where the student was.
   */

  const VIEW_ALL_COURSES = '[data-analytics-id="base.courses.recentCoursesView.viewAllButton"]';

  function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Polls `check` until it returns something truthy, or gives up with null. */
  async function waitFor(check, every, timeout) {
    const started = Date.now();
    for (;;) {
      const value = check();
      if (value) return value;
      if (Date.now() - started >= timeout) return null;
      await pause(every);
    }
  }

  /**
   * Moves HuskyCT to another of its own pages without reloading.
   *
   * HuskyCT is a single-page app that follows history changes, so pushing a path
   * and announcing it is what its own links do. Measured on 2026-09-27: a
   * course's Announcements page renders in 0.5-2.5 s this way, and the panel
   * stays mounted. The document carries a <base> on Blackboard's CDN, so the path
   * is made absolute first — a relative one resolves against the CDN and
   * pushState refuses it.
   */
  function routeTo(path) {
    window.history.pushState({}, "", window.location.origin + path);
    window.dispatchEvent(new window.PopStateEvent("popstate", { state: {} }));
  }

  /**
   * The course cards on the Courses page's "View All" list.
   *
   * The Courses page itself shows only the few courses opened most recently —
   * four of six, on the account this was measured with. "View All" lists every
   * one, as `article[data-course-id]` cards rendered as they scroll into view.
   * The term comes from the course id's prefix: `1268-UCONN-NRE-1000E-…` is
   * term 1268. A card HuskyCT marks inaccessible is left out; opening it would
   * only time out.
   */
  function courseCardsOnPage(root) {
    const scope = root || document;
    const found = [];
    for (const card of scope.querySelectorAll("article[data-course-id]")) {
      const id = card.getAttribute("data-course-id");
      if (!/^_\d+_\d+$/.test(String(id)) || card.classList.contains("inactive-link")) continue;
      const text = textOf(card);
      found.push({
        id,
        code: courseCodeFromDisplay(textOf(card.querySelector("h4"))) || courseCodeFromDisplay(text),
        term: (text.match(/\b(\d{4})-UCONN-/) || [])[1] || null,
      });
    }
    return found;
  }

  // --- each course's colour, as the Courses page draws it ----------------------------------

  /**
   * HuskyCT gives every course a colour, and BetterHuskyCT uses the same one, so a course looks the
   * same in both. The colour comes with the course list (see cardColorFromIndex), is kept by course
   * id across visits, and is sent with the deadlines.
   */
  const COLORS_KEY = "huskypilot.helper.colors.v1";

  function readColors(storage) {
    try {
      const parsed = JSON.parse(storage.getItem(COLORS_KEY) || "{}");
      const colors = {};
      if (parsed && typeof parsed === "object") {
        for (const [id, color] of Object.entries(parsed)) {
          if (/^_\d+_\d+$/.test(id) && /^#[0-9a-f]{6}$/i.test(String(color))) colors[id] = String(color).toLowerCase();
        }
      }
      return colors;
    } catch {
      return {};
    }
  }

  function rememberColors(storage, found) {
    if (!found || Object.keys(found).length === 0) return;
    try {
      storage.setItem(COLORS_KEY, JSON.stringify(Object.assign(readColors(storage), found)));
    } catch {
      /* read again next time */
    }
  }

  /** The colours as BetterHuskyCT takes them: by course code, for the courses in the basket. */
  function colorsByCode(storage, basket) {
    const byId = readColors(storage);
    const out = {};
    for (const course of (basket && basket.courses) || []) {
      if (course && course.code && byId[course.id]) out[course.code] = byId[course.id];
    }
    return out;
  }

  // --- the course list, read from HuskyCT's own data --------------------------------------

  /**
   * The student's courses, asked for as the Courses page asks.
   *
   * Recorded on 2026-10-04: `GET /learn/api/v1/users/me/memberships?includeCount=true&limit=…
   * &offset=0&expand=course.effectiveAvailability&sort=lastAccessDate(desc:nullslast)` answers
   * `{ paging: { count, nextPage }, results: [...] }`, each a membership with `courseId` ("_203765_1"),
   * `userHasHidden`, `isAvailable`, and a `course` holding `displayName` ("MATH-1070Q-…-SEC100-1268"),
   * `courseId` (the readable id, which begins with the term code), `term.name` ("Fall 2026"),
   * `isOrganization` and `effectiveAvailability`.
   *
   * It lists every course at once, with no "View All" to open and no cards to scroll into view. The
   * same cards the page drew come out: not organizations, not courses the student cannot open, not
   * ones they hid. Anything unexpected, or nothing at all, gives null and the page is read.
   */
  const COURSES_PAGE = 50;
  const COURSES_MAX_PAGES = 20;

  /** The term code of a course ("1268"), from its readable id or, failing that, its term's name. */
  function termOfCourse(course) {
    const fromId = /^(\d{4})-/.exec(String(course.courseId || ""));
    if (fromId) return fromId[1];
    const named = /(spring|summer|fall)\s+(\d{4})/i.exec(String((course.term && course.term.name) || ""));
    if (!named) return null;
    const season = { spring: 3, summer: 5, fall: 8 }[named[1].toLowerCase()];
    return String(1000 + (Number(named[2]) % 100) * 10 + season);
  }

  /** A membership of HuskyCT's data as { id, code, term }, or null if it is not a course the student can read. */
  function courseCardFromApi(membership) {
    if (!membership || typeof membership !== "object") return null;
    const course = membership.course && typeof membership.course === "object" ? membership.course : null;
    const id = String(membership.courseId || (course && course.id) || "");
    if (!course || !/^_\d+_\d+$/.test(id) || course.isOrganization) return null;
    if (course.effectiveAvailability === false || course.isAvailable === false || membership.isAvailable === false || membership.userHasHidden === true) return null;
    return {
      id,
      code: courseCodeFromDisplay(course.displayName) || courseCodeFromDisplay(course.name),
      term: termOfCourse(course),
    };
  }

  /**
   * HuskyCT's ten course colours, in the order of its `course-color-1` to `course-color-10`.
   * Measured on 2026-10-06: a membership's `courseCardColorIndex` picks the card's class as
   * `course-color-(index % 10 + 1)` (180 → 1, 77 and 37 → 8, 18 → 9), and these are the colours
   * those classes draw, as the bar on each card in the list view.
   */
  const HUSKYCT_CARD_COLORS = ["#c473d4", "#2fd9fc", "#ffe12b", "#ff6417", "#89f3db", "#fe5b91", "#85f472", "#22c7cc", "#ca22ad", "#157afb"];

  function cardColorFromIndex(index) {
    return Number.isInteger(index) && index >= 0 ? HUSKYCT_CARD_COLORS[index % HUSKYCT_CARD_COLORS.length] : null;
  }

  /** { recent, cards, queue, pageFound } for every course HuskyCT lists, or null if it could not be read this way. */
  async function readCoursesApi(opts) {
    const timeout = (opts && opts.apiTimeout) || 8000;
    const cards = new Map();
    let next = "/learn/api/v1/users/me/memberships?includeCount=true&limit=" + COURSES_PAGE + "&offset=0&expand=course.effectiveAvailability&sort=lastAccessDate(desc:nullslast)";
    let rows = 0;
    let expected = null;
    const colors = {};

    for (let page = 0; next && page < COURSES_MAX_PAGES; page++) {
      const answer = await fetchJson(next, timeout);
      if (!answer || !Array.isArray(answer.results)) return null;
      rows += answer.results.length;
      if (answer.paging && typeof answer.paging.count === "number") expected = answer.paging.count;
      for (const membership of answer.results) {
        const card = courseCardFromApi(membership);
        if (card && !cards.has(card.id)) cards.set(card.id, card);
        const color = card && cardColorFromIndex(membership.courseCardColorIndex);
        if (color) colors[card.id] = color;
      }
      const following = answer.paging && answer.paging.nextPage ? String(answer.paging.nextPage) : "";
      next = /^\/learn\/api\/v1\/users\/me\/memberships/.test(following) && answer.results.length > 0 ? following : null;
    }
    // Short of what HuskyCT says is there, or nothing at all: not a course list to trust.
    if (next || cards.size === 0 || (expected !== null && rows < expected)) return null;
    // The colours HuskyCT gives the courses come with the list, so no card has to be drawn for them.
    rememberColors(window.localStorage, colors);
    const list = [...cards.values()];
    return { recent: [], cards: list, queue: coursesToCollect(list, [], new Date()), pageFound: true };
  }

  /**
   * UConn's term code for a date: `1` + the year's last two digits + the
   * season — 3 spring, 5 summer, 8 fall. 2026-09-27 is 1268, the prefix on
   * every Fall 2026 course id.
   */
  function termCodeFor(date) {
    const month = date.getMonth();
    const season = month <= 4 ? 3 : month <= 6 ? 5 : 8;
    return 1000 + (date.getFullYear() % 100) * 10 + season;
  }

  /**
   * Which courses to read: this term's, and any later one's.
   *
   * The course list covers past terms too, and reading every course someone has
   * ever taken would be slow and pointless. The recently opened courses say
   * which term is current. Without them — a wide screen shows the full list and
   * no "recent" strip — today's date does, unless every course on the list is
   * older than that, as in a break between terms; then the newest term stands
   * in. A card whose term cannot be read is kept rather than guessed away.
   */
  function coursesToCollect(cards, recent, now) {
    const recentIds = new Set(recent.map((course) => course.id));
    const terms = cards.map((card) => Number(card.term)).filter(Boolean);
    const recentTerms = cards
      .filter((card) => recentIds.has(card.id))
      .map((card) => Number(card.term))
      .filter(Boolean);
    const current = termCodeFor(now || new Date());
    const earliest = recentTerms.length
      ? Math.min(...recentTerms)
      : terms.some((term) => term >= current)
        ? current
        : terms.length
          ? Math.max(...terms)
          : 0;

    const chosen = new Map();
    for (const card of cards) {
      if (!card.term || Number(card.term) >= earliest) chosen.set(card.id, { id: card.id, code: card.code });
    }
    for (const course of recent) {
      if (!chosen.has(course.id)) chosen.set(course.id, { id: course.id, code: course.code });
    }
    return [...chosen.values()];
  }

  /**
   * The courses to visit, from HuskyCT's own list. A walk that reads the Courses page itself (its
   * to-do list) has `onCoursesPage` run there, and the page's recent strip says which term is
   * current. A list HuskyCT would not give is no courses, which the walk reports.
   */
  async function findCourses(opts, onCoursesPage) {
    const listed = await readCoursesApi(opts);
    // A sync that must not touch the page the student is on stops here, list or no list.
    if (opts.apiOnly) return listed;
    const cards = listed ? listed.cards : [];
    if (!onCoursesPage) return listed || { recent: [], cards, queue: [], pageFound: true };

    // A course's own page is full of links into `/ultra/courses/`, and it stays
    // on screen for a moment after the move. Taking it for the Courses page read
    // one course, or none — so only what appears after the move counts, unless
    // the walk started on the Courses page itself, which a move there does not
    // redraw.
    const markers = () => [
      ...document.querySelectorAll(VIEW_ALL_COURSES + ', a[href*="/ultra/courses/"], article[data-course-id]'),
    ];
    const alreadyThere = /^\/ultra\/course\/?$/.test(window.location.pathname);
    const stale = new Set(alreadyThere ? [] : markers());
    routeTo("/ultra/course");
    const pageFound = await waitFor(
      () =>
        window.location.pathname.indexOf("/ultra/course") === 0 && markers().some((node) => !stale.has(node)),
      opts.every,
      opts.pageTimeout,
    );
    const recent = courseLinksOnPage(document);
    await onCoursesPage(recent);
    return { recent, cards, queue: coursesToCollect(cards, recent, new Date()), pageFound: Boolean(pageFound) };
  }

  /**
   * What a walk could not read, in words the student can pass on.
   *
   * Every step of a walk depends on how HuskyCT draws its pages, and Blackboard
   * changes that with its releases. A step that finds nothing used to return
   * nothing, so the panel said "Done" over an empty basket and nobody could
   * tell which step had broken. Each walk now reports the steps that came back
   * empty where they should not have, and the panel shows them.
   */
  function coursesProblems(found) {
    if (!found.pageFound) return [{ key: "problemCoursesPage" }];
    if (found.queue.length === 0) return [{ key: "problemNoCourses" }];
    return [];
  }

  /** The term the courses of a walk belong to, as "Fall 2026" (the earliest, if they differ). */
  function walkTerm(found) {
    const terms = found.cards
      .filter((card) => found.queue.some((course) => course.id === card.id))
      .map((card) => Number(card.term))
      .filter(Boolean);
    return termLabel(terms.length ? Math.min(...terms) : termCodeFor(new Date()));
  }

  /**
   * The whole walk. Writes to the basket as it goes, so stopping halfway keeps
   * what was read.
   */
  async function collectEverything(options) {
    const opts = Object.assign(
      {
        every: 300,
        pageTimeout: 15000,
        emptySettle: 4000,
        todoSettle: 2500,
        gap: 250,
        onProgress() {},
        shouldStop: () => false,
      },
      options,
    );
    const storage = window.localStorage;
    const returnTo = window.location.pathname + window.location.search;
    const report = { courses: 0, collected: 0, dueDates: 0, skipped: [], stopped: false, problems: [], grades: null, materials: null };
    const save = (result) => {
      if (result.changed) writeBasket(storage, result.basket);
      return result.basket;
    };

    try {
      // 1 and 2. The Courses page for its to-do list, and HuskyCT's own list of the courses.
      opts.onProgress({ step: "courses" });
      let basket = readBasket(storage);
      const found = await findCourses(opts, async (recent) => {
        // An empty week has no to-do items at all, so this simply runs out.
        await waitFor(() => document.querySelector("[aria-label*=', due ']"), opts.every, opts.todoSettle);
        basket = save(rememberTodos(basket, todosToRecords(collectTodos(document)), new Date()));
        basket = save(rememberCourses(basket, recent));
      });
      const queue = found.queue;
      report.problems.push(...coursesProblems(found));
      save(rememberCourses(basket, queue));
      report.courses = queue.length;

      // 3. The due dates, from HuskyCT's calendar data: the whole term, not just the week the
      // to-do list covers.
      if (!opts.shouldStop()) {
        opts.onProgress({ step: "duedates" });
        const dueDates = await readDueDatesApi(opts);
        if (dueDates === null) report.problems.push({ key: "problemDueDatesView" });
        report.dueDates = dueDates ? dueDates.length : 0;
        save(rememberDueDates(readBasket(storage), todosToRecords(dueDates || []), new Date()));
      }

      // 4. Each course's Announcements page, one at a time.
      for (let index = 0; index < queue.length; index++) {
        if (opts.shouldStop()) {
          report.stopped = true;
          break;
        }
        const course = queue[index];
        opts.onProgress({ step: "course", course, index: index + 1, total: queue.length });

        const rows = await readAnnouncementsApi(course.id, opts);
        if (rows === null) {
          report.skipped.push(course.code || course.id);
          continue;
        }
        // Re-read first: the student may have cleared the basket, or another
        // HuskyCT tab written to it, while this page loaded.
        save(rememberAnnouncements(readBasket(storage), course, rows, new Date()));
        report.collected++;
        await pause(opts.gap);
      }

      // 5 and 6. Each course's gradebook, then its files, so one press brings in everything.
      // A walk that breaks is reported, and the other still runs.
      if (!opts.shouldStop()) {
        try {
          report.grades = await collectGrades({
            shouldStop: opts.shouldStop,
            onProgress: (progress) => opts.onProgress(Object.assign({ walk: "grades" }, progress)),
          });
        } catch {
          report.problems.push({ key: "problemGradesWalk" });
        }
      }
      if (!opts.shouldStop()) {
        try {
          report.materials = await collectMaterials({
            shouldStop: opts.shouldStop,
            onProgress: (progress) => opts.onProgress(Object.assign({ walk: "materials" }, progress)),
          });
        } catch {
          report.problems.push({ key: "problemMaterialsWalk" });
        }
      }
      if ((report.grades && report.grades.stopped) || (report.materials && report.materials.stopped)) {
        report.stopped = true;
      }
    } finally {
      // 5. Back to the page the student pressed the button on.
      routeTo(returnTo);
    }
    return report;
  }

  // --- course materials ---------------------------------------------------------

  /**
   * Every file, document, video, link and tool in each course's content. A file's address,
   * `/bbcswebdav/...`, redirects to Blackboard's file store, which answers any origin: so the
   * file can be read with an ordinary request that sends HuskyCT's cookie to HuskyCT only. With
   * the cookie sent on to the store as well, the store refuses — that is the one way to get it wrong.
   */

  const VIDEO_HOSTS = /(youtube\.com|youtu\.be|vimeo\.com|vidyard\.com|panopto|kaltura|mediaspace|zoom\.us\/rec)/i;
  const TERM_SEASONS = { 3: "Spring", 5: "Summer", 8: "Fall" };

  /**
   * A link without Outlook's safe-links wrapper. Links pasted in from a UConn
   * mailbox arrive wrapped, and the wrapper carries the student's own email
   * address in its query — not something to put in a file on the desktop.
   */
  function unwrapLink(href) {
    try {
      const url = new URL(href);
      if (/safelinks\.protection\.outlook\.com$/i.test(url.hostname) && url.searchParams.get("url")) {
        return url.searchParams.get("url");
      }
      return url.href;
    } catch {
      return String(href || "");
    }
  }

  function isVideoLink(url) {
    return VIDEO_HOSTS.test(String(url || ""));
  }

  /** The videos and links out of HuskyCT in a document's content, each once. */
  function linksIn(root, fallbackTitle) {
    const links = [];
    const seen = new Set();
    const addLink = (href, title) => {
      if (!/^https?:/i.test(String(href || "")) || /lms\.uconn\.edu\/(ultra|bbcswebdav)/i.test(href)) return;
      const url = unwrapLink(href);
      if (seen.has(url)) return;
      seen.add(url);
      links.push({ title: title || fallbackTitle, url, kind: isVideoLink(url) ? "video" : "link" });
    };
    for (const video of root.querySelectorAll('[data-bbtype="video"]')) {
      try {
        addLink(JSON.parse(video.getAttribute("data-bbfile") || "{}").src, fallbackTitle);
      } catch {
        /* an embed whose description does not parse is left out */
      }
    }
    for (const frame of root.querySelectorAll("iframe[src]")) addLink(frame.getAttribute("src"), fallbackTitle);
    for (const anchor of root.querySelectorAll("a[href]")) addLink(anchor.getAttribute("href"), textOf(anchor));
    return links;
  }

  // --- course materials, read from HuskyCT's own data ---------------------------

  /**
   * A course's content, asked for as its outline asks, with no page to open: so it works in a tab
   * behind BetterHuskyCT, which draws no pages.
   *
   * Measured on 2026-10-06 in one course: `GET /learn/api/v1/courses/<id>/contents/<parent>/children`
   * (from `ROOT`) answers `{ paging: { nextPage }, results }`, 1000 to a page, each item with
   * `contentHandler` as a string, `title`, `visibility`, `contentDetail` and `body`:
   *
   * - `resource/x-bb-lesson` and `resource/x-bb-folder` hold more items. A folder whose detail has
   *   `isBbPage` is one of Ultra's documents, shown in the outline as a page, not a folder: its
   *   items are taken as sitting where it sits.
   * - `resource/x-bb-file` carries `contentDetail["resource/x-bb-file"].file.permanentUrl`,
   *   `/bbcswebdav/…`: the same address the outline's file row carries, so a file read either way
   *   is the same file to BetterHuskyCT, and one already there is not sent again.
   * - `resource/x-bb-document` carries its HTML in `body.rawText`; its attachments are
   *   `<a data-bbfile="{…linkName…}" href="/bbcswebdav/…">`.
   * - `resource/x-bb-externallink` carries its address in its detail; `resource/x-bb-blti-link`
   *   is a tool launched from HuskyCT.
   *
   * { files, links, tools, activities, unaddressed, documents: [] }, or null if it could not be
   * read this way.
   */
  const CONTENT_ITEMS_MAX = 5000;
  const CONTENT_DEPTH_MAX = 12;

  async function readMaterialsApi(courseId, opts) {
    const timeout = (opts && opts.apiTimeout) || 8000;
    const out = { files: [], links: [], tools: [], activities: 0, unaddressed: 0, documents: [] };
    const seenFiles = new Set();
    let items = 0;
    const addFile = (path, title, href) => {
      const url = huskyctUrl(href);
      if (!/^https:\/\/(lms|huskyct)\.uconn\.edu\/bbcswebdav\//.test(url)) return false;
      if (!seenFiles.has(url)) {
        seenFiles.add(url);
        out.files.push({ path, title, url });
      }
      return true;
    };

    const walk = async (parentId, path, depth) => {
      let next =
        "/learn/api/v1/courses/" + encodeURIComponent(courseId) + "/contents/" + encodeURIComponent(parentId) + "/children?limit=1000&offset=0";
      while (next) {
        const answer = await fetchJson(next, timeout);
        if (!answer || !Array.isArray(answer.results)) return false;
        for (const item of answer.results) {
          if (++items > CONTENT_ITEMS_MAX) return true;
          if (!item || typeof item.id !== "string" || (item.visibility && item.visibility !== "VISIBLE")) continue;
          const handler = String(item.contentHandler || "");
          const detail = (item.contentDetail && item.contentDetail[handler]) || {};
          const title = textOf({ textContent: item.title });
          if (handler === "resource/x-bb-lesson" || handler === "resource/x-bb-folder") {
            if (depth >= CONTENT_DEPTH_MAX) continue;
            const inside = detail.isBbPage ? path : path.concat(title || "Untitled");
            if (!(await walk(item.id, inside, depth + 1))) return false;
          } else if (handler === "resource/x-bb-file") {
            const file = detail.file || {};
            if (!file.permanentUrl || !addFile(path, title || textOf({ textContent: file.fileName }), file.permanentUrl)) out.unaddressed += 1;
          } else if (handler === "resource/x-bb-document") {
            const html = item.body && typeof item.body === "object" ? item.body.rawText : item.body;
            const found = documentContents(html, title);
            for (const file of found.files) addFile(path, file.title, file.href);
            for (const link of found.links) out.links.push({ path, ...link });
          } else if (handler === "resource/x-bb-externallink") {
            const url = unwrapLink(detail.url);
            if (/^https?:/i.test(url)) out.links.push({ path, title, url, kind: isVideoLink(url) ? "video" : "link" });
          } else if (handler === "resource/x-bb-blti-link") {
            out.tools.push({ path, title });
          } else if (/asmt|assignment|assessment|discussion|journal|survey|test/i.test(handler)) {
            out.activities += 1;
          }
        }
        // Only HuskyCT's own content address is followed, never one the answer names elsewhere.
        const following = answer.paging && answer.paging.nextPage ? String(answer.paging.nextPage) : "";
        next = /^\/learn\/api\/v1\/courses\//.test(following) && answer.results.length > 0 ? following : null;
      }
      return true;
    };
    return (await walk("ROOT", [], 0)) ? out : null;
  }

  /** A document's attachments ({ title, href }) and links, from its HTML, read in a document of its own so nothing in it runs. */
  function documentContents(html, title) {
    const empty = { files: [], links: [] };
    if (!html) return empty;
    let root;
    try {
      root = new window.DOMParser().parseFromString(String(html), "text/html").body;
    } catch {
      return empty;
    }
    const files = [];
    for (const anchor of root.querySelectorAll("a[data-bbfile][href]")) {
      const href = anchor.getAttribute("href") || "";
      if (!/\/bbcswebdav\//.test(href)) continue;
      let name = "";
      try {
        name = String(JSON.parse(anchor.getAttribute("data-bbfile") || "{}").linkName || "");
      } catch {
        /* named by its text instead */
      }
      files.push({ title: textOf({ textContent: name }) || textOf(anchor) || title, href });
      anchor.remove();
    }
    return { files, links: linksIn(root, title) };
  }

  /** `1268` -> "Fall 2026". */
  function termLabel(code) {
    const value = Number(code);
    const season = TERM_SEASONS[value % 10];
    return season ? season + " " + (2000 + Math.floor((value % 1000) / 10)) : null;
  }

  /**
   * The walk for materials: every course's content, opened fully, and every
   * document in it. Nothing is downloaded here; this only lists.
   */
  async function collectMaterials(options) {
    const opts = Object.assign({ gap: 150, onProgress() {}, shouldStop: () => false }, options);
    const manifest = { term: null, courses: [], stopped: false, problems: [] };
    let unaddressed = 0;

    opts.onProgress({ step: "courses" });
    const found = await findCourses(opts);
    const { queue } = found;
    manifest.problems.push(...coursesProblems(found));
    manifest.term = walkTerm(found);

    for (let index = 0; index < queue.length; index++) {
      if (opts.shouldStop()) {
        manifest.stopped = true;
        break;
      }
      const course = queue[index];
      opts.onProgress({ step: "outline", course, index: index + 1, total: queue.length });
      const outline = await readMaterialsApi(course.id, opts);
      manifest.courses.push({
        id: course.id,
        code: course.code,
        files: outline ? outline.files : [],
        links: outline ? outline.links : [],
        tools: outline ? outline.tools : [],
        activities: outline ? outline.activities : 0,
        skipped: !outline,
      });
      if (outline) unaddressed += outline.unaddressed;
      await pause(opts.gap);
    }

    const skipped = manifest.courses.filter((course) => course.skipped).map((course) => course.code || course.id);
    if (skipped.length) manifest.problems.push({ key: "problemOutlines", params: { courses: skipped.join(", ") } });
    if (unaddressed) manifest.problems.push({ key: "problemFileAddress", params: { count: unaddressed } });
    const read = manifest.courses.filter((course) => !course.skipped);
    const empty = read.every((course) => !course.files.length && !course.links.length && !course.tools.length && !course.activities);
    if (read.length > 0 && empty) manifest.problems.push({ key: "problemNoContent" });
    return manifest;
  }

  /** A walk's problems as one line for the panel, or "" when there are none. */
  function problemsText(problems) {
    if (!problems || problems.length === 0) return "";
    return t("selfCheck", { problems: problems.map((problem) => t(problem.key, problem.params)).join(" ") });
  }

  function materialsSummary(manifest) {
    const courses = manifest.courses.filter((course) => !course.skipped);
    const count = (pick) => courses.reduce((total, course) => total + pick(course), 0);
    return {
      courses: courses.length,
      files: count((course) => course.files.length),
      videos: count((course) => course.links.filter((link) => link.kind === "video").length),
      links: count((course) => course.links.filter((link) => link.kind !== "video").length),
      tools: count((course) => course.tools.length),
    };
  }

  // --- grades ---------------------------------------------------------------------

  const MAX_GRADE_POINTS = 1000000;

  /** True when HuskyCT has sent the tab back to its sign-in page. */
  function looksSignedOut() {
    if (window.location.pathname === "/" && /[?&]new_loc=/.test(window.location.search)) return true;
    return Boolean(document.querySelector('#loginFormDiv, form[name="login"], input[name="user_id"]'));
  }

  // --- grades, read from HuskyCT's own data --------------------------------------------

  /**
   * A course's gradebook rows, asked for as the Grades page asks.
   *
   * Recorded on 2026-10-04: `GET /learn/api/v1/courses/<id>/gradebook/grades?userId=<me>&limit=25
   * &offset=0&sort=…&expand=lastAttempt,attemptsLeft,submissionStatus,column&includeNoGradeItems=…`
   * answers `{ paging: { count, nextPage }, results: [...] }`. A row has `columnId` (the item's id, the
   * same one the page's table carried), `column.effectiveColumnName` (its name), `status` ("GRADED"),
   * `displayGrade.score` and `pointsPossible`, `lastAttempt.status` ("COMPLETED" once handed in) and
   * `isExempt`.
   *
   * Only what was seen is trusted. A score counts only on a row whose status is GRADED, and an
   * attempt counts as handed in only when it is COMPLETED, so a value this has not seen leaves the
   * work open rather than marking it done, which is what the to-do list prefers. Anything unexpected,
   * or fewer rows than the answer says there are, gives null and the page is read instead.
   */
  const GRADES_PAGE = 25;
  const GRADES_MAX_PAGES = 40;

  /** The signed-in student's id, as "_1003488_1", or null. */
  async function readUserId(opts) {
    const me = await fetchJson("/learn/api/v1/users/me", (opts && opts.apiTimeout) || 8000);
    const id = me && typeof me.id === "string" ? me.id : null;
    return id && /^_\d+_\d+$/.test(id) ? id : null;
  }

  /** One gradebook row of HuskyCT's data as { id, title, status, earned, possible, label }, or null if it is not an item. */
  function gradeItemFromApi(row) {
    if (!row || typeof row !== "object") return null;
    const column = row.column && typeof row.column === "object" ? row.column : {};
    const id = String(row.columnId || column.id || "");
    if (!/^_\d+_\d+$/.test(id) || column.deleted) return null;
    const title = textOf({ textContent: column.effectiveColumnName || column.columnName });
    if (!title) return null;

    const item = { id, title: title.slice(0, 400), status: null, earned: null, possible: null, label: null };
    const graded = row.status === "GRADED";
    const display = row.displayGrade && typeof row.displayGrade === "object" ? row.displayGrade : {};
    const score = typeof display.score === "number" ? display.score : typeof row.effectiveScore === "number" ? row.effectiveScore : null;
    const possible = typeof row.pointsPossible === "number" ? row.pointsPossible : typeof column.possible === "number" ? column.possible : null;
    if (graded && score !== null && possible !== null && score <= MAX_GRADE_POINTS && possible <= MAX_GRADE_POINTS) {
      item.earned = score;
      item.possible = possible;
      item.status = "Graded";
      return item;
    }
    const attempt = row.lastAttempt && typeof row.lastAttempt === "object" ? row.lastAttempt : null;
    if (attempt && attempt.status === "COMPLETED") item.status = "Submitted";
    item.label = row.isExempt ? "Exempt" : "Not graded";
    return item;
  }

  /** The course's gradebook items, or null if they could not be read this way. */
  async function readGradesApi(courseId, userId, opts) {
    const timeout = (opts && opts.apiTimeout) || 8000;
    const items = [];
    const seen = new Set();
    let next =
      "/learn/api/v1/courses/" + encodeURIComponent(courseId) + "/gradebook/grades?userId=" + encodeURIComponent(userId) +
      "&limit=" + GRADES_PAGE + "&offset=0&sort=column.position(asc)&expand=lastAttempt,attemptsLeft,submissionStatus,column&includeNoGradeItems=true";
    let rows = 0;
    let expected = null;

    for (let page = 0; next && page < GRADES_MAX_PAGES; page++) {
      const answer = await fetchJson(next, timeout);
      if (!answer || !Array.isArray(answer.results)) return null;
      rows += answer.results.length;
      if (answer.paging && typeof answer.paging.count === "number") expected = answer.paging.count;
      for (const row of answer.results) {
        const item = gradeItemFromApi(row);
        if (item && !seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
      }
      const following = answer.paging && answer.paging.nextPage ? String(answer.paging.nextPage) : "";
      next = /^\/learn\/api\/v1\/courses\//.test(following) && answer.results.length > 0 ? following : null;
    }
    // Stopped short of what HuskyCT says is there: not a whole gradebook, so it is not sent as one.
    if (next || (expected !== null && rows < expected)) return null;
    return items;
  }

  /**
   * The walk for grades: each current course's gradebook from HuskyCT's own data, every page of
   * it. A course whose gradebook did not come whole is marked skipped, so what BetterHuskyCT
   * already holds for it is left as it is. A sign-out stops the walk and says so, instead of
   * failing on every course that is left.
   */
  async function collectGrades(options) {
    const opts = Object.assign({ gap: 250, onProgress() {}, shouldStop: () => false }, options);
    const manifest = { term: null, courses: [], stopped: false, signedOut: false, problems: [] };
    opts.onProgress({ step: "courses" });
    lastApiFailure = null;
    const found = await findCourses(opts);
    const { queue } = found;
    manifest.problems.push(...coursesProblems(found));
    manifest.term = walkTerm(found);
    // Who is signed in, which HuskyCT's gradebook data is asked for by.
    const userId = queue.length ? await readUserId(opts) : null;

    for (let index = 0; index < queue.length; index++) {
      if (opts.shouldStop()) {
        manifest.stopped = true;
        break;
      }
      const course = queue[index];
      opts.onProgress({ step: "grades", course, index: index + 1, total: queue.length });
      const items = userId ? await readGradesApi(course.id, userId, opts) : null;
      manifest.courses.push({ id: course.id, code: course.code, items: items || [], skipped: !items, reason: items ? null : "never", at: null });
      if (!items && lastApiFailure === "HTTP 401") {
        manifest.signedOut = true;
        break;
      }
      await pause(opts.gap);
    }

    const skipped = manifest.courses.filter((course) => course.skipped).map((course) => course.code || course.id);
    if (manifest.signedOut) manifest.problems.push({ key: "problemSignedOut" });
    else if (skipped.length) manifest.problems.push({ key: "problemGrades", params: { courses: skipped.join(", ") } });
    return manifest;
  }

  function gradesSummary(manifest) {
    const courses = manifest.courses.filter((course) => !course.skipped);
    const all = courses.reduce((list, course) => list.concat(course.items), []);
    return { courses: courses.length, items: all.length, scored: all.filter((item) => item.earned !== null).length };
  }

  /** A name Windows, macOS and Linux will all take for a file or folder. */
  function safeName(name, fallback) {
    const cleaned = String(name || "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/, "")
      .slice(0, 120);
    if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned)) return fallback;
    return cleaned;
  }

  function hasExtension(name) {
    return /\.[A-Za-z0-9]{2,5}$/.test(String(name || ""));
  }

  /** The file name the store was asked to give the file, from its signed address. */
  function nameFromStoreUrl(url) {
    try {
      const disposition = new URL(url).searchParams.get("response-content-disposition") || "";
      const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
      if (star) return decodeURIComponent(star[1]);
      const plain = /filename="?([^";]+)"?/i.exec(disposition);
      return plain ? plain[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * One file's bytes. The default request sends HuskyCT's cookie to HuskyCT and
   * nothing to the file store it redirects to — the store's signed address is
   * the permission, and it refuses a request that carries credentials.
   */
  async function fetchMaterial(url) {
    // A file's address may be a bare path, which the page's <base> would send elsewhere.
    const response = await window.fetch(huskyctUrl(url));
    if (!response.ok) throw new Error("HTTP " + response.status);
    const blob = await response.blob();
    return { blob, name: nameFromStoreUrl(response.url) };
  }

  // --- sending materials to BetterHuskyCT ---------------------------------------

  /**
   * Course materials delivered straight into BetterHuskyCT, tab to tab.
   *
   * The files can only be read here — HuskyCT's session is this page's — and
   * the app keeps them in its own browser storage, so they cross between the two
   * tabs with `postMessage`, never through a server. The app opened by the
   * button answers from its own origin; everything else is ignored. The app
   * first says which files it already holds, so a second send carries only what
   * is new, and it acknowledges each file once stored, so the next is fetched
   * only then and neither tab holds a term's files at once.
   *
   * Nothing here waits on a timer while files are moving: the app's tab comes
   * to the front and this one goes to the back, where browsers slow timers to
   * a crawl. Fetches and messages are not slowed.
   */
  const MATERIALS_PROTOCOL = "betterhuskyct/materials@1";

  function bhcOrigin() {
    return new URL(HUSKYPILOT_URL).origin;
  }

  /** The manifest in the shape the app's Materials page reads. */
  function materialsIndexFrom(manifest) {
    return {
      version: 1,
      term: manifest.term || null,
      updatedAt: new Date().toISOString(),
      courses: manifest.courses
        .filter((course) => !course.skipped)
        .map((course) => {
          const seen = new Set();
          const files = [];
          for (const file of course.files) {
            if (seen.has(file.url)) continue;
            seen.add(file.url);
            files.push({ key: file.url, path: file.path, title: file.title });
          }
          return {
            id: course.id,
            code: course.code || null,
            files,
            links: course.links.map((link) => ({ path: link.path, title: link.title, url: link.url, kind: link.kind })),
            tools: course.tools.map((tool) =>
              tool.url ? { path: tool.path, title: tool.title, url: tool.url } : { path: tool.path, title: tool.title },
            ),
          };
        }),
    };
  }

  /** The next message of `kind` from the app, or null after `timeout`. */
  function nextFromApp(kind, key, timeout, protocol = MATERIALS_PROTOCOL) {
    const origin = bhcOrigin();
    return new Promise((resolve) => {
      const finish = (value) => {
        window.removeEventListener("message", listen);
        clearTimeout(timer);
        resolve(value);
      };
      const listen = (event) => {
        if (event.origin !== origin) return;
        const data = event.data;
        if (!data || data.protocol !== protocol || data.kind !== kind) return;
        if (key && data.key !== key) return;
        finish(data);
      };
      window.addEventListener("message", listen);
      const timer = setTimeout(() => finish(null), timeout);
    });
  }

  async function sendMaterialsToBhc(target, manifest, opts) {
    const options = Object.assign(
      { helloEvery: 500, connectTimeout: 30000, fileTimeout: 120000, onProgress() {}, shouldStop: () => false },
      opts,
    );
    const origin = bhcOrigin();
    const post = (message) => target.postMessage(Object.assign({ protocol: MATERIALS_PROTOCOL }, message), origin);
    const result = { connected: false, sent: 0, skipped: 0, failed: 0, tooBig: 0 };

    // The app's page may still be loading: say hello until it answers.
    const ready = nextFromApp("ready", null, options.connectTimeout);
    const hello = () => {
      try {
        post({ kind: "hello" });
      } catch {
        /* not there yet */
      }
    };
    hello();
    const greeting = window.setInterval(hello, options.helloEvery);
    const answer = await ready;
    window.clearInterval(greeting);
    if (!answer) return result;
    result.connected = true;

    const have = new Set(Array.isArray(answer.have) ? answer.have : []);
    const index = materialsIndexFrom(manifest);
    const toSend = [];
    for (const course of index.courses) {
      for (const file of course.files) {
        if (have.has(file.key)) result.skipped++;
        else toSend.push(file);
      }
    }
    post({ kind: "index", index, sending: toSend.length });

    for (let i = 0; i < toSend.length; i++) {
      if (options.shouldStop()) break;
      const file = toSend[i];
      options.onProgress({ index: i + 1, total: toSend.length, name: file.title });
      try {
        const fetched = await fetchMaterial(file.key);
        // A file too big for the way it would go (the bridge's storage) waits for Collect everything, which hands it over whole.
        if (target.maxBlobBytes && fetched.blob.size > target.maxBlobBytes) {
          result.tooBig++;
          continue;
        }
        const name = safeName(hasExtension(file.title) ? file.title : fetched.name || file.title, "file");
        const stored = nextFromApp("stored", file.key, options.fileTimeout);
        post({ kind: "file", key: file.key, name, type: fetched.blob.type || "", blob: fetched.blob });
        const ack = await stored;
        if (ack && ack.ok) result.sent++;
        else result.failed++;
      } catch {
        result.failed++;
      }
    }
    post({ kind: "done", complete: !manifest.stopped && !options.shouldStop() && result.failed === 0 });
    return result;
  }

  /**
   * The gradebooks in the shape the app's Grades page reads. Courses that did
   * not open completely are left out, so a half-read gradebook never replaces
   * a whole one the app already has.
   */
  const GRADES_PROTOCOL = "betterhuskyct/grades@1";

  function gradesSnapshotFrom(manifest) {
    return {
      version: 1,
      term: manifest.term || null,
      takenAt: new Date().toISOString(),
      courses: manifest.courses
        .filter((course) => !course.skipped)
        .map((course) => ({ id: course.id, code: course.code || null, items: course.items.slice(0, 1000) })),
    };
  }

  /** Hello until the app answers, then the gradebooks, then wait to hear they were kept. */
  async function sendGradesToBhc(target, manifest, opts) {
    const options = Object.assign({ helloEvery: 500, connectTimeout: 30000, storedTimeout: 30000 }, opts);
    const origin = bhcOrigin();
    const post = (message) => target.postMessage(Object.assign({ protocol: GRADES_PROTOCOL }, message), origin);
    const result = { connected: false, stored: false, courses: 0, items: 0 };

    const ready = nextFromApp("ready", null, options.connectTimeout, GRADES_PROTOCOL);
    const hello = () => {
      try {
        post({ kind: "hello" });
      } catch {
        /* not there yet */
      }
    };
    hello();
    const greeting = window.setInterval(hello, options.helloEvery);
    const answer = await ready;
    window.clearInterval(greeting);
    if (!answer) return result;
    result.connected = true;

    const grades = gradesSnapshotFrom(manifest);
    const stored = nextFromApp("stored", null, options.storedTimeout, GRADES_PROTOCOL);
    post({ kind: "grades", grades });
    const ack = await stored;
    result.stored = Boolean(ack && ack.ok);
    result.courses = grades.courses.length;
    result.items = grades.courses.reduce((total, course) => total + course.items.length, 0);
    return result;
  }

  /**
   * Everything in the basket, as the sync payload wants it.
   *
   * Announcements are interleaved by rank — every course's newest, then every
   * course's second-newest — so that trimming from the end to fit the link
   * drops each course's oldest first, rather than a whole course.
   */
  function basketContents(basket) {
    const perCourse = basket.courses
      .filter((course) => course.announcementsAt)
      .map((course) =>
        announcementsToCandidates(course.announcements, course.code, new Date(course.announcementsAt)),
      );
    const announcements = [];
    const longest = Math.max(0, ...perCourse.map((list) => list.length));
    for (let rank = 0; rank < longest; rank += 1) {
      for (const list of perCourse) if (rank < list.length) announcements.push(list[rank]);
    }
    return { records: deadlineRecords(basket), announcements };
  }

  /**
   * The link for the whole basket, trimmed until it fits.
   *
   * Returns how many announcements had to stay behind, so the panel can say so
   * rather than let the student think everything went.
   */
  async function basketLink(basket, now) {
    const { records, announcements } = basketContents(basket);
    let kept = announcements;
    let link = await huskypilotLink(records, now, kept);
    while (link.length - HUSKYPILOT_URL.length - "#sync=".length > PACKED_LIMIT && kept.length > 0) {
      kept = kept.slice(0, Math.floor(kept.length * 0.8));
      link = await huskypilotLink(records, now, kept);
    }
    return {
      link,
      deadlines: records.length,
      announcements: kept.length,
      leftOut: announcements.length - kept.length,
    };
  }


  // --------------------------------------------------- sending to BetterHuskyCT

  /**
   * The dashboard accepts a whole set-up in the fragment of a URL: JSON,
   * gzipped, base64url, behind `#sync=`. A fragment is never sent to a server,
   * which is what keeps this honest — the data goes from HuskyCT to the user's
   * own copy of BetterHuskyCT and nowhere else. There is nothing to store and
   * nothing to expire.
   *
   * The shape below is not invented here. It is what `parseSyncPayload` in the
   * app accepts, and that reader is deliberately strict: a payload that does not
   * match is dropped whole rather than half-applied, and `courses` has to carry
   * its own `version` for the same reason.
   */
  const HUSKYPILOT_URL = "https://betterhuskyct.vercel.app/";
  const SYNC_VERSION = 1;

  /** gzip, then base64url — the same three steps the app reverses. */
  async function packSync(text) {
    const stream = new Blob([new TextEncoder().encode(text)])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());

    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /**
   * A collected record as the dashboard's own task shape.
   *
   * The id is `uid + ":" + start` because that is exactly how the app builds one
   * from a calendar file. Sending a deadline that is already there therefore
   * matches the existing entry rather than adding a second copy of it.
   */
  function taskFromRecord(record) {
    return {
      id: record.uid + ":" + record.start,
      title: record.title,
      course: record.course === undefined ? null : record.course,
      start: record.start,
      dateKey: record.allDay ? record.start.slice(0, 10) : null,
      end: record.end === undefined ? null : record.end,
      allDay: Boolean(record.allDay),
      location: record.location === undefined ? null : record.location,
      kind: record.kind === undefined ? null : record.kind,
    };
  }

  /**
   * The sync payload, carrying only what was just collected.
   *
   * Ticks, effort marks and courses go over empty on purpose. The app merges
   * additively — courses are only ever added, ticks are unioned — so an empty
   * set says "change nothing here". Filling them in would mean sending a guess
   * about the user's other devices back to them.
   *
   * `announcements` is always present, empty or not, so the shape of what this
   * sends does not change with which page the button was pressed on.
   */
  function syncPayload(records, now, announcements, courseColors) {
    const stamp = (now || new Date()).toISOString();
    return {
      version: SYNC_VERSION,
      exportedAt: stamp,
      feeds: [
        {
          name: "HuskyCT to-do",
          courseId: null,
          importedAt: stamp,
          events: records.map(taskFromRecord),
        },
      ],
      completedIds: [],
      courses: { version: 1, courses: [], assignments: {} },
      announcements: announcements || [],
      courseColors: courseColors || {},
    };
  }

  /** The link the panel opens: the payload, carried in the fragment. */
  async function huskypilotLink(records, now, announcements) {
    const packed = await packSync(
      JSON.stringify(syncPayload(records, now, announcements)),
    );
    return HUSKYPILOT_URL + "#sync=" + packed;
  }

  /**
   * The basket, delivered straight into BetterHuskyCT with `postMessage` —
   * the same route course materials and grades already use — instead of a
   * `#sync=` link the student has to paste in and then confirm on a banner.
   *
   * There is no size limit to trim against here: that limit exists only
   * because a link rides in a URL, and a `postMessage` does not. A caller
   * that gets no answer within `connectTimeout` is told so and sends
   * nothing; `huskypilotLink` is still there as the way in by hand.
   */
  const TASKS_PROTOCOL = "betterhuskyct/tasks@1";

  async function sendTasksToBhc(target, basket, opts) {
    const options = Object.assign({ helloEvery: 500, connectTimeout: 30000, storedTimeout: 15000 }, opts);
    const origin = bhcOrigin();
    const post = (message) => target.postMessage(Object.assign({ protocol: TASKS_PROTOCOL }, message), origin);
    const result = { connected: false, stored: false, deadlines: 0, announcements: 0 };

    const ready = nextFromApp("ready", null, options.connectTimeout, TASKS_PROTOCOL);
    const hello = () => {
      try {
        post({ kind: "hello" });
      } catch {
        /* not there yet */
      }
    };
    hello();
    const greeting = window.setInterval(hello, options.helloEvery);
    const answer = await ready;
    window.clearInterval(greeting);
    if (!answer) return result;
    result.connected = true;

    const { records, announcements } = basketContents(basket);
    const payload = syncPayload(records, new Date(), announcements, colorsByCode(window.localStorage, basket));
    const stored = nextFromApp("stored", null, options.storedTimeout, TASKS_PROTOCOL);
    post({ kind: "sync", payload });
    const ack = await stored;
    result.stored = Boolean(ack && ack.ok);
    result.deadlines = records.length;
    result.announcements = announcements.length;
    return result;
  }

  /**
   * The BetterHuskyCT tab to send to, found once the walk is over.
   *
   * It must not be opened before the walk: a new tab takes the focus, the
   * HuskyCT tab goes to the back, and a tab in the back has its timers slowed
   * and its pages not drawn, so every course fails to open (1.5.0 did this).
   * After the walk a browser no longer lets a script open a new tab, but a
   * tab this script opened earlier is found by its name and is not a popup.
   * When there is none, nothing opens, and BetterHuskyCT's Sync brings it over later.
   * A tab already on BetterHuskyCT is left as it is, so nothing reloads.
   */
  function openBhcTab() {
    try {
      const tab = window.open("", "betterhuskyct");
      if (!tab) return null;
      try {
        // A tab this press just opened is blank; read its address to tell.
        // Reading another site's address throws, which is the answer we want.
        if (tab.location.href === "about:blank") tab.location.href = HUSKYPILOT_URL;
      } catch {
        /* already a page of BetterHuskyCT: leave it alone */
      }
      try {
        window.sessionStorage.setItem(BHC_OPENED_KEY, "1");
      } catch {
        /* a later automatic sync then simply does not look for the tab */
      }
      return tab;
    } catch {
      return null;
    }
  }

  /**
   * The BetterHuskyCT tab this tab opened earlier, if one may still be open, for a sync that
   * nobody pressed. It never opens one: with no press, a new tab is a popup the browser blocks
   * and flags. So it looks only when this tab has opened one, and a blank tab that comes back
   * (the old one was closed) is shut again.
   */
  function findBhcTab() {
    try {
      if (window.sessionStorage.getItem(BHC_OPENED_KEY) !== "1") return null;
      const tab = window.open("", "betterhuskyct");
      let gone = !tab || tab.closed;
      if (tab && !gone) {
        try {
          // Reading another site's address throws: that is BetterHuskyCT, still there.
          if (tab.location.href === "about:blank") {
            tab.close();
            gone = true;
          }
        } catch {
          /* still there */
        }
      }
      if (gone) window.sessionStorage.removeItem(BHC_OPENED_KEY);
      return gone ? null : tab;
    } catch {
      return null;
    }
  }

  /** The line the panel shows while Collect everything walks: the basket, then the gradebooks, then the files. */
  function collectProgressText(progress) {
    const course = progress.course ? progress.course.code || progress.course.id : "";
    if (progress.walk === "grades") {
      return progress.step === "grades"
        ? t("collectingGrades", { course, index: progress.index, total: progress.total })
        : t("collectingCourses");
    }
    if (progress.walk === "materials") {
      return progress.course
        ? t("collectingMaterials", { course, index: progress.index, total: progress.total })
        : t("collectingCourses");
    }
    if (progress.step === "courses") return t("collectingCourses");
    if (progress.step === "duedates") return t("collectingDueDates");
    return t("collectingCourse", { course, index: progress.index, total: progress.total });
  }

  /**
   * What to do on the page the panel happens to be sitting on.
   *
   * The panel offers several actions and nothing on screen says which one this page
   * wants. Working that out is the script's job, not the reader's.
   */
  function guidanceFor(scope, courseId, pathname) {
    const root = scope || document;

    if (courseId && /\/announcements/.test(String(pathname || ""))) {
      return t("guideAnnouncements");
    }
    // The Courses page, recognised by its to-do list or, in a quiet week when
    // that list is empty, by its own path.
    if (root.querySelector("[aria-label*=', due ']") || /^\/ultra\/course\/?$/.test(String(pathname || ""))) {
      return t("guideTodo");
    }
    if (courseId) {
      return t("guideCourse");
    }
    return t("guideNeither");
  }

  // ------------------------------------------------------------------- the sync

  /**
   * The quick sync: courses, announcements and grades, all from HuskyCT's own data.
   *
   * It opens no page and moves nothing on the screen, so it can run while the student reads
   * HuskyCT, and on its own when HuskyCT is opened. A course whose data cannot be read is skipped.
   * The to-do list still needs the Courses page, and stays with Collect everything; the due dates
   * come to BetterHuskyCT through the calendar link.
   *
   * What it reads goes into the basket (announcements) and, as one reading, into the sync state
   * (grades), so a later send has it.
   */
  const SYNC_KEY = "huskypilot.helper.sync.v1";
  const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000;
  /** Set once this tab has opened BetterHuskyCT, so a later page load knows its named tab may still be there. */
  const BHC_OPENED_KEY = "huskypilot.helper.bhcOpened";
  /**
   * What BetterHuskyCT's own Sync button says to this tab, and what this tab says back. The button opens
   * (or finds) a HuskyCT tab and asks it for a sync; the answer is an ack, progress, and a done, all sent
   * to the tab that asked. Only BetterHuskyCT's origin is heard.
   */
  const SYNC_PROTOCOL = "betterhuskyct/sync@1";

  function emptySyncState() {
    return { at: null, auto: true, pending: false, grades: null };
  }

  function readSyncState(storage) {
    try {
      const parsed = JSON.parse(storage.getItem(SYNC_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return emptySyncState();
      return {
        at: typeof parsed.at === "string" && !Number.isNaN(Date.parse(parsed.at)) ? parsed.at : null,
        auto: parsed.auto !== false,
        pending: parsed.pending === true,
        grades: parsed.grades && Array.isArray(parsed.grades.courses) ? parsed.grades : null,
      };
    } catch {
      return emptySyncState();
    }
  }

  function writeSyncState(storage, state) {
    try {
      storage.setItem(SYNC_KEY, JSON.stringify(state));
    } catch {
      /* the reading holds for this visit and is read again next time */
    }
  }

  /** Whether an automatic sync is due: switched on, and not done within the last few hours. */
  function autoSyncDue(state, now) {
    if (!state.auto) return false;
    return !state.at || now.valueOf() - Date.parse(state.at) >= AUTO_SYNC_AFTER_MS;
  }

  async function syncLight(options) {
    const opts = Object.assign(
      { every: 300, pageTimeout: 15000, apiTimeout: 8000, gap: 100, onProgress() {}, shouldStop: () => false },
      options,
    );
    const storage = window.localStorage;
    const out = { ok: false, courses: 0, announcements: 0, gradeItems: 0, dueDates: 0, skipped: [], stopped: false, grades: null, materials: null, reason: null, detail: null };
    // When nothing is read, which step it stopped at and what HuskyCT said. A 401 is HuskyCT
    // saying the student is signed out, whatever page the tab shows.
    const fail = (step) => {
      out.reason = lastApiFailure === "HTTP 401" ? "signedout" : step;
      out.detail = lastApiFailure || "unexpected answer";
      return out;
    };
    lastApiFailure = null;

    const found = await findCourses(Object.assign({}, opts, { apiOnly: true }));
    if (!found) return fail("courses");
    if (found.queue.length === 0) {
      out.reason = "nocourses";
      return out;
    }
    const queue = found.queue;
    out.courses = queue.length;
    const save = (result) => {
      if (result.changed) writeBasket(storage, result.basket);
    };
    save(rememberCourses(readBasket(storage), queue));

    // The deadlines are extra to what a sync is for, like the files: a calendar that will not
    // answer leaves them out and does not fail the sync, and what it hit is not what a failure reports.
    const failedBefore = lastApiFailure;
    const dueDates = await readDueDatesApi(opts);
    lastApiFailure = failedBefore;
    if (dueDates) {
      out.dueDates = dueDates.length;
      save(rememberDueDates(readBasket(storage), todosToRecords(dueDates), new Date()));
    }

    const userId = await readUserId(opts);
    const manifest = { term: walkTerm(found), courses: [], stopped: false, signedOut: false, problems: [] };
    // Each course's files, links and tools, in the shape Collect everything gives them, so the same
    // send carries them and BetterHuskyCT is sent only the files it does not have.
    const materials = { term: manifest.term, courses: [], stopped: false, reused: 0, problems: [] };
    let readAny = false;
    for (let index = 0; index < queue.length; index++) {
      if (opts.shouldStop()) {
        out.stopped = true;
        manifest.stopped = true;
        break;
      }
      const course = queue[index];
      opts.onProgress({ step: "course", course, index: index + 1, total: queue.length });

      const rows = await readAnnouncementsApi(course.id, opts);
      if (rows === null) out.skipped.push(course.code || course.id);
      else {
        readAny = true;
        out.announcements += rows.length;
        // Re-read first: a collection in another HuskyCT tab may have written to the basket meanwhile.
        save(rememberAnnouncements(readBasket(storage), course, rows, new Date()));
      }

      const items = userId ? await readGradesApi(course.id, userId, opts) : null;
      manifest.courses.push({ id: course.id, code: course.code, items: items || [], skipped: items === null, reason: items === null ? "never" : null, at: null });
      if (items) out.gradeItems += items.length;

      // The files are extra to what a sync is for: what they hit is not what a failed sync reports.
      const failure = lastApiFailure;
      const content = await readMaterialsApi(course.id, opts);
      lastApiFailure = failure;
      materials.courses.push({
        id: course.id,
        code: course.code,
        files: content ? content.files : [],
        links: content ? content.links : [],
        tools: content ? content.tools : [],
        activities: content ? content.activities : 0,
        skipped: !content,
      });
      await pause(opts.gap);
    }

    out.grades = manifest.courses.some((course) => !course.skipped) ? manifest : null;
    materials.stopped = out.stopped;
    out.materials = materials.courses.some((course) => !course.skipped) ? materials : null;
    out.ok = readAny || out.grades !== null;
    return out.ok || out.stopped ? out : fail("read");
  }

  /**
   * Sends a sync's results to BetterHuskyCT over `postMessage`: the basket (announcements and
   * whatever deadlines it holds), then the gradebooks, then the course files BetterHuskyCT does
   * not have yet. Returns the parts that arrived, whether any did not, and how many files went.
   */
  async function deliverSync(tab, basket, grades, timing, materials, onFile) {
    const parts = [];
    let failed = false;
    let files = 0;
    // A BetterHuskyCT tab that has only just been opened needs a few seconds to load before it answers.
    const waits = Object.assign({ connectTimeout: 15000 }, timing);
    const summary = basketSummary(basket);
    if (summary.deadlines > 0 || summary.announcements > 0) {
      const result = await sendTasksToBhc(tab, basket, waits);
      if (result.connected && result.stored) parts.push(t("sentPartTasks", result));
      else failed = true;
    }
    if (grades && grades.courses.some((course) => !course.skipped)) {
      const result = await sendGradesToBhc(tab, grades, waits);
      if (result.connected && result.stored) parts.push(t("sentPartGrades", result));
      else failed = true;
    }
    if (materials && materials.courses.some((course) => !course.skipped)) {
      const result = await sendMaterialsToBhc(tab, materials, Object.assign({}, waits, { onProgress: onFile || (() => undefined) }));
      if (result.connected) {
        files = result.sent;
        parts.push(t("sentPartFiles", { files: result.sent + result.skipped }));
        if (result.failed) failed = true;
      } else {
        failed = true;
      }
    }
    return { parts, failed, files };
  }

  // ----------------------------------------------------------------- the bridge

  /**
   * Lets BetterHuskyCT's Sync button run the sync in a HuskyCT tab the student never has to look at.
   *
   * A page cannot open a tab behind itself, and pages on two sites cannot talk unless one opened
   * the other. The userscript manager can do both, so the helper also runs on BetterHuskyCT: there
   * it opens HuskyCT in a background tab when none is open, and it carries messages between the
   * two through the manager's storage, which every tab running this script shares. Each side hears
   * the other as it would over postMessage, so the sync and the sending are the same code as ever.
   *
   * Without the manager's storage (an install from before 1.11.0, or a test page) none of this
   * runs, and BetterHuskyCT opens HuskyCT in front, as it did.
   */
  const BRIDGE_CONTROL = "betterhuskyct/bridge@1";
  const BRIDGE_OUT = "betterhuskyct/bridge-out@1";
  const BRIDGE_IN = "betterhuskyct/bridge-in@1";
  const BRIDGE_TO_HUSKYCT = "bridge.toHuskyct";
  const BRIDGE_TO_BHC = "bridge.toBhc";
  const BRIDGE_ALIVE = "bridge.huskyctAlive";
  const HUSKYCT_HOME = "https://lms.uconn.edu/ultra/course";
  const HUSKYCT_ORIGIN = "https://lms.uconn.edu";
  /** A tab in the background runs its timers about once a minute, so it is taken for gone only after a few missed beats. */
  const HEARTBEAT_MS = 20000;
  const ALIVE_MS = 150000;
  /** Messages are kept long enough for a tab that is still loading to find them. */
  const KEEP_MS = 60000;
  /** A request a tab finds as it loads is answered only if this new: older, nobody is waiting for it. */
  const ANSWER_WITHIN_MS = 30000;
  /** How long a HuskyCT tab that looks alive has to answer before one is opened anyway. A live one answers within a second or two. */
  const OPEN_ANYWAY_MS = 6000;
  /** The helper says it is here once more this long after BetterHuskyCT has loaded, by when the page listens. */
  const HELLO_AFTER_LOAD_MS = 1500;

  function manager() {
    if (typeof GM_getValue !== "function" || typeof GM_setValue !== "function" || typeof GM_addValueChangeListener !== "function") {
      return null;
    }
    return {
      get: (key, fallback) => GM_getValue(key, fallback),
      set: (key, value) => GM_setValue(key, value),
      listen: (key, run) => GM_addValueChangeListener(key, run),
      openInTab: typeof GM_openInTab === "function" ? (url, options) => GM_openInTab(url, options) : null,
    };
  }

  let bridgeCount = 0;
  /** Sorts by when it was made, so the oldest HuskyCT tab is the one that answers. */
  function bridgeId() {
    bridgeCount += 1;
    return Date.now().toString(36).padStart(10, "0") + "-" + Math.random().toString(36).slice(2, 8) + "-" + bridgeCount;
  }

  function queueItems(value) {
    const items = value && Array.isArray(value.items) ? value.items : [];
    const now = Date.now();
    return items.filter((item) => item && typeof item.id === "string" && typeof item.at === "number" && now - item.at < KEEP_MS);
  }

  function pushQueue(store, key, data) {
    const items = queueItems(store.get(key, null));
    // Plain data only: what crosses between tabs is what postMessage would have carried.
    items.push({ id: bridgeId(), at: Date.now(), data: JSON.parse(JSON.stringify(data)) });
    store.set(key, { items });
  }

  /**
   * A file, across the bridge. The manager's storage holds text, not files, so a message carrying a
   * `blob` (a course file on its way to BetterHuskyCT) goes as the file's bytes in base64, a
   * piece to a key of its own, and the message itself goes through the queue with a note of
   * where they are. The other side puts the file back together, hands the message on as it was
   * sent, and empties those keys. Pieces nobody collected are emptied after a few minutes.
   */
  const BRIDGE_BLOBS = "bridge.blobs";
  const BRIDGE_BLOB_PIECE = 512 * 1024;
  /** Files above this stay off the bridge: storage is no place for them, and Collect everything carries them. */
  const BRIDGE_BLOB_MAX = 100 * 1024 * 1024;
  const BRIDGE_BLOB_KEEP_MS = 5 * 60 * 1000;

  function hasBlob(message) {
    const blob = message && message.blob;
    return Boolean(blob && typeof blob.arrayBuffer === "function" && typeof blob.size === "number");
  }

  function bytesToBase64(bytes) {
    let text = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
    return window.btoa(text);
  }

  function base64ToBytes(text) {
    const raw = window.atob(text);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
    return bytes;
  }

  async function pushWithBlob(store, key, message) {
    const now = Date.now();
    const kept = [];
    for (const entry of store.get(BRIDGE_BLOBS, []) || []) {
      if (!entry || typeof entry.id !== "string") continue;
      if (now - entry.at < BRIDGE_BLOB_KEEP_MS) kept.push(entry);
      else for (let index = 0; index < entry.pieces; index++) store.set("bridge.blob." + entry.id + "." + index, "");
    }
    const id = bridgeId();
    const bytes = new Uint8Array(await message.blob.arrayBuffer());
    const pieces = Math.max(1, Math.ceil(bytes.length / BRIDGE_BLOB_PIECE));
    for (let index = 0; index < pieces; index++) {
      store.set("bridge.blob." + id + "." + index, bytesToBase64(bytes.subarray(index * BRIDGE_BLOB_PIECE, (index + 1) * BRIDGE_BLOB_PIECE)));
    }
    kept.push({ id, pieces, at: now });
    store.set(BRIDGE_BLOBS, kept);
    const rest = Object.assign({}, message, { blob: undefined, bridgeBlob: { id, pieces, size: bytes.length, type: String(message.blob.type || "") } });
    pushQueue(store, key, rest);
  }

  /** A message with its file put back together and its pieces emptied, or null if a piece is missing. */
  function takeBlob(store, data) {
    const note = data.bridgeBlob;
    if (!note || typeof note.id !== "string" || !Number.isInteger(note.pieces) || note.pieces < 1 || note.pieces > 1000) return null;
    const parts = [];
    for (let index = 0; index < note.pieces; index++) {
      const key = "bridge.blob." + note.id + "." + index;
      const piece = store.get(key, null);
      store.set(key, "");
      if (typeof piece !== "string" || !piece) return null;
      parts.push(base64ToBytes(piece));
    }
    const blob = new window.Blob(parts, { type: String(note.type || "").slice(0, 200) });
    if (blob.size !== note.size) return null;
    const message = Object.assign({}, data, { blob });
    delete message.bridgeBlob;
    return message;
  }

  /**
   * Hands `run` each message not handled before, whenever the queue changes. What is already there
   * when this starts is for another page, except what is newer than `keepFirst`.
   */
  function drainQueue(store, key, run, keepFirst) {
    const seen = new Set();
    const drain = (value, first) => {
      for (const item of queueItems(value)) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        if (first && Date.now() - item.at > keepFirst) continue;
        run(item.data);
      }
    };
    drain(store.get(key, null), true);
    store.listen(key, (name, oldValue, newValue) => drain(newValue, false));
  }

  function aliveHuskyctTabs(store) {
    const alive = store.get(BRIDGE_ALIVE, {}) || {};
    const now = Date.now();
    return Object.keys(alive)
      .filter((id) => typeof alive[id] === "number" && now - alive[id] < ALIVE_MS)
      .sort();
  }

  /** On BetterHuskyCT: open HuskyCT behind it when asked, and carry messages both ways. */
  function startBridgeOnBhc() {
    const store = manager();
    if (!store) return;
    const origin = window.location.origin;
    // The tab opened for a sync, closed again when it is over; a tab the student opened is left alone.
    let opened = null;
    // When a HuskyCT tab last said anything here.
    let heardAt = 0;
    const toPage = (message) => window.postMessage(message, origin);
    const hello = () => toPage({ protocol: BRIDGE_CONTROL, kind: "pong", version: VERSION });
    const openHuskyct = () => {
      try {
        opened = store.openInTab(HUSKYCT_HOME, { active: false, insert: true, setParent: true });
      } catch {
        opened = null;
      }
    };

    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.protocol === BRIDGE_CONTROL && data.kind === "ping") {
        hello();
      } else if (data.protocol === BRIDGE_CONTROL && data.kind === "open") {
        if (!store.openInTab) return;
        if (aliveHuskyctTabs(store).length === 0) {
          openHuskyct();
          return;
        }
        // A HuskyCT tab that was closed may not have said so, and looks alive for a while after.
        // If none of the tabs that look alive speaks up soon, they are forgotten and one is opened.
        const askedAt = Date.now();
        window.setTimeout(() => {
          if (heardAt >= askedAt || opened) return;
          store.set(BRIDGE_ALIVE, {});
          openHuskyct();
        }, OPEN_ANYWAY_MS);
      } else if (data.protocol === BRIDGE_OUT) {
        pushQueue(store, BRIDGE_TO_HUSKYCT, data.data);
      }
    });

    drainQueue(
      store,
      BRIDGE_TO_BHC,
      (data) => {
        heardAt = Date.now();
        if (data && data.bridgeBlob) {
          const whole = takeBlob(store, data);
          // A file that did not arrive whole is not handed on: the sender, unanswered, counts it failed.
          if (whole) toPage({ protocol: BRIDGE_IN, origin: HUSKYCT_ORIGIN, data: whole });
          return;
        }
        toPage({ protocol: BRIDGE_IN, origin: HUSKYCT_ORIGIN, data });
        if (opened && data && data.protocol === SYNC_PROTOCOL && data.kind === "done") {
          const tab = opened;
          opened = null;
          window.setTimeout(() => {
            try {
              tab.close();
            } catch {
              /* already closed */
            }
          }, 3000);
        }
      },
      0,
    );

    // The page asks once whether the helper is here, and the manager may start this after it has.
    // So say it unasked as well: now, and once the page has loaded and its own code is listening.
    hello();
    const helloLater = () => window.setTimeout(hello, HELLO_AFTER_LOAD_MS);
    if (document.readyState === "complete") helloLater();
    else window.addEventListener("load", helloLater, { once: true });
  }

  /**
   * On HuskyCT: say this tab is here, and, if it is the one that answers, take what BetterHuskyCT
   * sends — a sync request to `answer`, anything else as the message it would have been.
   */
  function startBridgeOnHuskyct(answer) {
    const store = manager();
    if (!store) return;
    const me = bridgeId();
    const beat = () => {
      const alive = Object.assign({}, store.get(BRIDGE_ALIVE, {}) || {});
      const now = Date.now();
      for (const id of Object.keys(alive)) if (typeof alive[id] !== "number" || now - alive[id] >= ALIVE_MS) delete alive[id];
      alive[me] = now;
      store.set(BRIDGE_ALIVE, alive);
    };
    beat();
    window.setInterval(beat, HEARTBEAT_MS);
    window.addEventListener("pagehide", () => {
      const alive = Object.assign({}, store.get(BRIDGE_ALIVE, {}) || {});
      delete alive[me];
      store.set(BRIDGE_ALIVE, alive);
    });

    // One HuskyCT tab answers, or every open one would read HuskyCT at once.
    const answers = () => {
      const alive = aliveHuskyctTabs(store);
      return alive.length === 0 || alive[0] === me;
    };
    const toBhc = {
      maxBlobBytes: BRIDGE_BLOB_MAX,
      postMessage: (message) => {
        if (hasBlob(message)) void pushWithBlob(store, BRIDGE_TO_BHC, message);
        else pushQueue(store, BRIDGE_TO_BHC, message);
      },
    };

    drainQueue(
      store,
      BRIDGE_TO_HUSKYCT,
      (data) => {
        if (!answers()) return;
        if (data && data.protocol === SYNC_PROTOCOL && data.kind === "request") answer(toBhc);
        else window.dispatchEvent(new window.MessageEvent("message", { data, origin: bhcOrigin() }));
      },
      ANSWER_WITHIN_MS,
    );
  }

  // -------------------------------------------------------------------- panel

  // BetterHuskyCT's palette, light and dark, so the panel looks like the app it sends to.
  const style = `
    :host {
      all: initial;
      --surface: #ffffff; --subtle: #f2f4f7; --ink: #0f172a; --muted: #5d6b7f;
      --line: #e6e8ec; --line-strong: #d5d9e0; --blue: #2563eb; --blue-hover: #1d4ed8;
      --accent-soft: #eef3fd; --accent-ink: #1d4ed8; --ok: #15803d; --warn: #c2312a;
      --shadow: 0 1px 2px rgb(15 23 42 / .06), 0 12px 32px rgb(15 23 42 / .16);
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --surface: #12161f; --subtle: #181d27; --ink: #e5e9f0; --muted: #8b95a7;
        --line: #222936; --line-strong: #2e3646; --blue: #2f63d8; --blue-hover: #3a6fe4;
        --accent-soft: #172238; --accent-ink: #8fb4f8; --ok: #6fd39a; --warn: #ff8f7e;
        --shadow: 0 1px 2px rgb(0 0 0 / .3), 0 12px 32px rgb(0 0 0 / .45);
      }
    }
    .wrap {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      width: ${PANEL_WIDTH}px; max-height: 70vh; overflow: auto;
      font: 13px/1.5 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;
      color: var(--ink); background: var(--surface); border: 1px solid var(--line);
      border-radius: 12px; box-shadow: var(--shadow);
    }
    header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-bottom: 1px solid var(--line); cursor: default;
    }
    header b { font-size: 13px; font-weight: 600; }
    header span { font-size: 11px; color: var(--muted); }
    button.close {
      border: 0; background: none; cursor: pointer; font-size: 16px; line-height: 1; color: var(--muted);
      width: 24px; height: 24px; border-radius: 6px;
    }
    button.close:hover { background: var(--subtle); color: var(--ink); }
    button.lang {
      margin-left: auto; border: 1px solid var(--line); background: var(--surface); cursor: pointer;
      font: inherit; font-size: 11px; color: var(--ink); padding: 2px 8px; border-radius: 6px;
    }
    button.lang:hover { background: var(--subtle); }
    /* The way back. The panel used to be removed outright on close, which left
       anyone who dismissed it with no way to find it again — the buttons were
       still in the page, but nothing said so. The chip is always mounted; only
       one of the chip and the panel is ever visible. */
    .chip {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      display: none; align-items: center; gap: 7px;
      font: 500 13px/1 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;
      color: #fff; background: var(--blue); border: 0; cursor: pointer;
      padding: 9px 13px; border-radius: 10px; box-shadow: var(--shadow);
    }
    .chip:hover { background: var(--blue-hover); }
    .chip[data-dot="1"]::after {
      content: ""; width: 7px; height: 7px; border-radius: 999px;
      background: #ffd166; box-shadow: 0 0 0 2px rgba(255,255,255,.35);
    }
    :host([data-collapsed="1"]) .wrap { display: none; }
    :host([data-collapsed="1"]) .chip { display: inline-flex; }
    .body { padding: 12px; display: grid; gap: 8px; }
    button.act {
      width: 100%; text-align: left; padding: 7px 10px; cursor: pointer;
      border: 1px solid var(--line); border-radius: 8px; background: var(--surface);
      font: inherit; font-weight: 500; color: var(--ink);
      box-shadow: 0 1px 2px rgb(15 23 42 / .04);
      transition: background .12s, border-color .12s;
    }
    button.act:hover { background: var(--subtle); border-color: var(--line-strong); }
    button.act.primary { background: var(--blue); border-color: var(--blue); color: #fff; }
    button.act.primary:hover { background: var(--blue-hover); }
    button.act:disabled { opacity: .55; cursor: wait; }
    hr.sep { border: 0; border-top: 1px solid var(--line); margin: 4px 0; }
    textarea {
      width: 100%; box-sizing: border-box; min-height: 150px; resize: vertical;
      font: 11px/1.45 ui-monospace, Consolas, monospace; background: var(--surface);
      border: 1px solid var(--line); border-radius: 8px; padding: 8px; color: var(--ink);
    }
    .note { font-size: 11px; color: var(--muted); }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    .pill {
      display: inline-block; padding: 1px 6px; border-radius: 6px;
      background: var(--accent-soft); color: var(--accent-ink); font-size: 11px; font-weight: 600;
    }
  `;

  /**
   * The panel's markup as a string, in whatever language is current.
   *
   * Taken out of `mountPanel` so the one surface I cannot reach in a browser is
   * still checkable: there is no way to run the panel in this environment (the
   * DevTools connection to a signed-in Edge needs its per-connection approval),
   * and "the dictionary has Chinese in it" is a weaker claim than "the panel
   * would render Chinese".
   */
  function panelMarkup() {
    return `
      <header>
        <b>${t("panelTitle")}</b>
        <span class="pill">v${VERSION}</span>
        <button class="lang" data-role="lang" title="${t("languageLabel")}">${t("languageLabel")}</button>
        <button class="close" title="${t("hidePanel")}">×</button>
      </header>
      <div class="body">
        <div class="note" data-role="hint"></div>
        <div class="note" data-role="basket">${t("basketEmpty")}</div>
        <div class="note" data-role="sync" hidden></div>
        <button class="act" data-act="autosync">${t("autoOn")}</button>
        <hr class="sep" />
        <button class="act primary" data-act="collectall">${t("collectAll")}</button>
        <button class="act" data-act="todos">${t("sendDeadlines")}</button>
        <button class="act" data-act="emptybasket">${t("clearBasket")}</button>
        <hr class="sep" />
        <div class="note" data-role="materials" hidden></div>
        <div class="note" data-role="grades" hidden></div>
        <div class="note" data-role="status">${t("privacy")}</div>
      </div>
    `;
  }

  function mountPanel() {
    /**
     * One panel, ever.
     *
     * Measured, not defensive: injecting the script into a live page twice left
     * two orphaned panels stacked on top of each other, because nothing checked
     * whether one was already there. A userscript genuinely can run twice in a
     * page — a manager that re-injects, or a frame the match rules cover — and
     * the symptom is a panel that looks broken because a second one is sitting
     * invisibly on top of it. Clearing the old one makes mounting idempotent.
     */
    document.querySelectorAll("#huskypilot-helper").forEach((node) => node.remove());

    const host = document.createElement("div");
    host.id = "huskypilot-helper";
    const shadow = host.attachShadow({ mode: "open" });

    const styleTag = document.createElement("style");
    styleTag.textContent = style;

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    // One source for the markup: the same function the tests render. The
    // template used to be written out here, which meant a string could exist in
    // the panel that nothing could check.
    wrap.innerHTML = panelMarkup();

    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";

    shadow.append(styleTag, wrap, chip);
    document.documentElement.appendChild(host);

    /**
     * Collapse the panel to a chip, rather than deleting it.
     *
     * This is the whole "I cannot find the button" fix. The close button used to
     * call `host.remove()`, which took the panel — and every button in it, the
     * Send one included — out of the page for the rest of the
     * session. Nothing said how to get it back, because there was no way.
     */
    function setCollapsed(collapsed) {
      host.dataset.collapsed = collapsed ? "1" : "0";
    }
    setCollapsed(false);

    chip.addEventListener("click", () => setCollapsed(false));

    const status = wrap.querySelector('[data-role="status"]');
    const hint = wrap.querySelector('[data-role="hint"]');
    const langButton = wrap.querySelector('[data-role="lang"]');
    const basketLine = wrap.querySelector('[data-role="basket"]');
    const collectButton = wrap.querySelector('[data-act="collectall"]');
    const sendButton = wrap.querySelector('[data-act="todos"]');
    const emptyBasketButton = wrap.querySelector('[data-act="emptybasket"]');
    const materialsLine = wrap.querySelector('[data-role="materials"]');
    const gradesLine = wrap.querySelector('[data-role="grades"]');
    const syncLine = wrap.querySelector('[data-role="sync"]');
    const autoSyncButton = wrap.querySelector('[data-act="autosync"]');
    // The walk in progress, if any — `kind` says which button started it, and
    // that button becomes its Stop. The timer's own capture stands aside while
    // it runs: the walk reads each page itself, and knows when a page is really
    // the course it asked for.
    let walk = null;
    // The last grades reading. The sync keeps its own across visits.
    let syncState = readSyncState(window.localStorage);
    let grades = syncState.grades;
    // The basket in memory, re-read from storage on every tick so two HuskyCT
    // tabs collecting at once do not overwrite each other's courses.
    let basket = readBasket(window.localStorage);
    // How long an Announcements page has shown an empty list, so a course with
    // no announcements can be ticked off without mistaking "still loading".
    let emptyList = { path: "", ticks: 0 };

    /**
     * Both of these come after every element they touch, and the ordering is
     * load-bearing.
     *
     * `langButton` is a `const`. Wiring the switch or rendering the first time
     * before it is initialised throws "Cannot access 'langButton' before
     * initialization" and takes the whole panel with it, so the panel never
     * appears at all. That shipped in 0.14.0, and only a real page caught it:
     * the unit tests render the markup as a string and never run mountPanel.
     */
    langButton.addEventListener("click", () => {
      setLocale(otherLocale());
      relabel();
    });

    relabel();

    /** The page-specific advice, re-derivable so a language switch can refresh it. */
    function refreshGuidance() {
      hint.textContent = guidanceFor(document, currentCourseId(), window.location.pathname);
    }

    /**
     * The basket line, and which button leads: Collect while there is nothing to
     * send, Send once there is.
     */
    function refreshBasket() {
      const summary = basketSummary(basket);
      const empty = summary.courses === 0 && summary.deadlines === 0;
      basketLine.textContent = empty ? t("basketEmpty") : t("basketSummary", summary);
      basketLine.className = empty ? "note" : "note ok";
      emptyBasketButton.textContent = t("clearBasket");

      const ready = !walk && (summary.deadlines > 0 || summary.announcements > 0);
      const basketWalk = Boolean(walk && walk.kind === "basket");
      const syncWalk = Boolean(walk && walk.kind === "sync");
      collectButton.textContent = basketWalk ? t("stopCollecting") : t("collectAll");
      collectButton.disabled = syncWalk;
      autoSyncButton.textContent = syncState.auto ? t("autoOn") : t("autoOff");
      autoSyncButton.disabled = Boolean(walk);
      collectButton.classList.toggle("primary", !ready);
      sendButton.classList.toggle("primary", ready);
      sendButton.disabled = Boolean(walk);
      emptyBasketButton.disabled = Boolean(walk);
    }

    /**
     * Reads the page into the basket. Called on a timer because HuskyCT is a
     * single-page app: the content changes under a panel that is never remounted.
     * It only reads what is rendered — no request is made.
     */
    function captureTick() {
      if (walk) return;
      const path = window.location.pathname;
      const showingEmptyList =
        /\/announcements/.test(path) &&
        Boolean(document.querySelector(".announcement-list")) &&
        collectAnnouncements(document).length === 0;
      emptyList = showingEmptyList
        ? { path, ticks: emptyList.path === path ? emptyList.ticks + 1 : 1 }
        : { path, ticks: 0 };

      basket = readBasket(window.localStorage);
      const result = captureIntoBasket(basket, document, path, new Date(), emptyList.ticks >= 3);
      if (result.changed) {
        basket = result.basket;
        writeBasket(window.localStorage, basket);
      }
      refreshBasket();
      refreshGuidance();
    }

    /**
     * Re-render every string in the panel from the current dictionary.
     *
     * All of them, in one function, on purpose: a language switch that misses a
     * label leaves a half-Chinese panel, which reads worse than an English one.
     * Anything user-visible belongs here, and the tests check that the switch
     * reaches the header, the chip and the buttons.
     */
    function relabel() {
      document.documentElement.lang = locale;
      wrap.querySelector("header b").textContent = t("panelTitle");
      langButton.textContent = t("languageLabel");
      langButton.title = t("languageLabel");
      wrap.querySelector(".close").title = t("hidePanel");

      wrap.querySelector('[data-act="todos"]').textContent = t("sendDeadlines");
      wrap.querySelector('[data-role="status"]').textContent = t("privacy");

      chip.textContent = t("chip");
      chip.title = t("showPanel");

      refreshGuidance();
      refreshBasket();
    }


    // Reads only what is rendered; it makes no request.
    window.setInterval(captureTick, 1500);
    captureTick();
    // `relabel` sets every string, the page guidance included, so it is the
    // whole first render.
    relabel();
    autoSyncOnOpen();

    wrap.querySelector(".close").addEventListener("click", () => {
      setCollapsed(true);
    });


    /**
     * One sync, from a press or on its own. `tab` is where to send what it reads, or null; with
     * none, the reading is kept for BetterHuskyCT's next Sync.
     */
    async function runSync(tab, automatic, report) {
      // What a requesting BetterHuskyCT tab hears; a press or an automatic sync has no one to tell.
      const say = (message) => {
        if (report) report(message);
      };
      const nothing = { courses: 0, announcements: 0, gradeItems: 0, skipped: [], sent: false };
      walk = { stop: false, kind: "sync" };
      refreshBasket();
      syncLine.hidden = false;
      syncLine.className = "note";
      syncLine.textContent = t("syncing");
      try {
        const out = await syncLight({
          shouldStop: () => walk.stop,
          onProgress(progress) {
            const course = progress.course.code || progress.course.id;
            syncLine.textContent = t("syncingCourse", { course, index: progress.index, total: progress.total });
            say({ kind: "progress", course, index: progress.index, total: progress.total });
          },
        });
        if (!out.ok) {
          syncLine.className = "note warn";
          syncLine.textContent = automatic ? "" : t("syncNoData") + (out.detail ? t("syncNoDataWhy", { detail: out.detail }) : "");
          syncLine.hidden = Boolean(automatic);
          say(Object.assign({ kind: "done", ok: false }, nothing, { reason: out.reason, detail: out.detail }));
          return;
        }
        if (out.grades) grades = out.grades;
        syncState = Object.assign({}, syncState, { at: new Date().toISOString(), pending: true, grades });
        writeSyncState(window.localStorage, syncState);

        const readText = t("syncDone", { courses: out.courses, announcements: out.announcements, items: out.gradeItems });
        const skipped = out.skipped.length ? t("syncSkipped", { courses: out.skipped.join(", ") }) : "";
        const read = { courses: out.courses, announcements: out.announcements, gradeItems: out.gradeItems, skipped: out.skipped };
        if (!tab) {
          syncLine.className = "note warn";
          syncLine.textContent = readText + skipped + t(automatic ? "syncAutoReady" : "syncNotSent");
          say(Object.assign({ kind: "done", ok: true, sent: false }, read));
          return;
        }
        syncLine.textContent = readText + t("sendingToBhc");
        // Each file that goes says so, here and to the tab that asked, so a long send is not taken for a stall.
        const onFile = (step) => {
          syncLine.textContent = readText + t("sendingMaterial", step);
          say({ kind: "progress", step: "files", course: step.name, index: step.index, total: step.total });
        };
        const sent = await deliverSync(tab, readBasket(window.localStorage), grades, undefined, out.materials, onFile);
        read.files = sent.files;
        if (sent.parts.length > 0 && !sent.failed) {
          syncState = Object.assign({}, syncState, { pending: false });
          writeSyncState(window.localStorage, syncState);
          syncLine.className = "note ok";
          syncLine.textContent = readText + skipped + t("sentAll", { parts: sent.parts.join(t("sentPartsJoin")) });
          say(Object.assign({ kind: "done", ok: true, sent: true }, read));
        } else {
          say(Object.assign({ kind: "done", ok: true, sent: false }, read));
          syncLine.className = "note warn";
          syncLine.textContent = readText + skipped + t(sent.parts.length ? "sentPartial" : "sendToBhcFailed", { parts: sent.parts.join(t("sentPartsJoin")) });
        }
      } catch (error) {
        syncLine.hidden = false;
        syncLine.className = "note warn";
        syncLine.textContent = t("collectFailed", { message: error.message });
        say(Object.assign({ kind: "done", ok: false }, nothing, { reason: "error", detail: String((error && error.message) || error) }));
      } finally {
        walk = null;
        basket = readBasket(window.localStorage);
        refreshBasket();
        refreshGuidance();
      }
    }

    /**
     * The sync nobody pressed, once as HuskyCT is opened: if it is switched on, a few hours have
     * passed, and the student is signed in. It reads no page. It sends only to a BetterHuskyCT tab
     * this tab opened before and that is still there; otherwise the reading waits for a press.
     */
    function autoSyncOnOpen() {
      const state = readSyncState(window.localStorage);
      if (walk || !autoSyncDue(state, new Date()) || looksSignedOut()) return;
      if (!/^\/ultra(\/|$)/.test(window.location.pathname)) return;
      window.setTimeout(() => {
        if (walk) return;
        void runSync(findBhcTab(), true);
      }, 3000);
    }

    /**
     * BetterHuskyCT's Sync button asking for a sync. It is answered only if it comes from BetterHuskyCT's own
     * origin, by a window that can be answered; a sync already running, or a sign-in page, is said so.
     * What is read is sent back to the window that asked, so nothing has to be pressed here.
     */
    function answerSyncRequest(target, origin) {
      const reply = (message) => {
        try {
          target.postMessage(Object.assign({ protocol: SYNC_PROTOCOL }, message), origin);
        } catch {
          /* the window that asked is gone */
        }
      };
      if (walk) {
        reply({ kind: "ack", state: "busy" });
        return;
      }
      reply({ kind: "ack", state: "started" });
      if (looksSignedOut()) {
        reply({ kind: "done", ok: false, courses: 0, announcements: 0, gradeItems: 0, skipped: [], sent: false, reason: "signedout", detail: null });
        return;
      }
      void runSync(target, false, reply);
    }

    window.addEventListener("message", (event) => {
      if (event.origin !== bhcOrigin() || !event.source) return;
      const data = event.data;
      if (!data || data.protocol !== SYNC_PROTOCOL || data.kind !== "request") return;
      answerSyncRequest(event.source, event.origin);
    });

    // The same request, from a BetterHuskyCT tab this tab was not opened by, through the userscript manager.
    startBridgeOnHuskyct((target) => answerSyncRequest(target, bhcOrigin()));

    wrap.addEventListener("click", async (event) => {
      const button = event.target.closest("button.act");
      if (!button) return;

      const act = button.dataset.act;

      if (act === "collectall") {
        // The same button stops a walk in progress. It finishes the page it is
        // on rather than abandoning it mid-read.
        if (walk) {
          walk.stop = true;
          button.disabled = true;
          return;
        }

        walk = { stop: false, kind: "basket" };
        refreshBasket();
        status.className = "note";
        try {
          const report = await collectEverything({
            shouldStop: () => walk.stop,
            onProgress(progress) {
              status.textContent = collectProgressText(progress);
            },
          });
          // The gradebooks and files read along the way, shown on their own lines.
          if (report.grades) {
            grades = report.grades;
            gradesLine.hidden = false;
            const gradesCheck = problemsText(report.grades.problems);
            gradesLine.className = gradesCheck ? "note warn" : "note ok";
            gradesLine.textContent =
              (report.grades.stopped ? t("gradesStopped") + " " : "") +
              t("gradesFound", gradesSummary(report.grades)) +
              (gradesCheck ? " " + gradesCheck : "");
          }
          if (report.materials) {
            materialsLine.hidden = false;
            const materialsCheck = problemsText(report.materials.problems);
            materialsLine.className = materialsCheck ? "note warn" : "note ok";
            materialsLine.textContent =
              (report.materials.stopped ? t("materialsStopped") + " " : "") +
              t("materialsFound", materialsSummary(report.materials)) +
              (materialsCheck ? " " + materialsCheck : "");
          }

          const selfCheck = problemsText(report.problems);
          const collectedText =
            (report.stopped ? t("collectStopped") : t("collectedAll", { courses: report.collected })) +
            (report.skipped.length ? t("collectSkipped", { courses: report.skipped.join(", ") }) : "") +
            (selfCheck ? " " + selfCheck : "");
          status.className = selfCheck ? "note warn" : report.stopped ? "note" : "note ok";
          status.textContent = collectedText;

          // One press, all the way: what was read goes to BetterHuskyCT over
          // `postMessage` — deadlines and announcements, then the gradebooks,
          // then the files. Each is the same route its own button uses, so
          // nothing is pasted or confirmed on the other side. A stopped walk
          // is not sent; its own button sends what it has.
          // Looked for only now, with the HuskyCT tab still in front for the whole walk.
          const bhcTab = report.stopped ? null : openBhcTab();
          if (!report.stopped && bhcTab) {
            status.textContent = collectedText + t("sendingToBhc");
            const parts = [];
            let failed = false;
            const freshBasket = readBasket(window.localStorage);
            const toSend = basketSummary(freshBasket);
            if (toSend.deadlines > 0 || toSend.announcements > 0) {
              const result = await sendTasksToBhc(bhcTab, freshBasket, { connectTimeout: 15000 });
              if (result.connected && result.stored) parts.push(t("sentPartTasks", result));
              else failed = true;
            }
            if (report.grades && report.grades.courses.length) {
              const result = await sendGradesToBhc(bhcTab, report.grades, { connectTimeout: 15000 });
              if (result.connected && result.stored) parts.push(t("sentPartGrades", result));
              else failed = true;
            }
            if (report.materials && report.materials.courses.length) {
              const result = await sendMaterialsToBhc(bhcTab, report.materials, {
                connectTimeout: 15000,
                onProgress: (step) => {
                  status.textContent = collectedText + t("sendingMaterial", step);
                },
              });
              if (result.connected) {
                parts.push(t("sentPartFiles", { files: result.sent + result.skipped }));
                if (result.failed) failed = true;
              } else {
                failed = true;
              }
            }
            const sentList = parts.join(t("sentPartsJoin"));
            if (failed && parts.length === 0) {
              status.className = "note warn";
              status.textContent = collectedText + t("sendToBhcFailed", { button: t("sendDeadlines") });
            } else if (failed) {
              status.className = "note warn";
              status.textContent = collectedText + t("sentPartial", { parts: sentList });
            } else if (parts.length) {
              status.className = "note ok";
              status.textContent = collectedText + t("sentAll", { parts: sentList });
            }
          } else if (!report.stopped) {
            // The tab could not be opened, so nothing was sent: say how to send it.
            status.className = "note warn";
            status.textContent = collectedText + t("sendToBhcFailed", { button: t("sendDeadlines") });
          }
        } catch (error) {
          status.className = "note warn";
          status.textContent = t("collectFailed", { message: error.message });
        } finally {
          walk = null;
          button.disabled = false;
          basket = readBasket(window.localStorage);
          refreshBasket();
          refreshGuidance();
        }
        return;
      }

      if (act === "autosync") {
        syncState = Object.assign({}, syncState, { auto: !syncState.auto });
        writeSyncState(window.localStorage, syncState);
        refreshBasket();
        return;
      }

      if (act === "emptybasket") {
        basket = emptyBasket();
        writeBasket(window.localStorage, basket);
        refreshBasket();
        status.className = "note";
        status.textContent = t("basketCleared");
        return;
      }

      if (act === "todos") {
        // The page on screen goes in first, so pressing Send on a course's
        // Announcements page never leaves that course behind.
        captureTick();
        const summary = basketSummary(basket);

        if (summary.deadlines === 0 && summary.announcements === 0) {
          status.className = "note warn";
          status.textContent = t("basketNothing");
          hint.textContent = t("basketNothingHint");
          return;
        }

        button.disabled = true;
        status.className = "note";
        status.textContent = t("sendingTitle", {
          deadlines: summary.deadlines,
          announcements: summary.announcements
            ? t("sentWithAnnouncements", { count: summary.announcements })
            : "",
        });

        try {
          const built = await basketLink(basket);
          const link = built.link;
          const announcementClause = built.announcements
            ? t("sentWithAnnouncements", { count: built.announcements })
            : "";

          /**
           * Open the dashboard, and tell the truth about whether it opened.
           *
           * `window.open(url, "_blank", "noopener")` returns **null** even when it
           * succeeds, because `noopener` severs the reference as part of its job.
           * So testing the return value of a `noopener` call reports "blocked" on
           * every successful send — which is exactly what 0.14.0 shipped. Measured
           * in Chrome 152: `_blank` alone gives an object, `_blank` with
           * `"noopener"` gives null, and both open a window.
           *
           * The fix keeps the isolation and makes null mean what it should: call
           * without the flag, check the reference, then cut `opener` yourself.
           *
           * The window is named rather than `_blank`, so pressing Send again
           * reuses the dashboard tab this opened instead of stacking a new one
           * per press; the dashboard notices the new link in its address bar.
           */
          const opened = window.open(link, "betterhuskyct");
          if (opened) opened.opener = null;

          if (opened) {
            opened.focus();
            status.className = "note ok";
            status.textContent = t("openedTitle", {
              deadlines: built.deadlines,
              announcements: announcementClause,
            });
            hint.textContent =
              t("openedHint") + (built.leftOut ? t("leftOut", { count: built.leftOut }) : "");
          } else {
            // The link itself, to click: the browser that blocked the tab
            // lets a click the student makes through.
            status.className = "note warn";
            status.textContent = t("popupBlocked") + " ";
            const fallback = document.createElement("a");
            fallback.href = link;
            fallback.target = "betterhuskyct";
            fallback.rel = "noopener";
            fallback.textContent = "BetterHuskyCT →";
            status.appendChild(fallback);
            hint.textContent = t("popupBlockedHint");
          }
        } catch (error) {
          status.className = "note warn";
          status.textContent = t("linkFailed", { message: error.message });
        } finally {
          button.disabled = false;
        }
        return;
      }

    });
  }

  // The pieces worth exercising outside a browser. Attached for the test suite;
  // harmless in the page, and it is how the merge is checked against real
  // calendar text rather than trusted because it looks right.
  if (typeof window !== "undefined") {
    window.__huskyctHelper = {
      currentCourseId,
      textOf,
      courseCodeFromDisplay,
      courseTitleFromDisplay,
      postedFromText,
      collectAnnouncements,
      collectCourse,
      announcementsToCandidates,
      BASKET_KEY,
      emptyBasket,
      readBasket,
      writeBasket,
      courseLinksOnPage,
      readColors,
      cardColorFromIndex,
      colorsByCode,
      COLORS_KEY,
      rememberCourses,
      rememberAnnouncements,
      rememberTodos,
      rememberDueDates,
      deadlineRecords,
      collectDueDates,
      readDueDatesApi,
      captureIntoBasket,
      basketSummary,
      routeTo,
      courseCardsOnPage,
      coursesToCollect,
      termCodeFor,
      readAnnouncementsApi,
      readUserId,
      readSyncState,
      writeSyncState,
      autoSyncDue,
      syncLight,
      deliverSync,
      findBhcTab,
      readCoursesApi,
      courseCardFromApi,
      termOfCourse,
      readGradesApi,
      gradeItemFromApi,
      postedText,
      htmlToText,
      collectEverything,
      findCourses,
      unwrapLink,
      readMaterialsApi,
      collectMaterials,
      materialsSummary,
      collectGrades,
      gradesSummary,
      gradesSnapshotFrom,
      GRADES_PROTOCOL,
      sendGradesToBhc,
      openBhcTab,
      problemsText,
      termLabel,
      safeName,
      nameFromStoreUrl,
      MATERIALS_PROTOCOL,
      materialsIndexFrom,
      sendMaterialsToBhc,
      basketContents,
      basketLink,
      TASKS_PROTOCOL,
      sendTasksToBhc,
      todoFromLabel,
      dueDateFromText,
      collectTodos,
      todosToRecords,
      guidanceFor,
      taskFromRecord,
      syncPayload,
      huskypilotLink,
      VERSION,
      STRINGS,
      LOCALE_KEY,
      detectLocale,
      setLocale,
      getLocale: () => locale,
      t,
      otherLocale,
      panelMarkup,
    };
  }

  if (typeof document !== "undefined" && window.location.origin === bhcOrigin()) {
    startBridgeOnBhc();
  } else if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountPanel, { once: true });
    } else {
      mountPanel();
    }
  }
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : window);
