// ==UserScript==
// @name         HuskyCT Helper
// @namespace    https://github.com/NoGod3524/betterhuskyct
// @version      0.13.0
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
  const VERSION = "0.13.0";
  const PANEL_WIDTH = 340;

  // ---------------------------------------------------------------- utilities

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ merging .ics

  /** Unfold continuation lines, the way RFC 5545 requires. */
  function unfold(text) {
    return text.replace(/\r?\n[ \t]/g, "");
  }

  function blocks(text, name) {
    const pattern = new RegExp("BEGIN:" + name + "[\\s\\S]*?END:" + name, "g");
    return unfold(text).match(pattern) || [];
  }

  /**
   * One calendar out of many.
   *
   * VTIMEZONE blocks have to come along: the events reference them by TZID, and
   * a calendar that drops them has its times silently reinterpreted.
   */
  function mergeCalendars(name, texts) {
    const events = new Map();
    const timezones = new Map();

    for (const text of texts) {
      for (const block of blocks(text, "VEVENT")) {
        const uid = (block.match(/^UID:(.*)$/m) || [])[1] || block.slice(0, 80);
        if (!events.has(uid)) events.set(uid, block);
      }
      for (const block of blocks(text, "VTIMEZONE")) {
        const tzid = (block.match(/^TZID:(.*)$/m) || [])[1] || block.slice(0, 80);
        if (!timezones.has(tzid)) timezones.set(tzid, block);
      }
    }

    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//BetterHuskyCT//HuskyCT Helper " + VERSION + "//EN",
      "CALSCALE:GREGORIAN",
      "X-WR-CALNAME:" + name,
      ...timezones.values(),
      ...events.values(),
      "END:VCALENDAR",
    ].join("\r\n");
  }

  /** Every same-origin link on this page that looks like a calendar feed. */
  function calendarLinks() {
    const found = new Map();
    for (const anchor of document.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href") || "";
      if (!/\.ics(\?|$)|ical|calendar/i.test(href)) continue;
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) continue;
        if (!/\.ics(\?|$)/i.test(url.pathname + url.search)) continue;
        const text = (anchor.textContent || "").replace(/\s+/g, " ").trim();
        found.set(url.href, (text.length > 60 ? text.slice(0, 60) + "…" : text) || url.pathname);
      } catch {
        /* not a URL we can use */
      }
    }
    return [...found.entries()];
  }

  // ------------------------------------------------------- collecting events

  function kindFromSourceType(type) {
    if (/GradableItem/.test(type || "")) return "assignment";
    if (/CalendarEntry/.test(type || "")) return "class";
    return null;
  }

  /** `2026-09-16T16:30:00.000Z` -> `20260916T163000Z` */
  function utcStamp(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.valueOf())) return null;
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  /** `2026-09-16T16:30:00.000Z` -> `20260916` */
  function dateOnly(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.valueOf())) return null;
    return date.toISOString().slice(0, 10).replace(/-/g, "");
  }

  function escapeIcs(text) {
    return String(text)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  /** RFC 5545 folds long lines at 75 octets with a leading space. */
  function fold(line) {
    if (line.length <= 73) return line;
    const parts = [line.slice(0, 73)];
    for (let index = 73; index < line.length; index += 72) {
      parts.push(" " + line.slice(index, index + 72));
    }
    return parts.join("\r\n");
  }

  function eventToRecord(raw, event) {
    const start = raw.startDate || event.start;
    if (!start) return null;

    const type = raw.itemSourceType || "";
    const sourceId = raw.itemSourceId || event.id || "unknown";
    const name =
      (raw.calendarNameLocalizable && raw.calendarNameLocalizable.rawValue) ||
      (raw.ui && raw.ui.calendarName) ||
      null;

    return {
      // The type stays in the UID on purpose: BetterHuskyCT reads it back to tell
      // a class meeting from an assignment, exactly as it does for a real feed.
      uid: type + "-" + sourceId + "-" + (utcStamp(start) || ""),
      title: raw.title || event.title || "Untitled",
      course: courseCodeFromDisplay(name),
      start,
      end: raw.endDate || event.end || null,
      location: raw.location || null,
      allDay: Boolean(event.allDay),
      kind: kindFromSourceType(type),
    };
  }

  function recordsToIcs(records) {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//BetterHuskyCT//HuskyCT Helper " + VERSION + "//EN",
      "CALSCALE:GREGORIAN",
      "X-WR-CALNAME:HuskyCT",
    ];
    const stamp = utcStamp(new Date().toISOString());

    for (const record of records) {
      lines.push("BEGIN:VEVENT");
      lines.push("UID:" + escapeIcs(record.uid));
      lines.push("DTSTAMP:" + stamp);
      if (record.allDay) {
        lines.push("DTSTART;VALUE=DATE:" + dateOnly(record.start));
      } else {
        lines.push("DTSTART:" + utcStamp(record.start));
        if (record.end) lines.push("DTEND:" + utcStamp(record.end));
      }
      lines.push("SUMMARY:" + escapeIcs(record.title));
      if (record.course) lines.push("CATEGORIES:" + escapeIcs(record.course));
      if (record.location) lines.push("LOCATION:" + escapeIcs(record.location));
      lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n");
  }

  // ------------------------------------------------------------- the harvest

  /**
   * FullCalendar only holds the events for the range it has loaded, so this
   * accumulates everything ever seen rather than exporting one view's worth.
   * Navigating the calendar is what fills it up; the count in the panel is how
   * the user knows when to stop.
   */
  const collected = new Map();

  function clientEvents() {
    const jq = window.jQuery || window.$;
    if (!jq) return null;
    const containers = jq("#fullCalendar, .fullcalendar-container");
    if (!containers.length) return null;
    try {
      return jq(containers[0]).fullCalendar("clientEvents") || [];
    } catch {
      return null;
    }
  }

  function harvest() {
    const events = clientEvents();
    if (!events) return { total: collected.size, added: 0, available: false };

    let added = 0;
    for (const event of events) {
      const record = eventToRecord(event.raw || {}, event);
      if (!record || collected.has(record.uid)) continue;
      collected.set(record.uid, record);
      added += 1;
    }

    return { total: collected.size, added, available: true };
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
      // the row's text for renderings that do not have it.
      const posted =
        textOf(row.querySelector(".announcement-sent-date")) || postedFromText(textOf(row));

      const key = title + "|" + posted;
      if (seen.has(key)) continue;
      seen.add(key);

      records.push({
        title,
        body:
          textOf(row.querySelector(".click-message-detail")) ||
          textOf(row.querySelector(".body-text.message-entries")),
        posted: posted || null,
      });
    }

    return records;
  }

  /**
   * The course outline.
   *
   * Titles come from each item's accessibility label — "Status for Cengage
   * WebAssign: Started" — not from a CSS class. Those class names carry build
   * hashes (`makeStylescontentItemTitle-0-2-809`) and change every release,
   * while an aria-label is part of the page's contract with screen readers and
   * is far steadier.
   */
  function collectContentItems(root) {
    const scope = root || document;
    const items = [];
    const seen = new Set();
    for (const node of scope.querySelectorAll("[aria-label^='Status for ']")) {
      const match = String(node.getAttribute("aria-label") || "").match(/^Status for (.+?):\s*(.+)$/);
      if (!match) continue;
      const title = match[1].trim();
      if (seen.has(title)) continue;
      seen.add(title);
      items.push({ title, state: match[2].trim() });
    }
    return items;
  }

  /** The course id out of a course URL, e.g. `/ultra/courses/_203765_1/outline`. */
  function currentCourseId() {
    const match = window.location.pathname.match(/\/ultra\/courses\/([^/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Documents the course page links to.
   *
   * The outline's items are found by accessibility label, which gives names but
   * no addresses. A document is a real anchor — /ultra/courses/<id>/document/
   * <fileId> — and a link is what makes an index useful. Only the path is kept;
   * a query string can carry a token, and none of it is needed to open a file
   * the reader is already entitled to.
   */
  function collectCourseFiles(root) {
    const scope = root || document;
    const files = [];
    const seen = new Set();

    for (const anchor of scope.querySelectorAll('a[href*="/document/"]')) {
      const href = anchor.getAttribute("href") || "";
      const title = textOf(anchor) || anchor.getAttribute("title") || "";
      if (!title) continue;

      // The id has to come out of the path, or there is nothing to list. The
      // selector implies it will, but depending on the caller's selector for
      // the shape of a record is how an empty entry reaches the output.
      const id = (href.match(/\/document\/([^/?#]+)/) || [])[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);

      files.push({ title, id, url: href.split("?")[0].split("#")[0] });
    }

    return files;
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

  /**
   * A plain-text digest of the course.
   *
   * Markdown on purpose: it reads fine in a message, it diffs, and there is no
   * rendering to get wrong.
   */
  function courseDigestToMarkdown(digest) {
    const lines = [];
    const course = digest.course || {};

    lines.push("# " + (course.code || course.heading || "HuskyCT course"));
    if (course.title) lines.push("", course.title);
    lines.push("", "Source: " + (digest.source || "(unknown page)"));

    const announcements = digest.announcements || [];
    if (announcements.length) {
      lines.push("", "## Announcements (" + announcements.length + ")");
      for (const item of announcements) {
        lines.push("", "### " + item.title);
        if (item.posted) lines.push("_" + item.posted + "_");
        if (item.body) lines.push("", item.body);
      }
    }

    const content = digest.content || [];
    if (content.length) {
      lines.push("", "## Course content (" + content.length + ")");
      for (const item of content) {
        lines.push("- " + item.title + (item.state ? "  (" + item.state + ")" : ""));
      }
    }

    const files = digest.files || [];
    if (files.length) {
      lines.push("", "## Files (" + files.length + ")");
      for (const file of files) lines.push("- [" + file.title + "](" + file.url + ")");
    }

    lines.push("");
    return lines.join("\n");
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

  /**
   * `9/25/26, 11:59 PM` -> an instant, read in the reader's own timezone.
   *
   * The page shows a wall-clock time with no zone on it. Building the date from
   * its parts lets the browser interpret it locally, which is right for someone
   * sitting in the same timezone as their classes — and it is the only reading
   * available from the page alone.
   */
  function dueDateFromText(value) {
    const match = String(value || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*([AP])M/i);
    if (!match) return null;

    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    // 12 AM is hour 0 and 12 PM is hour 12; the modulo handles both.
    const hour = (Number(match[4]) % 12) + (/p/i.test(match[6]) ? 12 : 0);

    const date = new Date(year, Number(match[1]) - 1, Number(match[2]), hour, Number(match[5]), 0, 0);
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
   * What the "Send deadlines" button puts in the link.
   *
   * Pulled out of the button handler so the join between collecting and sending
   * can be exercised without a panel. The rule it encodes: announcements ride
   * along **only** on a course page. On the Courses page there is no course to
   * attribute them to, and an announcement nobody can place is worse than one
   * that was not sent.
   */
  function deadlinesAndAnnouncements(scope, now) {
    const records = todosToRecords(collectTodos(scope));

    const courseId = currentCourseId();
    if (!courseId) return { records, announcements: [] };

    return {
      records,
      announcements: announcementsToCandidates(
        collectAnnouncements(scope),
        courseCodeFromDisplay(collectCourse(scope).heading),
        now,
      ),
    };
  }

  /**
   * What to do on the page the panel happens to be sitting on.
   *
   * The panel offers six actions and nothing on screen says which one this page
   * wants. Working that out is the script's job, not the reader's.
   */
  function guidanceFor(scope, courseId) {
    const root = scope || document;

    if (root.querySelector("[aria-label*=', due ']")) {
      return "This page has your to-do list. Press “Send deadlines to BetterHuskyCT”.";
    }
    if (courseId) {
      return "You are in a course. Press “Collect this course” for its announcements and files.";
    }
    return "Open the Courses page for your deadlines, or a course for its announcements and files.";
  }

  /**
   * What to call the calendar this produces.
   *
   * This exists because of a bug the old merge path had: with a single feed it
   * passed a bare `""`, which wrote a bare `X-WR-CALNAME:` into the file. The
   * dashboard reads that key as the calendar's name, so it got `""` rather than
   * nothing and showed a blank name where it would otherwise have said
   * "Unnamed calendar". A label is never empty now.
   */
  function calendarNameFor(links) {
    if (links.length === 1) {
      const label = (links[0][1] || "").replace(/\.ics$/i, "").trim();
      if (label) return label;
    }
    if (links.length > 1) return "HuskyCT (" + links.length + " calendars)";
    return "HuskyCT";
  }

  /**
   * Which source this page offers, decided without doing any work.
   *
   * Split out from `acquireCalendar` so the decision can be tested on its own:
   * the actions around it fetch other people's servers and write files, which
   * makes them awkward to assert against, while the rule itself —
   * feeds beat harvested events, and nothing is an honest answer — is the part
   * that would break quietly.
   */
  function planCalendarAcquisition(linksCount, collectedCount, available) {
    if (linksCount > 0) {
      return {
        source: "feeds",
        filename: "huskyct-merged.ics",
        message: null,
      };
    }

    if (collectedCount > 0) {
      return {
        source: "events",
        filename: "huskyct-calendar.ics",
        message: null,
      };
    }

    return {
      source: null,
      filename: null,
      message: available
        ? "This page has a calendar but no events loaded yet — move through it first."
        : "No feed links and no calendar on this page.",
    };
  }

  /**
   * The one action behind "give me this page's calendar".
   *
   * Feed links are preferred because they carry the original VEVENT blocks
   * untouched and, more importantly, because the file they produce can be pasted
   * into the dashboard as a *link* — a subscription that refreshes itself. The
   * harvested events can only ever be dragged in as a file, because the app has
   * no way to turn a file back into a feed URL, so that route is the fallback
   * for a page that exposes no feeds at all.
   */
  async function acquireCalendar(options) {
    const opts = options || {};
    const links = calendarLinks();

    if (links.length === 0) {
      const result = harvest(opts.now);
      const plan = planCalendarAcquisition(0, collected.size, result.available);

      if (plan.source !== "events") {
        return {
          ok: false,
          message: plan.message,
          detail:
            "This button prefers links ending in .ics, and this page has none.\n" +
            "It falls back to the events the calendar has loaded, and there are none yet.\n" +
            "The Calendar page is the one that usually has the feed links.",
        };
      }

      const records = [...collected.values()];
      const withCourse = records.filter((record) => record.course).length;
      download(plan.filename, recordsToIcs(records), "text/calendar;charset=utf-8");

      return {
        ok: true,
        source: "events",
        message:
          "No feed links here, so exported " + records.length + " collected events" +
          (withCourse ? ", " + withCourse + " with a course code" : "") +
          ". Check your downloads.",
        hint:
          (result.added ? "Picked up " + result.added + " more just now. " : "") +
          "Drop huskyct-calendar.ics into BetterHuskyCT. A file cannot refresh itself — " +
          "open the Calendar page for the feed links if you want that.",
      };
    }

    if (opts.status) {
      opts.status.className = "note";
      opts.status.textContent = "Reading " + links.length + " calendar(s)…";
    }

    const texts = [];
    const failed = [];
    for (const [href, name] of links) {
      try {
        const response = await fetch(href, { credentials: "same-origin" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        texts.push(await response.text());
      } catch (error) {
        failed.push(name + " (" + error.message + ")");
      }
      // Deliberately slow: this is someone else's server.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    if (texts.length === 0) {
      return {
        ok: false,
        message: "Found " + links.length + " feed link(s) but could not read any of them.",
        detail: failed.join("\n"),
      };
    }

    const plan = planCalendarAcquisition(links.length, collected.size, true);
    const merged = mergeCalendars(calendarNameFor(links), texts);
    const eventCount = (merged.match(/BEGIN:VEVENT/g) || []).length;
    download(plan.filename, merged, "text/calendar;charset=utf-8");

    return {
      ok: true,
      source: "feeds",
      message:
        "Merged " + texts.length + " calendar(s), " + eventCount + " events. Check your downloads.",
      hint: failed.length
        ? "Could not read: " + failed.join(", ")
        : "Open huskyct-merged.ics and copy its contents into the dashboard's link box — " +
          "that way it refreshes itself. Dropping the file works too, but only once.",
    };
  }

  /**
   * Say which source this page will use, before the button is pressed.
   *
   * Without this the label would promise one thing and the button might do
   * another, which is how the old two-button panel left people guessing. The
   * text is deliberately about the *page*, not about feeds in the abstract.
   */
  function acquireLabelFor(linksCount, collectedCount) {
    if (linksCount > 0) {
      return linksCount === 1
        ? "Get this page's calendar (1 feed link)"
        : "Get this page's calendar (" + linksCount + " feed links)";
    }
    if (collectedCount > 0) {
      return "Get this page's calendar (events collected so far)";
    }
    return "Get this page's calendar";
  }

  function acquireHintFor(linksCount, collectedCount) {
    if (linksCount > 0) return "Feed links found here — the merged file can be pasted in as a link.";
    if (collectedCount > 0) return "No feed links on this page, so it will export what has been collected.";
    return "No feed links here yet. The Calendar page is the one that usually has them.";
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
    header span { margin-left: auto; font-size: 11px; color: #7387a0; }
    button.close { border: 0; background: none; cursor: pointer; font-size: 15px; color: #7387a0; }
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
    wrap.innerHTML = `
      <header>
        <b>HuskyCT Helper</b>
        <span class="pill">v${VERSION}</span>
        <button class="close" title="Hide the panel">×</button>
      </header>
      <div class="body">
        <!-- The guidance comes first: it is what tells the reader which button
             this page wants, and it used to sit under six buttons at the very
             bottom, where it was the last thing anyone read. -->
        <div class="note" data-role="hint"></div>
        <div class="note" data-role="count">Collected 0 events.</div>
        <!-- One button for "give me this page's calendar", not two.
             Two file-producing buttons on one panel left the reader to work out
             which to press when both produce a .ics they then drag into the same
             place. The label changes to say which one it will do, because feed
             links are the better source: they can be pasted straight in as a
             subscription, and only a link can refresh itself later. -->
        <!-- Send deadlines leads, because on the two pages that matter it is the
             whole point of the helper, and it is the one action that needs no
             file and cannot be done by hand. -->
        <button class="act primary" data-act="todos">Send deadlines to BetterHuskyCT</button>
        <button class="act" data-act="acquire">Get this page's calendar</button>
        <div class="note" data-role="acquire-hint"></div>
        <button class="act" data-act="export">Export events collected so far</button>
        <div class="note">Stay on the Calendar page and move through the term — every view you open is added as you go. This is the fallback for when the page exposes no feed links.</div>
        <button class="act" data-act="clear">Clear collected</button>
        <hr style="border:0;border-top:1px solid #e6eef8;margin:4px 0" />
        <button class="act" data-act="course">Collect this course: announcements + content</button>
        <textarea data-role="out" hidden></textarea>
        <button class="act" data-act="copy" hidden>Copy to clipboard</button>
        <div class="note" data-role="status">Nothing is uploaded. Everything stays in this browser.</div>
      </div>
    `;

    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.title = "Show the HuskyCT Helper panel";
    chip.textContent = "HuskyCT Helper";

    shadow.append(styleTag, wrap, chip);
    document.documentElement.appendChild(host);

    /**
     * Collapse the panel to a chip, rather than deleting it.
     *
     * This is the whole "I cannot find the button" fix. The close button used to
     * call `host.remove()`, which took the panel — and every button in it, the
     * Send deadlines one included — out of the page for the rest of the
     * session. Nothing said how to get it back, because there was no way.
     */
    function setCollapsed(collapsed) {
      host.dataset.collapsed = collapsed ? "1" : "0";
    }
    setCollapsed(false);

    chip.addEventListener("click", () => setCollapsed(false));

    const out = wrap.querySelector('[data-role="out"]');
    const status = wrap.querySelector('[data-role="status"]');
    const hint = wrap.querySelector('[data-role="hint"]');
    const count = wrap.querySelector('[data-role="count"]');
    const copyButton = wrap.querySelector('[data-act="copy"]');
    const acquireButton = wrap.querySelector('[data-act="acquire"]');
    const acquireHint = wrap.querySelector('[data-role="acquire-hint"]');

    function refreshCount() {
      const total = collected.size;
      count.textContent =
        total === 0
          ? "Collected 0 events."
          : "Collected " + total + " event" + (total === 1 ? "" : "s") + ".";
      count.className = total === 0 ? "note" : "note ok";
    }

    /**
     * Keep the acquire button honest about which source it is about to use.
     *
     * Read from the page each time rather than cached: HuskyCT is a single-page
     * app, so the links under the panel change without it ever being remounted.
     * A label that promised "1 feed link" after navigating away would be worse
     * than no label at all.
     */
    function refreshAcquireLabel() {
      let linksCount = 0;
      try {
        linksCount = calendarLinks().length;
      } catch (error) {
        /* a page that will not let us look is a page with no links we can use */
      }

      acquireButton.textContent = acquireLabelFor(linksCount, collected.size);
      acquireHint.textContent = acquireHintFor(linksCount, collected.size);
    }

    // Cheap: `clientEvents` reads an in-memory list, it does not make a request.
    window.setInterval(() => {
      if (harvest().added > 0) {
        refreshCount();
        refreshAcquireLabel();
      }
    }, 1500);
    harvest();
    refreshCount();
    refreshAcquireLabel();
    hint.textContent = guidanceFor(document, currentCourseId());

    wrap.querySelector(".close").addEventListener("click", () => {
      setCollapsed(true);
    });

    function show(text, className) {
      out.hidden = false;
      out.value = text;
      out.select();
      copyButton.hidden = false;
      status.className = "note " + (className || "");
    }

    wrap.addEventListener("click", async (event) => {
      const button = event.target.closest("button.act");
      if (!button) return;

      const act = button.dataset.act;

      if (act === "copy") {
        const ok = await copy(out.value);
        button.textContent = ok ? "Copied" : "Press Ctrl+C to copy";
        setTimeout(() => {
          button.textContent = "Copy to clipboard";
        }, 2000);
        return;
      }

      if (act === "export") {
        const result = harvest();
        refreshCount();

        if (collected.size === 0) {
          status.className = "note warn";
          status.textContent = result.available
            ? "This page has a calendar but no events loaded yet — move through it first."
            : "No calendar on this page. Open the Calendar page and try again.";
          return;
        }

        const records = [...collected.values()];
        const withCourse = records.filter((record) => record.course).length;
        download(
          "huskyct-calendar.ics",
          recordsToIcs(records),
          "text/calendar;charset=utf-8",
        );

        status.className = "note ok";
        status.textContent =
          "Exported " + records.length + " events, " + withCourse + " with a course code.";
        hint.textContent =
          (result.added ? "Picked up " + result.added + " more just now. " : "") +
          "Drop huskyct-calendar.ics into BetterHuskyCT.";
        return;
      }

      if (act === "clear") {
        const total = collected.size;
        collected.clear();
        refreshCount();
        out.hidden = true;
        copyButton.hidden = true;
        status.className = "note";
        status.textContent = "Cleared " + total + " collected event(s).";
        return;
      }

      if (act === "course") {
        const digest = {
          course: collectCourse(document),
          announcements: collectAnnouncements(document),
          content: collectContentItems(document),
          files: collectCourseFiles(document),
          source: window.location.pathname,
        };
        const markdown = courseDigestToMarkdown(digest);

        if (!digest.announcements.length && !digest.content.length && !digest.files.length) {
          status.className = "note warn";
          status.textContent = "Nothing to collect on this page.";
          hint.textContent =
            "Open the course's Announcements page, or its Content page, then press this again.";
          return;
        }

        download("huskyct-course.md", markdown, "text/markdown;charset=utf-8");
        status.className = "note ok";
        status.textContent =
          "Collected " + digest.announcements.length + " announcement(s), " +
          digest.content.length + " content item(s), " + digest.files.length + " file(s).";
        hint.textContent =
          "Saved as huskyct-course.md. Nothing was requested from UConn — this reads the page you are looking at.";
        show(markdown, "ok");
        return;
      }

      if (act === "todos") {
        const todos = collectTodos(document);

        if (todos.length === 0) {
          status.className = "note warn";
          status.textContent = "No deadlines on this page.";
          hint.textContent =
            "The to-do list lives on the Courses page (the HuskyCT home). Open it, then press this again.";
          return;
        }

        const records = todosToRecords(todos);
        button.disabled = true;
        status.className = "note";

        // On a course page the announcements are already on screen, so they ride
        // along with the deadlines rather than needing the other button and a
        // second trip.
        const sendable = deadlinesAndAnnouncements(document);
        const announcements = sendable.announcements;

        status.textContent =
          "Sending " + records.length + " deadline(s)" +
          (announcements.length ? " and " + announcements.length + " announcement(s)" : "") +
          " to BetterHuskyCT…";

        try {
          const link = await huskypilotLink(records, undefined, announcements);

          // `window.open` returns null when the popup is blocked, and it does so
          // silently. The old code reported "Opened BetterHuskyCT" either way,
          // which is the worst possible answer: the user is told it worked, sees
          // no new tab, and has nothing to try next. Ask, and offer the link.
          const opened = window.open(link, "_blank", "noopener");

          if (opened) {
            status.className = "note ok";
            status.textContent =
              "Opened BetterHuskyCT with " + records.length + " deadline(s)" +
              (announcements.length ? " and " + announcements.length + " announcement(s)" : "") +
              ".";
            hint.textContent =
              "Press Apply there and they are in. Nothing was uploaded — the data travels inside the link.";
          } else {
            show(link, "warn");
            status.className = "note warn";
            status.textContent =
              "Your browser blocked the new tab, so nothing opened. The link is below — copy it and open it yourself.";
            hint.textContent =
              "Look for a popup-blocked icon in the address bar and allow popups for HuskyCT, or just paste the link.";
          }
        } catch (error) {
          status.className = "note warn";
          status.textContent = "Could not build the link: " + error.message;
        } finally {
          button.disabled = false;
        }
        return;
      }

      if (act === "acquire") {
        button.disabled = true;
        try {
          const result = await acquireCalendar({ status });

          if (!result.ok) {
            status.className = "note warn";
            status.textContent = result.message;
            if (result.detail) show(result.detail, "warn");
            return;
          }

          status.className = "note ok";
          status.textContent = result.message;
          hint.textContent = result.hint || "";
          refreshCount();
          refreshAcquireLabel();
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
      mergeCalendars,
      calendarLinks,
      calendarNameFor,
      planCalendarAcquisition,
      acquireCalendar,
      acquireLabelFor,
      acquireHintFor,
      kindFromSourceType,
      eventToRecord,
      recordsToIcs,
      utcStamp,
      currentCourseId,
      textOf,
      courseCodeFromDisplay,
      courseTitleFromDisplay,
      postedFromText,
      collectAnnouncements,
      collectContentItems,
      collectCourseFiles,
      collectCourse,
      announcementsToCandidates,
      deadlinesAndAnnouncements,
      courseDigestToMarkdown,
      todoFromLabel,
      dueDateFromText,
      collectTodos,
      todosToRecords,
      guidanceFor,
      taskFromRecord,
      syncPayload,
      huskypilotLink,
      collect: harvest,
      collected,
      VERSION,
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
