// ==UserScript==
// @name         HuskyCT Helper
// @namespace    https://github.com/NoGod3524/huskypilot
// @version      0.8.0
// @description  Merges your HuskyCT course calendars into one .ics, and reports what a page contains. Everything happens in your own browser.
// @author       NoGod3524
// @match        https://lms.uconn.edu/*
// @match        https://huskyct.uconn.edu/*
// @updateURL    https://raw.githubusercontent.com/NoGod3524/huskypilot/feat/huskyct-helper/tools/huskyct-helper/huskyct-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/NoGod3524/huskypilot/feat/huskyct-helper/tools/huskyct-helper/huskyct-helper.user.js
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
 * is a dozen links, and HuskyPilot can only take one at a time. This runs inside
 * the browser you are already signed in to, collects the feeds that browser can
 * already see, and writes them out as a single .ics.
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
  const VERSION = "0.8.0";
  const PANEL_WIDTH = 340;

  // ---------------------------------------------------------------- utilities

  /** `tag#id.class1.class2[role]`, with the class list capped. */
  function describe(element) {
    if (!element || element.nodeType !== 1) return "";
    let out = element.tagName.toLowerCase();
    if (element.id) out += "#" + element.id;
    const classes = (element.className && typeof element.className === "string"
      ? element.className
      : ""
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4);
    if (classes.length) out += "." + classes.join(".");
    const role = element.getAttribute("role");
    if (role) out += "[role=" + role + "]";
    return out;
  }

  /** UI labels are safe to report; arbitrary content is not. */
  function label(element) {
    const text = (element.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > 60 ? text.slice(0, 60) + "…" : text;
  }

  /**
   * A URL with its query string and fragment removed.
   *
   * This matters: a HuskyCT calendar feed is
   * `/webapps/calendar/calendar.ics?token=…`, and the token is a password. The
   * path alone is all that is needed to work out the pattern.
   */
  function pathOnly(href) {
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return url.origin + url.pathname;
      return url.pathname;
    } catch {
      return "(unparseable)";
    }
  }

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

  // ------------------------------------------------------- reporting the page

  function structureReport() {
    const lines = [];
    lines.push("# " + window.location.pathname);
    lines.push("# title: " + document.title);
    lines.push("# user agent: " + navigator.userAgent);
    lines.push("");

    // Landmarks and the containers that usually hold the interesting things.
    const interesting =
      "main, nav, aside, header, section, article, form, table, [role], " +
      "[data-testid], [class*='course'], [class*='content'], [class*='calendar'], " +
      "[class*='material'], [class*='file'], [class*='attach']";
    const seen = new Set();
    let count = 0;

    for (const element of document.querySelectorAll(interesting)) {
      const key = describe(element);
      if (seen.has(key) && !element.id) continue;
      seen.add(key);
      if (++count > 400) {
        lines.push("… truncated at 400 elements");
        break;
      }
      const depth = (function () {
        let d = 0;
        let node = element;
        while ((node = node.parentElement)) d += 1;
        return d;
      })();
      lines.push(
        "  ".repeat(Math.min(depth, 12)) + describe(element) + "  :: " + label(element),
      );
    }

    return lines.join("\n");
  }

  function linkReport() {
    const byPath = new Map();

    for (const anchor of document.querySelectorAll("a[href]")) {
      const path = pathOnly(anchor.getAttribute("href"));
      const entry = byPath.get(path) || { count: 0, labels: new Set() };
      entry.count += 1;
      const text = label(anchor);
      if (text && entry.labels.size < 2) entry.labels.add(text);
      byPath.set(path, entry);
    }

    const lines = ["# " + window.location.pathname, ""];
    for (const [path, entry] of [...byPath.entries()].sort()) {
      lines.push(
        `${String(entry.count).padStart(3)}x  ${path}` +
          (entry.labels.size ? "   // " + [...entry.labels].join(" | ") : ""),
      );
    }
    lines.push("");
    lines.push("# query strings and fragments were stripped on purpose:");
    lines.push("# a calendar feed URL carries a token, and this text is meant to be shared.");
    return lines.join("\n");
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
      "PRODID:-//HuskyPilot//HuskyCT Helper " + VERSION + "//EN",
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
        found.set(url.href, label(anchor) || url.pathname);
      } catch {
        /* not a URL we can use */
      }
    }
    return [...found.entries()];
  }

  // ------------------------------------------------- finding the data model

  /** JSON with long strings cut and functions dropped, so a report stays small. */
  function safeJson(value, indent) {
    const seen = new WeakSet();
    return JSON.stringify(
      value,
      function (key, item) {
        if (typeof item === "function") return "[function]";
        if (typeof item === "string") {
          return item.length > 80 ? item.slice(0, 80) + "…" : item;
        }
        if (item && typeof item === "object") {
          if (seen.has(item)) return "[seen]";
          seen.add(item);
        }
        return item;
      },
      indent,
    );
  }

  function attributeChain(element, levels) {
    const out = [];
    let node = element;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < (levels || 4)) {
      const attrs = [...node.attributes]
        .map((a) => a.name + "=" + (a.value.length > 50 ? a.value.slice(0, 50) + "…" : a.value))
        .join("  ");
      out.push("  ".repeat(depth) + node.tagName.toLowerCase() + (attrs ? "  [" + attrs + "]" : ""));
      node = node.parentElement;
      depth += 1;
    }
    return out.join("\n");
  }

  /**
   * Where does this page actually keep its calendar?
   *
   * The calendar is an AngularJS + FullCalendar app, so the events are almost
   * certainly already in a JavaScript model on the page. Reading that is both
   * more complete and far less brittle than scraping the rendered DOM — and it
   * is the only way to get the course code that the ICS feed leaves out.
   */
  function dataReport() {
    const lines = [];
    lines.push("# " + window.location.pathname);
    lines.push("");

    const jq = window.jQuery || window.$;
    lines.push("jQuery:  " + (jq ? "present " + (jq.fn && jq.fn.jquery) : "absent"));
    lines.push("angular: " + (window.angular ? "present" : "absent"));
    lines.push("");

    // 1. FullCalendar keeps its own event list.
    if (jq) {
      const containers = jq("#fullCalendar, .fullcalendar-container");
      lines.push("fullcalendar containers: " + containers.length);
      if (containers.length) {
        try {
          const events = jq(containers[0]).fullCalendar("clientEvents");
          lines.push("clientEvents: " + (events ? events.length : "returned nothing"));
          if (events && events.length) {
            lines.push("event keys: " + Object.keys(events[0]).sort().join(", "));
            lines.push("first event (strings cut at 80):");
            lines.push(safeJson(events[0], 2));
          }
        } catch (error) {
          lines.push("clientEvents threw: " + error.message);
        }
      }
      lines.push("");
    }

    // 2. The AngularJS scope, walked carefully and with a hard budget.
    if (window.angular) {
      lines.push("--- angular models ---");
      let visited = 0;
      const seen = new WeakSet();
      const found = [];

      function walk(scope, path, depth) {
        if (!scope || typeof scope !== "object") return;
        if (visited++ > 2000 || depth > 8) return;
        if (seen.has(scope)) return;
        seen.add(scope);

        let keys = [];
        try {
          keys = Object.keys(scope);
        } catch {
          return;
        }

        for (const key of keys) {
          if (key.charAt(0) === "$") continue;
          let value;
          try {
            value = scope[key];
          } catch {
            continue;
          }
          if (Array.isArray(value) && value.length && value[0] && typeof value[0] === "object") {
            found.push({
              path: path + "." + key,
              length: value.length,
              keys: Object.keys(value[0]).sort().join(", "),
              sample: safeJson(value[0], 0),
            });
          } else if (value && typeof value === "object" && !Array.isArray(value)) {
            walk(value, path + "." + key, depth + 1);
          }
        }

        walk(scope.$$childHead, path + ">child", depth + 1);
        walk(scope.$$nextSibling, path + ">sibling", depth);
      }

      const roots = document.querySelectorAll(
        ".page-base-calendar, #fullCalendar, [ng-controller], body",
      );
      for (const node of roots) {
        try {
          walk(window.angular.element(node).scope(), describe(node), 0);
        } catch {
          /* no scope on that node */
        }
        if (found.length > 40) break;
      }

      lines.push("scopes visited: " + visited + ", arrays found: " + found.length);
      for (const entry of found.slice(0, 25)) {
        lines.push("");
        lines.push("  " + entry.path + "   [" + entry.length + " items]");
        lines.push("    keys: " + entry.keys);
        lines.push("    first: " + entry.sample);
      }
      lines.push("");
    }

    // 3. The rendered elements, with their attributes and their parents'.
    lines.push("--- calendar event elements ---");
    const samples = document.querySelectorAll(
      ".fc-event, .month-scroll-content li, .calendar-week .event-dot",
    );
    lines.push("matched: " + samples.length);
    for (const node of [...samples].slice(0, 4)) {
      lines.push("");
      lines.push(attributeChain(node, 5));
      lines.push("  text: " + label(node));
    }

    return lines.join("\n");
  }

  // ------------------------------------------------------- collecting events

  /**
   * Pull the course code out of a Blackboard calendar name.
   *
   * `1268-UCONN-MATH-1070Q-SEC100-1191: MATH-1070Q-Mathematics for Business…`
   * is term, school, subject, number, section, id. Only the subject and number
   * are wanted, and the ICS feed never carries them at all.
   */
  function courseCodeFrom(name) {
    if (!name) return null;
    const head = String(name).split(":")[0];
    const parts = head.split("-");
    if (parts.length < 4) return null;

    const subject = parts[2];
    const number = parts[3];
    if (!/^[A-Z]{2,6}$/.test(subject)) return null;
    if (!/^\d{2,4}[A-Z]?$/.test(number)) return null;

    return subject + " " + number;
  }

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
      // The type stays in the UID on purpose: HuskyPilot reads it back to tell
      // a class meeting from an assignment, exactly as it does for a real feed.
      uid: type + "-" + sourceId + "-" + (utcStamp(start) || ""),
      title: raw.title || event.title || "Untitled",
      course: courseCodeFrom(name),
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
      "PRODID:-//HuskyPilot//HuskyCT Helper " + VERSION + "//EN",
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

  // --------------------------------------------------- what the page asks for

  /**
   * A record of the endpoints this page talks to.
   *
   * The Calendar page handed over its data through FullCalendar, but the course
   * pages are a different application entirely, and guessing at its markup is
   * how a script ends up silently doing nothing. Watching which paths the page
   * requests is evidence: once the endpoints are known, the data can be read
   * directly instead of scraped off the screen.
   *
   * Paths only. Query strings carry tokens, so they are dropped, and headers and
   * bodies are never touched.
   */
  const REQUEST_KEY = "huskypilot.helper.requests";

  function loadRequests() {
    try {
      const raw = sessionStorage.getItem(REQUEST_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  }

  const recorded = loadRequests();

  function recordRequest(method, url) {
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.origin !== window.location.origin) return;
      const entry = String(method || "GET").toUpperCase() + " " + parsed.pathname;
      if (recorded.has(entry)) return;
      recorded.add(entry);
      sessionStorage.setItem(REQUEST_KEY, JSON.stringify([...recorded]));
    } catch {
      /* not a URL we can make sense of */
    }
  }

  function installRecorder() {
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function (input, init) {
        try {
          const url = typeof input === "string" ? input : input && input.url;
          const method =
            (init && init.method) || (input && input.method) || "GET";
          recordRequest(method, url);
        } catch {
          /* never let bookkeeping break a request */
        }
        return originalFetch.apply(this, arguments);
      };
    }

    const open = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
    if (typeof open === "function") {
      window.XMLHttpRequest.prototype.open = function (method, url) {
        try {
          recordRequest(method, url);
        } catch {
          /* as above */
        }
        return open.apply(this, arguments);
      };
    }
  }

  function requestReport() {
    const lines = ["# " + window.location.pathname, ""];
    const entries = [...recorded].sort();

    if (entries.length === 0) {
      lines.push("(nothing recorded yet)");
      lines.push("");
      lines.push("# Open a course, then Announcements, then Course Content, and");
      lines.push("# press this again. The list fills up as you go.");
      return lines.join("\n");
    }

    for (const entry of entries) lines.push("  " + entry);
    lines.push("");
    lines.push("# " + entries.length + " distinct paths.");
    lines.push("# Query strings and fragments were stripped; headers and bodies are never read.");
    return lines.join("\n");
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
      // the same deadline into HuskyPilot twice.
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
        <button class="close" title="Hide">×</button>
      </header>
      <div class="body">
        <div class="note" data-role="count">Collected 0 events.</div>
        <button class="act primary" data-act="export">Export .ics</button>
        <div class="note">Stay on the Calendar page and move through the term — every view you open is added as you go. Then export and drop the file into HuskyPilot.</div>
        <button class="act" data-act="clear">Clear collected</button>
        <hr style="border:0;border-top:1px solid #e6eef8;margin:4px 0" />
        <button class="act" data-act="merge">Merge .ics links on this page</button>
        <button class="act" data-act="course">Collect this course: announcements + content</button>
        <button class="act" data-act="todos">Collect deadlines from this page (.ics)</button>
        <button class="act" data-act="links">Report: links on this page (tokens stripped)</button>
        <button class="act" data-act="structure">Report: page structure</button>
        <button class="act" data-act="data">Report: where the calendar data lives</button>
        <button class="act" data-act="requests">Report: what this page asks the server</button>
        <button class="act" data-act="forget">Clear recorded requests</button>
        <textarea data-role="out" hidden></textarea>
        <button class="act" data-act="copy" hidden>Copy to clipboard</button>
        <div class="note" data-role="status">Nothing is uploaded. Everything stays in this browser.</div>
        <div class="note" data-role="hint"></div>
      </div>
    `;

    shadow.append(styleTag, wrap);
    document.documentElement.appendChild(host);

    const out = wrap.querySelector('[data-role="out"]');
    const status = wrap.querySelector('[data-role="status"]');
    const hint = wrap.querySelector('[data-role="hint"]');
    const count = wrap.querySelector('[data-role="count"]');
    const copyButton = wrap.querySelector('[data-act="copy"]');

    function refreshCount() {
      const total = collected.size;
      count.textContent =
        total === 0
          ? "Collected 0 events."
          : "Collected " + total + " event" + (total === 1 ? "" : "s") + ".";
      count.className = total === 0 ? "note" : "note ok";
    }

    // Cheap: `clientEvents` reads an in-memory list, it does not make a request.
    window.setInterval(() => {
      if (harvest().added > 0) refreshCount();
    }, 1500);
    harvest();
    refreshCount();

    wrap.querySelector(".close").addEventListener("click", () => {
      host.remove();
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
          "huskyct-deadlines.ics",
          recordsToIcs(records),
          "text/calendar;charset=utf-8",
        );

        status.className = "note ok";
        status.textContent =
          "Exported " + records.length + " events, " + withCourse + " with a course code.";
        hint.textContent =
          (result.added ? "Picked up " + result.added + " more just now. " : "") +
          "Drop huskyct-deadlines.ics into HuskyPilot.";
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

      if (act === "structure") {
        show(structureReport(), "ok");
        status.textContent = "Structure report below — it lists element names, not content.";
        hint.textContent =
          "Copy it and send it back. Nothing in it includes your name, your courses' text, or any URL token.";
        return;
      }

      if (act === "data") {
        show(dataReport(), "ok");
        status.textContent = "Data-model report below — long text is cut at 80 characters.";
        hint.textContent =
          "Copy it and send it back. It says where the calendar keeps its events, not what they all are.";
        return;
      }

      if (act === "requests") {
        show(requestReport(), "ok");
        status.textContent = "Endpoint report below — paths only.";
        hint.textContent =
          "Copy it and send it back. No token can be in it: query strings are stripped and headers are never read.";
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
        download("huskyct-deadlines.ics", recordsToIcs(records), "text/calendar;charset=utf-8");

        const withCourse = todos.filter((todo) => todo.course).length;
        status.className = "note ok";
        status.textContent =
          "Exported " + records.length + " deadline(s), " + withCourse + " with a course code.";
        hint.textContent =
          "Saved as huskyct-deadlines.ics. Nothing was requested from UConn — this reads the page you are looking at.";
        show(
          todos
            .map((todo) => todo.dueText + "  " + (todo.course || "?") + "  " + todo.title)
            .join("\n"),
          "ok",
        );
        return;
      }

      if (act === "forget") {
        const total = recorded.size;
        recorded.clear();
        try {
          sessionStorage.removeItem(REQUEST_KEY);
        } catch {
          /* nothing to clear */
        }
        out.hidden = true;
        copyButton.hidden = true;
        status.className = "note";
        status.textContent = "Cleared " + total + " recorded path(s). Now open the pages you want mapped.";
        return;
      }

      if (act === "links") {
        show(linkReport(), "ok");
        status.textContent = "Link report below — query strings and fragments removed.";
        hint.textContent =
          "Copy it and send it back. Calendar tokens are deliberately not in it.";
        return;
      }

      if (act === "merge") {
        const links = calendarLinks();
        if (links.length === 0) {
          status.className = "note warn";
          status.textContent =
            "No .ics links on this page. Open a course's calendar settings, or use the report buttons.";
          show(
            "Found no calendar feed links here.\n\n" +
              "This button looks for links ending in .ics on the page you are on.\n" +
              "Press “Report: links on this page” and send that back if you expected some.",
            "warn",
          );
          return;
        }

        button.disabled = true;
        status.className = "note";
        status.textContent = `Reading ${links.length} calendar(s)…`;

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

        button.disabled = false;

        if (texts.length === 0) {
          status.className = "note warn";
          status.textContent = "Could not read any of them.";
          show(failed.join("\n"), "warn");
          return;
        }

        const merged = mergeCalendars("HuskyCT (merged)", texts);
        const eventCount = (merged.match(/BEGIN:VEVENT/g) || []).length;
        download("huskyct-merged.ics", merged, "text/calendar;charset=utf-8");

        status.className = "note ok";
        status.textContent = `Merged ${texts.length} calendar(s), ${eventCount} events. Check your downloads.`;
        hint.textContent = failed.length
          ? "Could not read: " + failed.join(", ")
          : "Drop huskyct-merged.ics into HuskyPilot.";
      }
    });
  }

  // The pieces worth exercising outside a browser. Attached for the test suite;
  // harmless in the page, and it is how the merge is checked against real
  // calendar text rather than trusted because it looks right.
  if (typeof window !== "undefined") {
    window.__huskyctHelper = {
      mergeCalendars,
      pathOnly,
      describe,
      calendarLinks,
      courseCodeFrom,
      kindFromSourceType,
      eventToRecord,
      recordsToIcs,
      utcStamp,
      recordRequest,
      requestReport,
      recorded,
      currentCourseId,
      textOf,
      courseCodeFromDisplay,
      courseTitleFromDisplay,
      postedFromText,
      collectAnnouncements,
      collectContentItems,
      collectCourseFiles,
      collectCourse,
      courseDigestToMarkdown,
      todoFromLabel,
      dueDateFromText,
      collectTodos,
      todosToRecords,
      collect: harvest,
      collected,
      VERSION,
    };
  }

  // At document-start, so nothing the page loads escapes the recorder.
  installRecorder();

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountPanel, { once: true });
    } else {
      mountPanel();
    }
  }
})();
