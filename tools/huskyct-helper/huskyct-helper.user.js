// ==UserScript==
// @name         HuskyCT Helper
// @namespace    https://github.com/NoGod3524/betterhuskyct
// @version      1.5.1
// @description  Collects your HuskyCT deadlines, announcements and course files, and sends them to BetterHuskyCT. Nothing leaves your browser.
// @author       NoGod3524
// @match        https://lms.uconn.edu/*
// @match        https://huskyct.uconn.edu/*
// @updateURL    https://raw.githubusercontent.com/NoGod3524/betterhuskyct/main/tools/huskyct-helper/huskyct-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/NoGod3524/betterhuskyct/main/tools/huskyct-helper/huskyct-helper.user.js
// @run-at       document-start
// @grant        none
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

(function () {
  "use strict";

  // Shown in the panel header and in the PRODID of every file this writes, so
  // it has to agree with `@version` in the metadata block above — otherwise the
  // panel reports a version the browser never installed. A test enforces it.
  const VERSION = "1.5.1";
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
      sentPartial: " Only part of it reached BetterHuskyCT ({parts}). Press the Send buttons below for the rest.",
      collectingDueDates: "Reading the term's due dates from the Calendar…",
      collectMaterials: "Collect course materials",
      materialsReused: " {count} document(s) came from last time's reading.",
      pickFolderHint:
        "Pick a folder for the files. Browsers do not allow the Desktop itself, so make a folder on it first (“New folder”, e.g. HuskyCT) and pick that.",
      selfCheck: "Self-check: {problems}",
      problemCoursesPage: "the Courses page did not show its course list — HuskyCT may have changed.",
      problemNoCourses: "no current-term course was found on the Courses page.",
      problemDueDatesView:
        "the Calendar's Due dates view did not open — HuskyCT may have changed, so only this week's to-do list was read.",
      problemOutlines: "these courses' content did not open: {courses}.",
      problemDocuments: "{count} document(s) did not open.",
      problemFileAddress: "{count} file(s) had no download address — HuskyCT may have changed.",
      problemNoContent: "no course showed any content — HuskyCT may have changed.",
      materialsCourses: "Finding your courses…",
      materialsOutline: "Reading {course}'s content ({index} of {total})…",
      materialsDocument: "Opening {course}'s documents: {document} of {documents}…",
      materialsFound:
        "Found {files} file(s), {videos} video(s), {links} link(s) and {tools} tool(s) in {courses} course(s).",
      materialsStopped: "Stopped. What was found so far is below.",
      materialsFailed: "Collecting materials stopped with an error: {message}",
      collectGrades: "Collect grades",
      gradesCourse: "Reading {course}'s grades ({index} of {total})…",
      gradesFound: "Found {items} gradebook item(s), {scored} with a score, in {courses} course(s).",
      gradesStopped: "Stopped. What was found so far is below.",
      gradesFailed: "Collecting grades stopped with an error: {message}",
      problemGrades: "these courses' grades did not open completely: {courses}.",
      problemBackground: "This tab was in the background while it read, and a tab in the background does not load its pages. Keep this tab in front until it is done.",
      problemSignedOut: "HuskyCT asked you to sign in again part-way through. Sign in, then press Collect grades once more.",
      sendGrades: "Send grades to BetterHuskyCT ({count} item(s))",
      gradesSent: "In BetterHuskyCT: grades for {courses} course(s), {items} item(s).",
      gradesNotStored: "BetterHuskyCT received the grades but could not store them.",
      gradesNoAnswer: "BetterHuskyCT did not answer. Leave its tab open and press this again.",
      saveFiles: "Save {count} file(s) to a folder…",
      saveFilesZip: "Download {count} file(s) as a ZIP",
      saveLinks: "Save the links and videos",
      sendMaterials: "Send to BetterHuskyCT ({count} file(s))",
      connectingBhc: "Opening BetterHuskyCT…",
      sendingMaterial: "Sending {index} of {total}: {name}",
      materialsSent: "In BetterHuskyCT: {sent} new file(s) sent, {skipped} already there, {failed} failed.",
      bhcNoAnswer:
        "BetterHuskyCT did not answer. Leave its tab open and press this again — or save the files to a folder and import them on its Materials page.",
      savingFile: "Saving {index} of {total}: {name}",
      filesSaved: "Saved {saved} file(s) in “{folder}”. {skipped} were already there; {failed} failed.",
      zipSaved: "Downloaded {name} with {saved} file(s). {failed} failed.",
      linksTitle: "Links and videos",
      linksVideos: "Videos",
      linksLinks: "Links",
      linksTools: "Tools",
      linksFileName: "links and videos.html",
      collectingCourse: "Reading {course} ({index} of {total})…",
      collectedAll: "Done: {courses} course(s) read.",
      collectSkipped: " Could not open: {courses}.",
      collectStopped: "Stopped. What was read so far is in the basket.",
      collectFailed: "Collecting stopped with an error: {message}",
      sendingToBhc: " Sending it to BetterHuskyCT…",
      sentToBhc: " Sent to BetterHuskyCT: {deadlines} deadline(s), {announcements} announcement(s).",
      sendToBhcFailed: " Could not reach BetterHuskyCT on its own. Press the Send buttons below once.",
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
      sentPartial: " 只有一部分发到了 BetterHuskyCT（{parts}）。剩下的按下面的发送按钮再发。",
      collectingDueDates: "正在从日历读取整个学期的截止日期……",
      collectMaterials: "收集课件",
      materialsReused: "其中 {count} 个文档用的是上次读取的结果。",
      pickFolderHint: "选一个保存文件的文件夹。浏览器不允许直接选桌面本身，请先在桌面上点「新建文件夹」（比如 HuskyCT），再选它。",
      selfCheck: "自检：{problems}",
      problemCoursesPage: "Courses 页没有显示课程列表——HuskyCT 可能改版了。",
      problemNoCourses: "Courses 页上没有找到本学期的课程。",
      problemDueDatesView: "打不开日历的 Due dates 视图——HuskyCT 可能改版了，所以只读到了本周的待办。",
      problemOutlines: "这些课的内容页打不开：{courses}。",
      problemDocuments: "有 {count} 个文档打不开。",
      problemFileAddress: "有 {count} 个文件找不到下载地址——HuskyCT 可能改版了。",
      problemNoContent: "所有课程的内容页都是空的——HuskyCT 可能改版了。",
      materialsCourses: "正在查找课程……",
      materialsOutline: "正在读取 {course} 的课程内容（{index}/{total}）……",
      materialsDocument: "正在打开 {course} 的文档（{document}/{documents}）……",
      materialsFound: "在 {courses} 门课里找到 {files} 个文件、{videos} 个视频、{links} 个链接、{tools} 个工具。",
      materialsStopped: "已停止。下面是目前找到的内容。",
      materialsFailed: "收集课件时出错停止了：{message}",
      collectGrades: "收集成绩",
      gradesCourse: "正在读取 {course} 的成绩（{index}/{total}）……",
      gradesFound: "在 {courses} 门课里找到 {items} 项成绩册条目，其中 {scored} 项有分数。",
      gradesStopped: "已停止。下面是目前读到的。",
      gradesFailed: "收集成绩时出错停止了：{message}",
      problemGrades: "这些课的成绩没能完整读取：{courses}。",
      problemBackground: "读取时这个标签页在后台，后台的标签页不会加载页面。读取完成前请一直把它留在前台。",
      problemSignedOut: "读取到一半时 HuskyCT 让你重新登录了。请登录后再按一次「收集成绩」。",
      sendGrades: "把成绩发送到 BetterHuskyCT（{count} 项）",
      gradesSent: "BetterHuskyCT 里：{courses} 门课、{items} 项成绩。",
      gradesNotStored: "BetterHuskyCT 收到了成绩，但没能保存。",
      gradesNoAnswer: "BetterHuskyCT 没有响应。让它的标签页开着，再按一次。",
      saveFiles: "把 {count} 个文件保存到文件夹……",
      saveFilesZip: "把 {count} 个文件打包成 ZIP 下载",
      saveLinks: "保存链接与视频清单",
      sendMaterials: "发送到 BetterHuskyCT（{count} 个文件）",
      connectingBhc: "正在打开 BetterHuskyCT……",
      sendingMaterial: "正在发送 {index}/{total}：{name}",
      materialsSent: "BetterHuskyCT 里：新发送 {sent} 个文件，{skipped} 个已存在，{failed} 个失败。",
      bhcNoAnswer: "BetterHuskyCT 没有响应。让它的标签页开着，再按一次；或者先保存到文件夹，再到它的「课件」页导入。",
      savingFile: "正在保存 {index}/{total}：{name}",
      filesSaved: "已保存 {saved} 个文件到「{folder}」，{skipped} 个已存在跳过，{failed} 个失败。",
      zipSaved: "已下载 {name}，包含 {saved} 个文件，{failed} 个失败。",
      linksTitle: "链接与视频",
      linksVideos: "视频",
      linksLinks: "链接",
      linksTools: "工具",
      linksFileName: "链接与视频.html",
      collectingCourse: "正在读取 {course}（{index}/{total}）……",
      collectedAll: "完成：读取了 {courses} 门课。",
      collectSkipped: "打不开的课程：{courses}。",
      collectStopped: "已停止。已经读到的内容都在篮子里。",
      collectFailed: "收集时出错停止了：{message}",
      sendingToBhc: "正在发给 BetterHuskyCT……",
      sentToBhc: "已发给 BetterHuskyCT：{deadlines} 条 deadline、{announcements} 条公告。",
      sendToBhcFailed: "没能自动连上 BetterHuskyCT，按一下下面的发送按钮。",
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

  // ---------------------------------------------------------------- utilities

  function download(filename, text, type) {
    const isBlob = typeof Blob !== "undefined" && text instanceof Blob;
    const blob = isBlob ? text : new Blob([text], { type: type || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // A large file may still be streaming out of the blob when the click
    // returns, so a blob handed in whole is released a little later.
    if (isBlob) setTimeout(() => URL.revokeObjectURL(url), 30000);
    else URL.revokeObjectURL(url);
  }





  // ------------------------------------------------- reading the course page

  /**
   * Everything in this section reads what the browser has already rendered.
   *
   * Reading HuskyCT's own API is not an option. Measured on 2026-09-19: a
   * request the page itself makes to /learn/api/v1/users/me returns 200, an
   * identical-looking one from a script returns 403 with an S3-style
   * AccessDenied body, and adding any header of our own resets the connection.
   * A path that cannot exist returns the same 403 as a real one, so the edge in
   * front of HuskyCT admits the application's own calls and refuses everything
   * else — regardless of the path.
   *
   * Trying to forge those calls is both futile and the one part of this script
   * that would look like scraping in a log. The rendered page has what is
   * needed, and reading it sends no request at all: announcements, the content
   * outline and the course's name are all already on screen.
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

  function announcementsPathFor(courseId) {
    return "/ultra/courses/" + courseId + "/announcements";
  }

  // --- collecting everything in one press -------------------------------------

  /**
   * The basket used to fill only as the student opened each course's
   * Announcements tab by hand, which is the chore it was meant to remove.
   * "Collect everything" walks HuskyCT itself instead: the Courses page for the
   * to-do list and the full course list, then each course's Announcements page,
   * then back to where the student was.
   *
   * It still reads only rendered pages. Two shortcuts were measured and ruled
   * out on 2026-09-27: HuskyCT's API refuses scripts (403 `AccessDenied`), and
   * its pages refuse to load in a frame, so a hidden iframe gets nothing. What
   * remains is moving the tab through HuskyCT the way its own links do, one page
   * at a time.
   */

  const VIEW_ALL_COURSES = '[data-analytics-id="base.courses.recentCoursesView.viewAllButton"]';
  const DUE_DATES_VIEW = '#bb-calendar1-deadline, [analytics-id="components.directives.calendar.viewSwitch.deadline"]';

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
   * Scrolls the "View All" list until every card has rendered.
   *
   * Measured on the live page: every card is there from the start as an
   * `article` with an empty `data-course-id`, filled in once it has been
   * scrolled into view, and never emptied again. So the list is done when no
   * card is still empty — not when the count has held still, which stopped at
   * four or five of six. The list scrolls inside its own panel, one screen at a
   * time. A card only renders on a scroll, so the first one can be passed over;
   * reaching the bottom with a card still empty goes back to the top for another
   * pass, twice at most, in case a card never fills in at all.
   */
  async function loadEveryCourseCard(opts) {
    const seen = new Map();
    const started = Date.now();
    let passes = 0;
    let seenAtLastPass = -1;
    while (Date.now() - started < opts.pageTimeout) {
      for (const card of courseCardsOnPage(document)) seen.set(card.id, card);
      const slots = [...document.querySelectorAll("article[data-course-id]")];
      const pending = slots.filter((slot) => !slot.getAttribute("data-course-id")).length;
      if (slots.length > 0 && pending === 0) break;

      // Only real scrolling panels, and only real movement: the live page has
      // small inner boxes that creep a pixel per scroll and never "finish".
      const scrollers = [...document.querySelectorAll("main, main *, .panel-wrap, .hide-in-background")].filter(
        (element) => element.clientHeight >= 150 && element.scrollHeight > element.clientHeight + 50,
      );
      let moved = false;
      for (const element of scrollers) {
        const before = element.scrollTop;
        element.scrollTop = Math.min(before + element.clientHeight * 0.8, element.scrollHeight);
        moved = moved || Math.abs(element.scrollTop - before) >= 10;
      }
      if (!moved && slots.length > 0) {
        // On a screen tall enough that nothing scrolls, there are no passes to
        // count: give the cards a few seconds to render on their own before
        // settling for what is there.
        const waited = Date.now() - started >= opts.every * 20;
        const stalled = seen.size === seenAtLastPass;
        seenAtLastPass = seen.size;
        if (scrollers.length === 0) {
          if (waited && stalled) break;
        } else {
          if (passes >= 2 || (waited && stalled)) break;
          passes++;
          for (const element of scrollers) element.scrollTop = 0;
        }
      }
      await pause(opts.every * 2);
    }
    return [...seen.values()];
  }

  /**
   * Opens one course's Announcements page and reads it once it is really that
   * course's.
   *
   * Moving between two courses can leave the previous course's page on screen
   * for a moment under the new address, and reading it would file one course's
   * announcements under another. So the page counts only once its heading names
   * this course, none of its rows was there before the move, and the row count
   * has held still. An empty list counts only after it has stayed empty for
   * `emptySettle`. Returns null if the page never settles — no access, or
   * HuskyCT sent the student somewhere else.
   */
  async function readAnnouncementsOf(courseId, code, opts) {
    const staleRows = new Set(document.querySelectorAll(".announcement-item-row"));
    const staleList = document.querySelector(".announcement-list");
    const path = announcementsPathFor(courseId);
    routeTo(path);

    const started = Date.now();
    let lastCount = -1;
    let steady = 0;
    while (Date.now() - started < opts.pageTimeout) {
      await pause(opts.every);
      if (window.location.pathname.indexOf(path) !== 0) continue;
      const list = document.querySelector(".announcement-list");
      if (!list) continue;
      const heading = collectCourse(document).code;
      if (code && heading && heading !== code) continue;
      const rows = [...document.querySelectorAll(".announcement-item-row")];
      if (rows.some((row) => staleRows.has(row))) continue;

      steady = rows.length === lastCount ? steady + 1 : 0;
      lastCount = rows.length;
      if (rows.length > 0 && steady >= 2) return collectAnnouncements(document);
      // The same empty list element as the last course's gets twice as long,
      // since it may not have been re-rendered yet.
      const settle = list === staleList ? opts.emptySettle * 2 : opts.emptySettle;
      if (rows.length === 0 && Date.now() - started >= settle) return [];
    }
    return null;
  }

  /**
   * Opens the Calendar's "Due dates" view and scrolls it to the end of the term.
   *
   * It shows about three weeks at first and loads the rest as it scrolls —
   * 20 items, then 29, on 2026-09-27 — so it is scrolled until the count holds.
   * A term with nothing due shows no cards at all, which simply reads as none.
   */
  async function readDueDates(opts) {
    routeTo("/ultra/calendar");
    const button = await waitFor(() => document.querySelector(DUE_DATES_VIEW), opts.every, opts.pageTimeout);
    // Null, not an empty list: a term with nothing due is fine, a view that is
    // not there is HuskyCT having changed.
    if (!button) return null;
    button.click();
    await waitFor(() => document.querySelector(".element-card.due-item"), opts.every, opts.emptySettle);

    let lastCount = -1;
    let steady = 0;
    const started = Date.now();
    while (Date.now() - started < opts.pageTimeout) {
      const items = document.querySelectorAll(".element-card.due-item");
      steady = items.length === lastCount ? steady + 1 : 0;
      lastCount = items.length;
      if (steady >= 3) break;
      const last = items[items.length - 1];
      if (last && typeof last.scrollIntoView === "function") last.scrollIntoView({ block: "end" });
      for (const element of document.querySelectorAll("main, main *")) {
        if (element.clientHeight >= 150 && element.scrollHeight > element.clientHeight + 50) {
          element.scrollTop = element.scrollHeight;
        }
      }
      await pause(opts.every * 2);
    }
    return collectDueDates(document);
  }

  /**
   * The Courses page, read for the courses to visit.
   *
   * It has two layouts. On a wide screen it lists every course as a card
   * straight away; on a narrow one it shows the few opened recently, as links,
   * with a "View All" button for the rest. Measured on 2026-09-27 at 1440 and
   * 398 pixels wide. `onCoursesPage` runs while the page is up, before "View
   * All" replaces it, for whatever else the caller wants from it.
   */
  async function findCourses(opts, onCoursesPage) {
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
    if (onCoursesPage) await onCoursesPage(recent);

    const viewAll = document.querySelector(VIEW_ALL_COURSES);
    if (viewAll) viewAll.click();
    let cards = [];
    if (viewAll || document.querySelector("article[data-course-id]")) {
      cards = await loadEveryCourseCard(opts);
    }
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
  /**
   * The timing a walk is given from Collect everything's own: only the keys
   * that were set, so each walk keeps its own defaults for everything else.
   */
  function timingOf(opts, keys) {
    const timing = {};
    for (const key of keys) {
      if (opts[key] !== undefined) timing[key] = opts[key];
    }
    return timing;
  }

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
      // 1 and 2. The Courses page: the to-do list while it is up, then every
      // course, from the cards on screen or behind "View All".
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

      // 3. The Calendar's due dates: the whole term, not just the week the
      // to-do list covers.
      if (!opts.shouldStop()) {
        opts.onProgress({ step: "duedates" });
        const dueDates = await readDueDates(opts);
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

        const rows = await readAnnouncementsOf(course.id, course.code, opts);
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

      // 5 and 6. Each course's gradebook, then its files: the same walks the
      // Grades and Materials buttons make, so one press brings in everything.
      // A walk that breaks is reported, and the other still runs.
      if (!opts.shouldStop()) {
        try {
          report.grades = await collectGrades(
            Object.assign(timingOf(opts, ["every", "pageTimeout", "gap", "retryPause", "settle"]), {
              shouldStop: opts.shouldStop,
              onProgress: (progress) => opts.onProgress(Object.assign({ walk: "grades" }, progress)),
            }),
          );
        } catch {
          report.problems.push({ key: "problemGradesWalk" });
        }
      }
      if (!opts.shouldStop()) {
        try {
          report.materials = await collectMaterials(
            Object.assign(
              timingOf(opts, ["every", "pageTimeout", "outlineTimeout", "documentTimeout", "expandPause", "documentSettle"]),
              {
                shouldStop: opts.shouldStop,
                onProgress: (progress) => opts.onProgress(Object.assign({ walk: "materials" }, progress)),
              },
            ),
          );
        } catch {
          report.problems.push({ key: "problemMaterialsWalk" });
        }
      }
      if ((report.grades && report.grades.stopped) || (report.materials && report.materials.stopped)) {
        report.stopped = true;
      }
      // A tab in the back does not draw its pages, so the walks read nothing. Say so,
      // rather than only listing the courses that failed.
      const fellShort = [report.grades, report.materials].some((walked) => walked && walked.courses.some((course) => course.skipped));
      if (fellShort && document.hidden) report.problems.push({ key: "problemBackground" });
    } finally {
      // 5. Back to the page the student pressed the button on.
      routeTo(returnTo);
    }
    return report;
  }

  // --- course materials ---------------------------------------------------------

  /**
   * Every file, document, video, link and tool in each course's content, and
   * the files saved into a folder the student picks.
   *
   * Measured on 2026-09-27 across six courses:
   *
   * - A course's content page lists items as links whose accessibility label is
   *   "Type, Title" — "PDF, Section 5.1 Problem Solving Tips.pdf". The type is
   *   the file's kind, not the item's: a CSV reads "Text Document". What an item
   *   is comes from where it links. `/file/` is a file, `/document/` a page that
   *   holds attachments and embedded videos, `/assessment/` and `/discussion/`
   *   are work to do rather than material, `#` is a tool launched from HuskyCT
   *   (LTI links, Cengage homework), and anything else is a link out.
   * - A file's row carries its real address, `/bbcswebdav/...`, on an anchor
   *   keyed by the item's id; it redirects to Blackboard's file store, which
   *   answers any origin. So the file can be read with an ordinary request that
   *   sends HuskyCT's cookie to HuskyCT only. With the cookie sent on to the
   *   store as well, the store refuses — that is the one way to get it wrong.
   * - Folders and learning modules load their contents when opened, and each
   *   list ends in a "Load more" button that is disabled once nothing is left.
   * - A document's attachments carry an id that starts with the document's own,
   *   so a page still showing the previous document cannot be mistaken for it.
   */

  const OUTLINE_ITEMS = 'a[aria-label][data-analytics-id^="content.item"], a[aria-label][data-analytics-id^="course.link.item"]';
  const OUTLINE_TOGGLES =
    'button[aria-expanded="false"][id^="folder-title-"], button[aria-expanded="false"][id^="learning-module-title-"]';
  const LOAD_MORE =
    'button[data-analytics-id="components.directives.content.content-outline.infiniteScroll.content.loadMoreButton.label.plural"]';
  const ACTIVITY_TYPES = /^(assignment|quiz|test|practice test|homework|discussion|journal|survey|assessment|exam)$/i;
  const VIDEO_HOSTS = /(youtube\.com|youtu\.be|vimeo\.com|vidyard\.com|panopto|kaltura|mediaspace|zoom\.us\/rec)/i;
  const TERM_SEASONS = { 3: "Spring", 5: "Summer", 8: "Fall" };

  /** "PDF, Section 5.1 Problem Solving Tips.pdf" -> { type: "PDF", title: "Section 5.1 …" } */
  function splitItemLabel(label) {
    const text = String(label || "").trim();
    const comma = text.indexOf(", ");
    return comma === -1
      ? { type: "", title: text }
      : { type: text.slice(0, comma).trim(), title: text.slice(comma + 2).trim() };
  }

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

  /** The folders an outline item sits in, outermost first. */
  function outlinePathOf(element) {
    const owner = element.ownerDocument || document;
    const path = [];
    for (let node = element.parentElement; node; node = node.parentElement) {
      const match = /^(folder|learning-module)-contents-(.+)$/.exec(node.id || "");
      if (!match) continue;
      const title = owner.getElementById(match[1] + "-title-" + match[2]);
      if (title) path.unshift(textOf(title));
    }
    return path;
  }

  /**
   * The address that opens an LTI tool straight away, or null for anything else.
   *
   * Measured on 2026-09-28: an LTI link's anchor is `href="#"`, but the row
   * around it carries the item's id as `data-content-id`, and pressing it makes
   * HuskyCT open Blackboard's own launch address for that id in a new window —
   * `/webapps/blackboard/execute/blti/launchLink?course_id=…&content_id=…&from_ultra=true`.
   * The same address opened later, in any tab where the student is signed in,
   * launches the tool without going through the course page.
   */
  function toolLaunchUrl(anchor, type, courseId) {
    if (!/\bLTI\b/i.test(type) || !/^_\d+_\d+$/.test(courseId)) return null;
    const row = anchor.closest("[data-content-id]");
    const id = row && row.getAttribute("data-content-id");
    if (!id || !/^_\d+_\d+$/.test(id)) return null;
    return (
      window.location.origin +
      "/webapps/blackboard/execute/blti/launchLink?course_id=" +
      courseId +
      "&content_id=" +
      id +
      "&from_ultra=true"
    );
  }

  /**
   * An LTI link that plays a Kaltura video. Measured on 2026-09-28: the anchor
   * names the tool it launches in `data-launch-handle` — "KalturaBSE" for a
   * video embedded from Kaltura (MATH 1070Q's "Problem Solving Tips"), whose
   * launch opens the player — so it is listed with the videos, not the tools.
   */
  function isKalturaLaunch(anchor) {
    return /^kaltura/i.test(anchor.getAttribute("data-launch-handle") || "");
  }

  /**
   * Sorts a course's opened content page into files, documents to open, links,
   * tools and work. Only items linking into this course count as its files and
   * documents, so a page still showing another course adds nothing of it.
   */
  function classifyOutline(root, courseId) {
    const scope = root || document;
    const found = { files: [], documents: [], links: [], tools: [], activities: 0, unaddressed: 0 };
    const addresses = new Map();
    for (const anchor of scope.querySelectorAll("[data-ally-content-id][data-ally-file-preview-url]")) {
      addresses.set(anchor.getAttribute("data-ally-content-id"), anchor.getAttribute("data-ally-file-preview-url"));
    }

    const own = "/ultra/courses/" + courseId + "/";
    const seen = new Set();
    for (const anchor of scope.querySelectorAll(OUTLINE_ITEMS)) {
      const href = anchor.getAttribute("href") || "";
      const { type, title } = splitItemLabel(anchor.getAttribute("aria-label"));
      if (!title) continue;
      const path = outlinePathOf(anchor);
      const key = href + "|" + title + "|" + path.join("/");
      if (seen.has(key)) continue;
      seen.add(key);

      const file = /\/file\/(_\d+_\d+)/.exec(href);
      const doc = /\/document\/(_\d+_\d+)/.exec(href);
      if (file) {
        if (href.indexOf(own) === -1) continue;
        const url = addresses.get(file[1]);
        // A file whose row carries no address is how a change to that hidden
        // anchor would show up: counted, so the panel can say so.
        if (url) found.files.push({ path, title, url });
        else found.unaddressed += 1;
        continue;
      }
      if (doc) {
        if (href.indexOf(own) === -1) continue;
        const address = new URL(href, window.location.origin);
        found.documents.push({ path, title, id: doc[1], route: address.pathname + address.search });
        continue;
      }
      if (ACTIVITY_TYPES.test(type) || /\/(assessment|discussion)\//.test(href)) {
        found.activities += 1;
        continue;
      }
      if (/^https?:/i.test(href) && !/lms\.uconn\.edu\/ultra\//i.test(href)) {
        const url = unwrapLink(href);
        found.links.push({ path, title, url, kind: isVideoLink(url) ? "video" : "link" });
        continue;
      }
      const tool = { path, title, type };
      const url = toolLaunchUrl(anchor, type, courseId);
      if (url && isKalturaLaunch(anchor)) {
        found.links.push({ path, title, url, kind: "video" });
        continue;
      }
      if (url) tool.url = url;
      found.tools.push(tool);
    }
    return found;
  }

  /** Opens every folder and learning module, and presses every live "Load more". */
  async function expandOutline(opts) {
    const started = Date.now();
    while (Date.now() - started < opts.outlineTimeout) {
      const closed = [...document.querySelectorAll(OUTLINE_TOGGLES)];
      const more = [...document.querySelectorAll(LOAD_MORE)].filter((button) => !button.disabled);
      if (closed.length === 0 && more.length === 0) return true;
      for (const button of closed) button.click();
      for (const button of more) button.click();
      await pause(opts.expandPause);
    }
    return false;
  }

  /** A course's content page, opened fully and sorted. Null if it never loaded. */
  async function readOutlineOf(courseId, code, opts) {
    const stale = new Set(document.querySelectorAll(OUTLINE_ITEMS + ", " + LOAD_MORE));
    const path = "/ultra/courses/" + courseId + "/outline";
    routeTo(path);
    const ready = await waitFor(
      () => {
        if (window.location.pathname.indexOf(path) !== 0) return false;
        const heading = collectCourse(document).code;
        if (code && heading && heading !== code) return false;
        return [...document.querySelectorAll(OUTLINE_ITEMS + ", " + LOAD_MORE)].some((node) => !stale.has(node));
      },
      opts.every,
      opts.pageTimeout,
    );
    if (!ready) return null;
    await expandOutline(opts);
    return classifyOutline(document, courseId);
  }

  /**
   * One document's attachments, embedded videos and links. Null if the page
   * never showed.
   */
  async function readDocument(documentItem, opts) {
    const staleRoots = new Set(document.querySelectorAll(".bbml-editor-parent"));
    routeTo(documentItem.route);
    const root = await waitFor(
      () => {
        if (window.location.pathname.indexOf("/document/" + documentItem.id) === -1) return null;
        return [...document.querySelectorAll(".bbml-editor-parent")].find((node) => !staleRoots.has(node)) || null;
      },
      opts.every,
      opts.documentTimeout,
    );
    if (!root) return null;
    // Measured on 2026-09-27 across six documents: attachments, videos and
    // links were all there the moment the page appeared. So rather than a fixed
    // second's wait, the page is read once it has held still for one short
    // look — which a slower page simply takes longer to pass.
    const signature = () =>
      [
        root.querySelectorAll("[data-ally-file-preview-url]").length,
        root.querySelectorAll('[data-bbtype="video"], iframe[src]').length,
        root.querySelectorAll("a[href]").length,
        root.textContent.length,
      ].join(",");
    const settleBy = Date.now() + opts.documentTimeout;
    for (let last = signature(); Date.now() < settleBy; ) {
      await pause(opts.documentSettle);
      const now = signature();
      if (now === last) break;
      last = now;
    }

    const files = [];
    for (const anchor of root.querySelectorAll("[data-ally-file-preview-url]")) {
      if (String(anchor.getAttribute("data-ally-content-id") || "").indexOf(documentItem.id) !== 0) continue;
      const region = (anchor.closest && anchor.closest('[role="region"]')) || anchor.parentElement;
      const name =
        textOf(region && region.querySelector('[role="button"] span')) ||
        textOf(region && region.querySelector("span")) ||
        documentItem.title;
      files.push({ title: name, url: anchor.getAttribute("data-ally-file-preview-url") });
    }

    const links = [];
    const seen = new Set();
    const addLink = (href, title) => {
      if (!/^https?:/i.test(String(href || "")) || /lms\.uconn\.edu\/(ultra|bbcswebdav)/i.test(href)) return;
      const url = unwrapLink(href);
      if (seen.has(url)) return;
      seen.add(url);
      links.push({ title: title || documentItem.title, url, kind: isVideoLink(url) ? "video" : "link" });
    };
    for (const video of root.querySelectorAll('[data-bbtype="video"]')) {
      try {
        addLink(JSON.parse(video.getAttribute("data-bbfile") || "{}").src, documentItem.title);
      } catch {
        /* an embed whose description does not parse is left out */
      }
    }
    for (const frame of root.querySelectorAll("iframe[src]")) addLink(frame.getAttribute("src"), documentItem.title);
    for (const anchor of root.querySelectorAll("a[href]")) addLink(anchor.getAttribute("href"), textOf(anchor));
    return { files, links };
  }

  /** `1268` -> "Fall 2026". */
  function termLabel(code) {
    const value = Number(code);
    const season = TERM_SEASONS[value % 10];
    return season ? season + " " + (2000 + Math.floor((value % 1000) / 10)) : null;
  }

  /**
   * What each document held, kept for a week.
   *
   * Opening documents is most of a materials walk — MATH 1070Q alone has 40 —
   * and a document rarely changes once posted. So a document opened in the
   * last week is not opened again: its attachments and links come from here.
   * Anything new is opened as usual, and after a week every document is read
   * afresh, so a late-added attachment is picked up within days.
   */
  const DOCUMENTS_KEY = "huskypilot.helper.documents.v1";
  const DOCUMENTS_FRESH_DAYS = 7;
  const DOCUMENTS_KEEP_DAYS = 60;

  function readDocumentCache(storage) {
    try {
      const parsed = JSON.parse((storage && storage.getItem(DOCUMENTS_KEY)) || "null");
      return parsed && parsed.version === 1 && parsed.documents && typeof parsed.documents === "object"
        ? parsed
        : { version: 1, documents: {} };
    } catch {
      return { version: 1, documents: {} };
    }
  }

  function writeDocumentCache(storage, cache, now) {
    const oldest = now.getTime() - DOCUMENTS_KEEP_DAYS * 86400000;
    for (const [key, entry] of Object.entries(cache.documents)) {
      if (!entry || Date.parse(entry.at) < oldest) delete cache.documents[key];
    }
    try {
      storage.setItem(DOCUMENTS_KEY, JSON.stringify(cache));
    } catch {
      /* a full or blocked storage only means the next walk opens everything */
    }
  }

  function freshDocument(cache, key, now) {
    const entry = cache.documents[key];
    if (!entry || !Array.isArray(entry.files) || !Array.isArray(entry.links)) return null;
    return now.getTime() - Date.parse(entry.at) < DOCUMENTS_FRESH_DAYS * 86400000 ? entry : null;
  }

  /**
   * The walk for materials: every course's content, opened fully, and every
   * document in it. Nothing is downloaded here; this only lists.
   */
  async function collectMaterials(options) {
    const opts = Object.assign(
      {
        every: 300,
        pageTimeout: 15000,
        outlineTimeout: 30000,
        expandPause: 1200,
        documentTimeout: 8000,
        documentSettle: 150,
        gap: 150,
        useCache: true,
        onProgress() {},
        shouldStop: () => false,
      },
      options,
    );
    const returnTo = window.location.pathname + window.location.search;
    const storage = window.localStorage;
    const cache = opts.useCache ? readDocumentCache(storage) : { version: 1, documents: {} };
    const manifest = { term: null, courses: [], stopped: false, reused: 0, problems: [] };
    let documentsFailed = 0;
    let unaddressed = 0;

    try {
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
        const where = { course, index: index + 1, total: queue.length };
        opts.onProgress({ step: "outline", ...where });

        const outline = await readOutlineOf(course.id, course.code, opts);
        const entry = { id: course.id, code: course.code, files: [], links: [], tools: [], activities: 0, skipped: !outline };
        manifest.courses.push(entry);
        if (!outline) continue;
        entry.files = outline.files;
        entry.links = outline.links;
        entry.tools = outline.tools;
        entry.activities = outline.activities;
        unaddressed += outline.unaddressed;

        for (let d = 0; d < outline.documents.length; d++) {
          if (opts.shouldStop()) {
            manifest.stopped = true;
            break;
          }
          const documentItem = outline.documents[d];
          const cacheKey = course.id + "/" + documentItem.id;
          let found = opts.useCache ? freshDocument(cache, cacheKey, new Date()) : null;
          if (found) {
            manifest.reused += 1;
          } else {
            opts.onProgress({ step: "document", ...where, document: d + 1, documents: outline.documents.length });
            found = await readDocument(documentItem, opts);
            if (!found) {
              documentsFailed += 1;
              continue;
            }
            cache.documents[cacheKey] = { at: new Date().toISOString(), files: found.files, links: found.links };
            await pause(opts.gap);
          }
          // A document's attachments go in the folder the document sits in.
          for (const file of found.files) entry.files.push({ path: documentItem.path, title: file.title, url: file.url });
          for (const link of found.links) entry.links.push({ path: documentItem.path, ...link });
        }
        if (opts.useCache) writeDocumentCache(storage, cache, new Date());
        if (manifest.stopped) break;
      }
    } finally {
      routeTo(returnTo);
    }

    const skipped = manifest.courses.filter((course) => course.skipped).map((course) => course.code || course.id);
    if (skipped.length) manifest.problems.push({ key: "problemOutlines", params: { courses: skipped.join(", ") } });
    if (documentsFailed) manifest.problems.push({ key: "problemDocuments", params: { count: documentsFailed } });
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

  /**
   * Each course's gradebook rows, and nothing else on the page.
   *
   * Measured on 2026-09-28 across four courses:
   *
   * - A course's gradebook is `/ultra/courses/<id>/grades`. Each row is a
   *   `[data-grade-id]` holding the item's link, an optional line under it
   *   (`[data-testid="item-description"]`), and either a score — `105/100`, in
   *   three spans, beside a spoken "Final Grade: …" — or the words "Not graded".
   * - Twenty-five rows to a page, with Previous and Next buttons. A fresh route
   *   always lands on page 1, where Previous is disabled; on the last page Next is.
   * - A course with no work shows a picture (`StudentNoGrades`) instead of rows,
   *   inside a wrapper that exists only once the grades have loaded — so an empty
   *   course can be told from a page still loading without reading its English.
   * - Some courses show no overall grade at all, so none is read.
   */
  const GRADE_ROWS = "[data-grade-id]";
  const GRADE_NEXT = '[data-analytics-id="course.student.grade.components.common.pagination.pageUpButton"]';
  const GRADES_EMPTY = 'img[src*="StudentNoGrades"]';
  const MAX_GRADE_PAGES = 40;
  const MAX_GRADE_POINTS = 1000000;
  const GRADE_SCORE = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/;

  /** One gradebook row as { id, title, status, earned, possible, label }, or null if it is not one. */
  function readGradeRow(row) {
    const id = row.getAttribute("data-grade-id");
    if (!/^_\d+_\d+$/.test(String(id))) return null;
    const link = row.querySelector('a[id^="course-student-grades-item-name-"]');
    const title = textOf(link);
    if (!title) return null;
    const described = row.querySelector('[data-testid="item-description"]');
    const status = textOf(described);
    const item = {
      id,
      title: title.slice(0, 400),
      status: status ? status.slice(0, 400) : null,
      earned: null,
      possible: null,
      label: null,
    };

    for (const span of row.querySelectorAll('span[aria-hidden="true"]')) {
      const score = GRADE_SCORE.exec(textOf(span));
      if (!score) continue;
      const earned = Number(score[1]);
      const possible = Number(score[2]);
      if (earned <= MAX_GRADE_POINTS && possible <= MAX_GRADE_POINTS) {
        item.earned = earned;
        item.possible = possible;
        return item;
      }
    }
    // No score: what the row shows instead ("Not graded", a letter, "Exempt").
    for (const span of row.querySelectorAll("span")) {
      if (span.children.length || (link && link.contains(span)) || (described && described.contains(span))) continue;
      const words = textOf(span);
      if (words) {
        item.label = words.slice(0, 100);
        break;
      }
    }
    return item;
  }

  /** Does the page's title name this course? `MATH-1070Q-…` names `MATH 1070Q`. */
  function titleNames(code) {
    if (!code) return true;
    const squash = (value) => String(value || "").replace(/[-\s]+/g, "").toLowerCase();
    return squash(document.title).indexOf(squash(code)) !== -1;
  }

  /** Waits until the number of rows has stopped changing for `settle` ms. */
  async function rowsSettled(opts) {
    let count = document.querySelectorAll(GRADE_ROWS).length;
    let since = Date.now();
    while (Date.now() - since < opts.settle) {
      await pause(opts.every);
      const now = document.querySelectorAll(GRADE_ROWS).length;
      if (now !== count) {
        count = now;
        since = Date.now();
      }
    }
  }

  const PAGE_SELECT = '[data-analytics-id$="pagination.pageSelectDropdown.button"]';

  /**
   * Which page the gradebook is on, and how many there are: { page, pages }, or
   * null while the pager has not drawn. Read from the page-select button's label
   * ("Page 1 of 2"), taking its first and last number, so it does not depend on
   * the language.
   *
   * Reading "is Next disabled?" alone was wrong: the button is disabled while the
   * pager is still loading as well as on the last page, so a slow pager looked
   * like a one-page gradebook and a course lost its other pages without a word.
   */
  function pagerState() {
    const button = document.querySelector(PAGE_SELECT);
    const numbers = button ? (button.getAttribute("aria-label") || "").match(/\d+/g) : null;
    if (!numbers || numbers.length < 2) return null;
    return { page: Number(numbers[0]), pages: Number(numbers[numbers.length - 1]) };
  }

  /** True when HuskyCT has sent the tab back to its sign-in page. */
  function looksSignedOut() {
    if (window.location.pathname === "/" && /[?&]new_loc=/.test(window.location.search)) return true;
    return Boolean(document.querySelector('#loginFormDiv, form[name="login"], input[name="user_id"]'));
  }

  /**
   * One attempt at one course's gradebook, every page of it:
   * { items, complete, reason, at }. `reason` is "never" if the page did not show
   * and "page" if it stopped partway ("at" says where, like "2/3"). Only rows the
   * previous page did not have count, so a page still on screen under the new
   * address is not read as this course; an empty course is told by its picture,
   * which must also be new.
   */
  async function readGradesOnce(courseId, code, opts) {
    const path = "/ultra/courses/" + courseId + "/grades";
    const before = new Set([...document.querySelectorAll(GRADE_ROWS)].map((row) => row.getAttribute("data-grade-id")));
    const emptyBefore = new Set(document.querySelectorAll(GRADES_EMPTY));
    routeTo(path);
    const shown = await waitFor(
      () => {
        if (window.location.pathname.indexOf(path) !== 0) return false;
        const rows = [...document.querySelectorAll(GRADE_ROWS)];
        if (rows.some((row) => !before.has(row.getAttribute("data-grade-id")))) return "rows";
        const empty = document.querySelector(GRADES_EMPTY);
        return empty && !emptyBefore.has(empty) && titleNames(code) ? "empty" : false;
      },
      opts.every,
      opts.pageTimeout,
    );
    if (!shown) return { items: [], complete: false, reason: "never", at: null };
    if (shown === "empty") return { items: [], complete: true, reason: null, at: null };

    const items = [];
    const seen = new Set();
    let total = null;
    for (let pages = 1; ; pages++) {
      await rowsSettled(opts);
      // The pager says whether this is the last page; wait for it to say anything.
      const state = await waitFor(pagerState, opts.every, opts.pageTimeout);
      if (!state) return { items, complete: false, reason: "page", at: pages + "/" + (total || "?") };
      total = state.pages;

      const rows = [...document.querySelectorAll(GRADE_ROWS)];
      for (const row of rows) {
        const item = readGradeRow(row);
        if (item && !seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
      }
      if (state.page >= state.pages) return { items, complete: true, reason: null, at: null };
      if (pages >= MAX_GRADE_PAGES) return { items, complete: false, reason: "page", at: state.page + "/" + state.pages };

      // More pages: Next may still be switching on, so wait for it, then press it.
      const onThisPage = new Set(rows.map((row) => row.getAttribute("data-grade-id")));
      const turned = () => {
        const now = pagerState();
        return Boolean(now && now.page > state.page) && [...document.querySelectorAll(GRADE_ROWS)].some((row) => !onThisPage.has(row.getAttribute("data-grade-id")));
      };
      let moved = false;
      // A press that lands while the page is still drawing is lost, so it is made twice.
      for (let press = 0; press < 2 && !moved; press++) {
        const next = await waitFor(
          () => {
            const button = document.querySelector(GRADE_NEXT);
            return button && !button.disabled ? button : null;
          },
          opts.every,
          opts.pageTimeout,
        );
        if (!next) break;
        next.click();
        moved = Boolean(await waitFor(turned, opts.every, press === 0 ? Math.ceil(opts.pageTimeout / 2) : opts.pageTimeout));
      }
      if (!moved) return { items, complete: false, reason: "page", at: state.page + "/" + state.pages };
    }
  }

  /**
   * One course's gradebook, with a second, slower try if the first did not get
   * all of it. A slow HuskyCT, or a page redrawn under the walk, is the usual
   * reason, and one more go after a pause nearly always gets through.
   */
  async function readGradesOf(courseId, code, opts) {
    const first = await readGradesOnce(courseId, code, opts);
    if (first.complete || looksSignedOut()) return first;
    await pause(opts.retryPause);
    const second = await readGradesOnce(courseId, code, Object.assign({}, opts, { pageTimeout: opts.pageTimeout * 2 }));
    // Keep whichever got further.
    return second.complete || second.items.length >= first.items.length ? second : first;
  }

  /**
   * The walk for grades: each current course's gradebook, all its pages.
   * A course whose gradebook did not open, or not to the last page, is marked
   * skipped, so what BetterHuskyCT already holds for it is left as it is. If
   * HuskyCT sends the tab to its sign-in page the walk stops there and says so,
   * instead of timing out on every course that is left.
   */
  async function collectGrades(options) {
    const opts = Object.assign(
      {
        every: 300,
        pageTimeout: 15000,
        retryPause: 1500,
        settle: 600,
        gap: 250,
        onProgress() {},
        shouldStop: () => false,
      },
      options,
    );
    const returnTo = window.location.pathname + window.location.search;
    const manifest = { term: null, courses: [], stopped: false, signedOut: false, problems: [] };

    try {
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
        opts.onProgress({ step: "grades", course, index: index + 1, total: queue.length });
        const read = await readGradesOf(course.id, course.code, opts);
        manifest.courses.push({
          id: course.id,
          code: course.code,
          items: read.items,
          skipped: !read.complete,
          reason: read.reason,
          at: read.at,
        });
        if (!read.complete && looksSignedOut()) {
          manifest.signedOut = true;
          break;
        }
        await pause(opts.gap);
      }
    } finally {
      // After a sign-out there is no page of ours to go back to.
      if (!looksSignedOut()) routeTo(returnTo);
    }

    // Each course that fell short, with where: "MATH 1070Q (page 2/3)".
    const skipped = manifest.courses
      .filter((course) => course.skipped)
      .map((course) => (course.code || course.id) + (course.reason === "page" && course.at ? " (page " + course.at + ")" : ""));
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
   * Every file to save, with the folders it goes in: term, course, then the
   * course's own folders. The same file reached twice in one folder is saved
   * once.
   */
  function plannedFiles(manifest) {
    const top = safeName("HuskyCT " + (manifest.term || ""), "HuskyCT");
    const planned = [];
    for (const course of manifest.courses) {
      const seen = new Set();
      for (const file of course.files) {
        const folders = [top, safeName(course.code || course.id, "Course")].concat(
          file.path.map((part) => safeName(part, "Folder")),
        );
        const key = folders.join("/") + "|" + file.url;
        if (seen.has(key)) continue;
        seen.add(key);
        planned.push({ folders, title: file.title, url: file.url });
      }
    }
    return planned;
  }

  /**
   * Picks a file's name, keeping names unique within a folder: a second
   * "Notes.pdf" becomes "Notes (2).pdf". The order is the walk's, so the same
   * file gets the same name on every run and a rerun recognises it.
   */
  function uniqueName(used, folderKey, name) {
    const taken = used.get(folderKey) || new Set();
    used.set(folderKey, taken);
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
      const dot = name.lastIndexOf(".");
      candidate = dot > 0 ? name.slice(0, dot) + " (" + n + ")" + name.slice(dot) : name + " (" + n + ")";
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  }

  /**
   * One file's bytes. The default request sends HuskyCT's cookie to HuskyCT and
   * nothing to the file store it redirects to — the store's signed address is
   * the permission, and it refuses a request that carries credentials.
   */
  async function fetchMaterial(url) {
    const response = await window.fetch(url);
    if (!response.ok) throw new Error("HTTP " + response.status);
    const blob = await response.blob();
    return { blob, name: nameFromStoreUrl(response.url) };
  }

  /**
   * Saves the files into a folder the student picked, one at a time, skipping
   * any already there — so a second run next week fetches only what is new.
   */
  async function saveMaterialsToFolder(root, manifest, opts) {
    const options = Object.assign({ gap: 250, onProgress() {}, shouldStop: () => false }, opts);
    const planned = plannedFiles(manifest);
    const used = new Map();
    const result = { saved: 0, skipped: 0, failed: 0, folder: planned.length ? planned[0].folders[0] : null };

    for (let index = 0; index < planned.length; index++) {
      if (options.shouldStop()) break;
      const file = planned[index];
      const folderKey = file.folders.join("/");
      options.onProgress({ index: index + 1, total: planned.length, name: file.title });
      try {
        let dir = root;
        for (const name of file.folders) dir = await dir.getDirectoryHandle(name, { create: true });

        // A title with an extension is the name, so a file already saved is
        // recognised without fetching it again.
        let name = hasExtension(file.title) ? uniqueName(used, folderKey, safeName(file.title, "file")) : null;
        if (name && (await folderHas(dir, name))) {
          result.skipped++;
          continue;
        }
        const fetched = await fetchMaterial(file.url);
        if (!name) name = uniqueName(used, folderKey, safeName(fetched.name || file.title, "file"));
        if (await folderHas(dir, name)) {
          result.skipped++;
          continue;
        }
        const handle = await dir.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(fetched.blob);
        await writable.close();
        result.saved++;
      } catch {
        result.failed++;
      }
      await pause(options.gap);
    }
    return result;
  }

  async function folderHas(dir, name) {
    try {
      await dir.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /**
   * A ZIP of stored entries, for browsers that cannot write into a folder
   * (Firefox, Safari). Stored rather than compressed: course files are PDFs,
   * slides and archives, which are compressed already.
   */
  function zipStored(entries) {
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      const crc = crc32(entry.bytes);
      const size = entry.bytes.length;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // names are UTF-8
      local.setUint16(12, 0x21, true); // 1980-01-01
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      parts.push(new Uint8Array(local.buffer), name, entry.bytes);

      const record = new DataView(new ArrayBuffer(46));
      record.setUint32(0, 0x02014b50, true);
      record.setUint16(4, 20, true);
      record.setUint16(6, 20, true);
      record.setUint16(8, 0x0800, true);
      record.setUint16(14, 0x21, true);
      record.setUint32(16, crc, true);
      record.setUint32(20, size, true);
      record.setUint32(24, size, true);
      record.setUint16(28, name.length, true);
      record.setUint32(42, offset, true);
      central.push(new Uint8Array(record.buffer), name);

      offset += 30 + name.length + size;
    }
    const centralSize = central.reduce((total, part) => total + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  /** Every file fetched into one ZIP, with the same folders a picked folder would get. */
  async function materialsZip(manifest, opts) {
    const options = Object.assign({ gap: 250, onProgress() {}, shouldStop: () => false }, opts);
    const planned = plannedFiles(manifest);
    const used = new Map();
    const entries = [];
    let failed = 0;
    for (let index = 0; index < planned.length; index++) {
      if (options.shouldStop()) break;
      const file = planned[index];
      options.onProgress({ index: index + 1, total: planned.length, name: file.title });
      try {
        const fetched = await fetchMaterial(file.url);
        const base = hasExtension(file.title) ? file.title : fetched.name || file.title;
        const name = uniqueName(used, file.folders.join("/"), safeName(base, "file"));
        entries.push({ name: file.folders.concat(name).join("/"), bytes: new Uint8Array(await fetched.blob.arrayBuffer()) });
      } catch {
        failed++;
      }
      await pause(options.gap);
    }
    return { blob: zipStored(entries), saved: entries.length, failed, name: (planned[0] ? planned[0].folders[0] : "HuskyCT") + ".zip" };
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  }

  /**
   * The links and videos, grouped by course and folder, as a page to keep.
   * An LTI tool links to its launch address; any other tool, to its course's
   * content page, where it opens.
   */
  function materialsLinksHtml(manifest) {
    const sections = [];
    for (const course of manifest.courses) {
      const rows = [];
      // Each item carries its course, kind and folder as data, so importing the
      // saved folder into BetterHuskyCT reads them back without parsing the
      // headings, which change with the language.
      const group = (items, heading, render, kind) => {
        if (items.length === 0) return;
        rows.push("<h3>" + escapeHtml(heading) + "</h3><ul>");
        for (const item of items) {
          const itemKind = kind || item.kind;
          rows.push(
            '<li data-course="' + escapeHtml(course.code || course.id) + '" data-course-id="' + escapeHtml(course.id) +
              '" data-kind="' + escapeHtml(itemKind) + '" data-path="' + escapeHtml(JSON.stringify(item.path)) + '">' +
              render(item) +
              "</li>",
          );
        }
        rows.push("</ul>");
      };
      const where = (item) => (item.path.length ? '<span class="path">' + escapeHtml(item.path.join(" / ")) + "</span> " : "");
      const outlink = (item) => where(item) + '<a href="' + escapeHtml(item.url) + '">' + escapeHtml(item.title) + "</a>";
      group(course.links.filter((link) => link.kind === "video"), t("linksVideos"), outlink);
      group(course.links.filter((link) => link.kind !== "video"), t("linksLinks"), outlink);
      const outline = window.location.origin + "/ultra/courses/" + course.id + "/outline";
      group(
        course.tools,
        t("linksTools"),
        (tool) => where(tool) + '<a href="' + escapeHtml(tool.url || outline) + '">' + escapeHtml(tool.title) + "</a>",
        "tool",
      );
      if (rows.length) sections.push("<h2>" + escapeHtml(course.code || course.id) + "</h2>" + rows.join(""));
    }
    const title = "HuskyCT " + (manifest.term || "") + " — " + t("linksTitle");
    return (
      '<!doctype html><html><head><meta charset="utf-8"><title>' +
      escapeHtml(title) +
      "</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#1f2a37}" +
      "h2{margin-top:32px;border-top:1px solid #dde3ea;padding-top:16px}h3{font-size:15px;color:#51606f}" +
      ".path{color:#7a8794;font-size:13px}a{color:#0b5cad}</style></head><body><h1>" +
      escapeHtml(title) +
      "</h1>" +
      (sections.join("") || "<p>—</p>") +
      "</body></html>"
    );
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
    const result = { connected: false, sent: 0, skipped: 0, failed: 0 };

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
  function syncPayload(records, now, announcements) {
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
      efforts: {},
      courses: { version: 1, courses: [], assignments: {} },
      announcements: announcements || [],
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
    const payload = syncPayload(records, new Date(), announcements);
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
   * When there is none, nothing opens and the Send buttons do it on a press.
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
      return tab;
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
   * The panel offers six actions and nothing on screen says which one this page
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

  // -------------------------------------------------------------------- panel

  const style = `
    :host { all: initial; }
    .wrap {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      width: ${PANEL_WIDTH}px; max-height: 70vh; overflow: auto;
      font: 13px/1.5 ui-sans-serif, system-ui, "Segoe UI", sans-serif;
      color: #172b41; background: #fff; border: 1px solid #cdddf4;
      border-radius: 14px; box-shadow: 0 14px 40px rgba(23,43,65,.22);
    }
    header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-bottom: 1px solid #e6eef8;
      background: #f7fbff; border-radius: 14px 14px 0 0; cursor: default;
    }
    header b { font-size: 13px; }
    header span { font-size: 11px; color: #7387a0; }
    button.close { border: 0; background: none; cursor: pointer; font-size: 15px; color: #7387a0; }
    button.lang {
      margin-left: auto; border: 1px solid #cdd9e6; background: #fff; cursor: pointer;
      font: inherit; font-size: 11px; color: #244e7a; padding: 2px 7px; border-radius: 999px;
    }
    button.lang:hover { border-color: #9fb7d1; }
    /* The way back. The panel used to be removed outright on close, which left
       anyone who dismissed it with no way to find it again — the buttons were
       still in the page, but nothing said so. The chip is always mounted; only
       one of the chip and the panel is ever visible. */
    .chip {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      display: none; align-items: center; gap: 7px;
      font: 13px/1 ui-sans-serif, system-ui, "Segoe UI", sans-serif;
      color: #fff; background: #2a71d8; border: 0; cursor: pointer;
      padding: 9px 13px; border-radius: 999px;
      box-shadow: 0 8px 22px rgba(23,43,65,.28);
    }
    .chip:hover { background: #1f61c0; }
    .chip[data-dot="1"]::after {
      content: ""; width: 7px; height: 7px; border-radius: 999px;
      background: #ffd166; box-shadow: 0 0 0 2px rgba(255,255,255,.35);
    }
    :host([data-collapsed="1"]) .wrap { display: none; }
    :host([data-collapsed="1"]) .chip { display: inline-flex; }
    .body { padding: 12px; display: grid; gap: 8px; }
    button.act {
      width: 100%; text-align: left; padding: 8px 10px; cursor: pointer;
      border: 1px solid #cdd9e6; border-radius: 9px; background: #fff;
      font: inherit; color: #244e7a;
    }
    button.act:hover { border-color: #9fb7d1; }
    button.act.primary { background: #2a71d8; border-color: #2a71d8; color: #fff; }
    button.act:disabled { opacity: .55; cursor: wait; }
    textarea {
      width: 100%; box-sizing: border-box; min-height: 150px; resize: vertical;
      font: 11px/1.45 ui-monospace, Consolas, monospace;
      border: 1px solid #dbe3ec; border-radius: 9px; padding: 8px; color: #31506f;
    }
    .note { font-size: 11px; color: #7387a0; }
    .ok { color: #276944; }
    .warn { color: #9f3527; }
    .pill {
      display: inline-block; padding: 1px 7px; border-radius: 999px;
      background: #eaf2ff; color: #245ea9; font-size: 11px; font-weight: 700;
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
        <button class="act primary" data-act="collectall">${t("collectAll")}</button>
        <button class="act" data-act="todos">${t("sendDeadlines")}</button>
        <button class="act" data-act="emptybasket">${t("clearBasket")}</button>
        <hr style="border:0;border-top:1px solid #e6eef8;margin:4px 0" />
        <button class="act" data-act="materials">${t("collectMaterials")}</button>
        <div class="note" data-role="materials" hidden></div>
        <button class="act primary" data-act="sendmaterials" hidden></button>
        <button class="act" data-act="savefiles" hidden></button>
        <hr style="border:0;border-top:1px solid #e6eef8;margin:4px 0" />
        <button class="act" data-act="grades">${t("collectGrades")}</button>
        <div class="note" data-role="grades" hidden></div>
        <button class="act primary" data-act="sendgrades" hidden></button>
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
    const materialsButton = wrap.querySelector('[data-act="materials"]');
    const materialsLine = wrap.querySelector('[data-role="materials"]');
    const saveFilesButton = wrap.querySelector('[data-act="savefiles"]');
    const sendMaterialsButton = wrap.querySelector('[data-act="sendmaterials"]');
    const gradesButton = wrap.querySelector('[data-act="grades"]');
    const gradesLine = wrap.querySelector('[data-role="grades"]');
    const sendGradesButton = wrap.querySelector('[data-act="sendgrades"]');
    // The walk in progress, if any — `kind` says which button started it, and
    // that button becomes its Stop. The timer's own capture stands aside while
    // it runs: the walk reads each page itself, and knows when a page is really
    // the course it asked for.
    let walk = null;
    // The last materials walk, kept for the save buttons.
    let materials = null;
    // The last grades walk, kept for the send button.
    let grades = null;
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
      const materialsWalk = Boolean(walk && walk.kind === "materials");
      const gradesWalk = Boolean(walk && walk.kind === "grades");
      collectButton.textContent = basketWalk ? t("stopCollecting") : t("collectAll");
      collectButton.disabled = materialsWalk || gradesWalk;
      collectButton.classList.toggle("primary", !ready);
      sendButton.classList.toggle("primary", ready);
      sendButton.disabled = Boolean(walk);
      emptyBasketButton.disabled = Boolean(walk);

      materialsButton.textContent = materialsWalk ? t("stopCollecting") : t("collectMaterials");
      materialsButton.disabled = basketWalk || gradesWalk;
      const found = materials ? materialsSummary(materials) : null;
      const canSaveFolder = typeof window.showDirectoryPicker === "function";
      saveFilesButton.hidden = !found || found.files === 0;
      saveFilesButton.disabled = Boolean(walk);
      saveFilesButton.textContent = found
        ? t(canSaveFolder ? "saveFiles" : "saveFilesZip", { count: found.files })
        : "";
      sendMaterialsButton.hidden = !found || found.files + found.videos + found.links + found.tools === 0;
      sendMaterialsButton.disabled = Boolean(walk);
      sendMaterialsButton.textContent = found ? t("sendMaterials", { count: found.files }) : "";

      gradesButton.textContent = gradesWalk ? t("stopCollecting") : t("collectGrades");
      gradesButton.disabled = basketWalk || materialsWalk;
      const gradesFound = grades ? gradesSummary(grades) : null;
      sendGradesButton.hidden = !gradesFound || gradesFound.items === 0;
      sendGradesButton.disabled = Boolean(walk);
      sendGradesButton.textContent = gradesFound ? t("sendGrades", { count: gradesFound.items }) : "";
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

    wrap.querySelector(".close").addEventListener("click", () => {
      setCollapsed(true);
    });


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
            materials = report.materials;
            materialsLine.hidden = false;
            const materialsCheck = problemsText(report.materials.problems);
            materialsLine.className = materialsCheck ? "note warn" : "note ok";
            materialsLine.textContent =
              (report.materials.stopped ? t("materialsStopped") + " " : "") +
              t("materialsFound", materialsSummary(report.materials)) +
              (report.materials.reused ? t("materialsReused", { count: report.materials.reused }) : "") +
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

      if (act === "materials") {
        if (walk) {
          walk.stop = true;
          button.disabled = true;
          return;
        }
        walk = { stop: false, kind: "materials" };
        refreshBasket();
        materialsLine.hidden = false;
        materialsLine.className = "note";
        try {
          const manifest = await collectMaterials({
            shouldStop: () => walk.stop,
            onProgress(progress) {
              const course = progress.course ? progress.course.code || progress.course.id : "";
              materialsLine.textContent =
                progress.step === "courses"
                  ? t("materialsCourses")
                  : progress.step === "outline"
                    ? t("materialsOutline", { course, index: progress.index, total: progress.total })
                    : t("materialsDocument", { course, document: progress.document, documents: progress.documents });
            },
          });
          materials = manifest;
          const selfCheck = problemsText(manifest.problems);
          materialsLine.className = selfCheck ? "note warn" : "note ok";
          materialsLine.textContent =
            (manifest.stopped ? t("materialsStopped") + " " : "") +
            t("materialsFound", materialsSummary(manifest)) +
            (manifest.reused ? t("materialsReused", { count: manifest.reused }) : "") +
            (selfCheck ? " " + selfCheck : "");
        } catch (error) {
          materialsLine.className = "note warn";
          materialsLine.textContent = t("materialsFailed", { message: error.message });
        } finally {
          walk = null;
          button.disabled = false;
          refreshBasket();
          refreshGuidance();
        }
        return;
      }

      if (act === "sendmaterials") {
        if (!materials || walk) return;
        // Opened here, on the click, before anything is awaited: a tab opened
        // later is a popup the browser blocks.
        const target = window.open(HUSKYPILOT_URL + "materials", "betterhuskyct");
        if (!target) {
          materialsLine.className = "note warn";
          materialsLine.textContent = t("popupBlocked");
          return;
        }
        walk = { stop: false, kind: "send" };
        refreshBasket();
        materialsLine.className = "note";
        materialsLine.textContent = t("connectingBhc");
        try {
          const result = await sendMaterialsToBhc(target, materials, {
            onProgress: (step) => {
              materialsLine.textContent = t("sendingMaterial", step);
            },
          });
          materialsLine.className = !result.connected || result.failed ? "note warn" : "note ok";
          materialsLine.textContent = result.connected ? t("materialsSent", result) : t("bhcNoAnswer");
        } finally {
          walk = null;
          refreshBasket();
        }
        return;
      }

      if (act === "savefiles") {
        if (!materials) return;
        const progress = (step) => {
          materialsLine.className = "note";
          materialsLine.textContent = t("savingFile", step);
        };

        if (typeof window.showDirectoryPicker !== "function") {
          walk = { stop: false, kind: "save" };
          refreshBasket();
          try {
            const zip = await materialsZip(materials, { onProgress: progress });
            download(zip.name, zip.blob);
            materialsLine.className = "note ok";
            materialsLine.textContent = t("zipSaved", zip);
          } finally {
            walk = null;
            refreshBasket();
          }
          return;
        }

        // Said before the picker opens, because the browser's own refusal —
        // "this folder contains system files" — does not say what to do instead.
        materialsLine.className = "note";
        materialsLine.textContent = t("pickFolderHint");
        let root;
        try {
          // The one prompt: the student picks where the term's folder goes.
          root = await window.showDirectoryPicker({ id: "huskyct-materials", mode: "readwrite", startIn: "desktop" });
        } catch {
          return; // closed without picking; the hint stays up
        }
        walk = { stop: false, kind: "save" };
        refreshBasket();
        try {
          const result = await saveMaterialsToFolder(root, materials, { onProgress: progress });
          // The links travel with the files, in the term's folder.
          try {
            const top = await root.getDirectoryHandle(result.folder || "HuskyCT", { create: true });
            const handle = await top.getFileHandle(t("linksFileName"), { create: true });
            const writable = await handle.createWritable();
            await writable.write(materialsLinksHtml(materials));
            await writable.close();
          } catch {
            /* the files are what matter; the list can be saved on its own */
          }
          materialsLine.className = result.failed ? "note warn" : "note ok";
          materialsLine.textContent = t("filesSaved", result);
        } finally {
          walk = null;
          refreshBasket();
        }
        return;
      }

      if (act === "grades") {
        if (walk) {
          walk.stop = true;
          button.disabled = true;
          return;
        }
        walk = { stop: false, kind: "grades" };
        refreshBasket();
        gradesLine.hidden = false;
        gradesLine.className = "note";
        try {
          const manifest = await collectGrades({
            shouldStop: () => walk.stop,
            onProgress(progress) {
              gradesLine.textContent =
                progress.step === "courses"
                  ? t("materialsCourses")
                  : t("gradesCourse", {
                      course: progress.course.code || progress.course.id,
                      index: progress.index,
                      total: progress.total,
                    });
            },
          });
          grades = manifest;
          const selfCheck = problemsText(manifest.problems);
          gradesLine.className = selfCheck ? "note warn" : "note ok";
          gradesLine.textContent =
            (manifest.stopped ? t("gradesStopped") + " " : "") +
            t("gradesFound", gradesSummary(manifest)) +
            (selfCheck ? " " + selfCheck : "");
        } catch (error) {
          gradesLine.className = "note warn";
          gradesLine.textContent = t("gradesFailed", { message: error.message });
        } finally {
          walk = null;
          button.disabled = false;
          refreshBasket();
          refreshGuidance();
        }
        return;
      }

      if (act === "sendgrades") {
        if (!grades || walk) return;
        // Opened here, on the click, before anything is awaited: a tab opened
        // later is a popup the browser blocks.
        const target = window.open(HUSKYPILOT_URL + "grades", "betterhuskyct");
        if (!target) {
          gradesLine.className = "note warn";
          gradesLine.textContent = t("popupBlocked");
          return;
        }
        walk = { stop: false, kind: "send" };
        refreshBasket();
        gradesLine.className = "note";
        gradesLine.textContent = t("connectingBhc");
        try {
          const result = await sendGradesToBhc(target, grades);
          gradesLine.className = result.connected && result.stored ? "note ok" : "note warn";
          gradesLine.textContent = !result.connected
            ? t("gradesNoAnswer")
            : result.stored
              ? t("gradesSent", result)
              : t("gradesNotStored");
        } finally {
          walk = null;
          refreshBasket();
        }
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
      rememberCourses,
      rememberAnnouncements,
      rememberTodos,
      rememberDueDates,
      deadlineRecords,
      collectDueDates,
      captureIntoBasket,
      basketSummary,
      announcementsPathFor,
      routeTo,
      courseCardsOnPage,
      coursesToCollect,
      termCodeFor,
      readAnnouncementsOf,
      collectEverything,
      findCourses,
      splitItemLabel,
      unwrapLink,
      classifyOutline,
      readOutlineOf,
      readDocument,
      collectMaterials,
      materialsSummary,
      readGradeRow,
      pagerState,
      collectGrades,
      gradesSummary,
      gradesSnapshotFrom,
      GRADES_PROTOCOL,
      sendGradesToBhc,
      openBhcTab,
      problemsText,
      DOCUMENTS_KEY,
      termLabel,
      safeName,
      nameFromStoreUrl,
      plannedFiles,
      saveMaterialsToFolder,
      crc32,
      zipStored,
      materialsZip,
      materialsLinksHtml,
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

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountPanel, { once: true });
    } else {
      mountPanel();
    }
  }
})();
