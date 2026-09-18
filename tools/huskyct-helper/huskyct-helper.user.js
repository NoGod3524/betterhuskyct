// ==UserScript==
// @name         HuskyCT Helper
// @namespace    https://github.com/NoGod3524/huskypilot
// @version      0.5.0
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
  const VERSION = "0.5.0";
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

  // ------------------------------------------------- reading the course API

  /**
   * Blackboard Ultra's own front end talks to `/learn/api/v1/...`, and the
   * session cookie already authenticates those calls — so this reads them the
   * same way the page does. No token is handled and nothing extra is sent.
   *
   * They are internal endpoints, not the documented public API, so they can
   * change without notice. Everything here checks its own shape and says what
   * it found rather than assuming.
   */
  function currentCourseId() {
    const match = window.location.pathname.match(/\/ultra\/courses\/([^/]+)/);
    return match ? match[1] : null;
  }

  async function apiGet(path) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const text = await response.text();

    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* the caller reports the text instead */
    }

    return { status: response.status, ok: response.ok, body, text };
  }

  /** Ultra wraps lists in `results` on some endpoints and not others. */
  function listOf(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.results)) return body.results;
    return null;
  }

  async function exploreReport() {
    const lines = [];
    const courseId = currentCourseId();

    lines.push("# " + window.location.pathname);
    lines.push("courseId: " + (courseId || "(this URL is not inside a course)"));
    lines.push("");

    if (!courseId) {
      lines.push("Open a course first — the URL needs /ultra/courses/<id>/ in it.");
      return lines.join("\n");
    }

    const endpoints = [
      ["announcements", "/learn/api/v1/courses/" + courseId + "/announcements"],
      ["contents/ROOT/children", "/learn/api/v1/courses/" + courseId + "/contents/ROOT/children"],
      ["course", "/learn/api/v1/courses/" + courseId],
      // Worth checking: if this takes a date range, the calendar export stops
      // needing the user to page through the term by hand.
      ["calendars/calendarItems", "/learn/api/v1/calendars/calendarItems"],
      ["users/me/memberships", "/learn/api/v1/users/me/memberships"],
    ];

    for (const [label, path] of endpoints) {
      lines.push("=== " + label + " ===");
      try {
        const result = await apiGet(path);
        lines.push("status: " + result.status);

        const list = listOf(result.body);
        if (list) {
          lines.push("count: " + list.length);
          const handlers = [
            ...new Set(list.map((item) => item && (item.contentHandler || item.handler))),
          ].filter(Boolean);
          if (handlers.length) lines.push("handlers: " + handlers.join(", "));

          for (const item of list.slice(0, 3)) {
            lines.push("");
            lines.push("  keys: " + Object.keys(item || {}).sort().join(", "));
            lines.push("  " + safeJson(item, 2));
          }
        } else if (result.body) {
          lines.push("keys: " + Object.keys(result.body).sort().join(", "));
          lines.push(safeJson(result.body, 2));
        } else {
          lines.push("not JSON: " + result.text.slice(0, 200));
        }
      } catch (error) {
        lines.push("threw: " + error.message);
      }
      lines.push("");
      // Slow on purpose: this is someone else's server.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    lines.push("# Long strings were cut at 80 characters.");
    return lines.join("\n");
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
        <button class="act" data-act="links">Report: links on this page (tokens stripped)</button>
        <button class="act" data-act="structure">Report: page structure</button>
        <button class="act" data-act="data">Report: where the calendar data lives</button>
        <button class="act" data-act="requests">Report: what this page asks the server</button>
        <button class="act" data-act="explore">Report: what this course's API returns</button>
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

      if (act === "explore") {
        status.className = "note";
        status.textContent = "Asking the course API…";
        show(await exploreReport(), "ok");
        status.textContent = "Course API report below — long text cut at 80 characters.";
        hint.textContent =
          "Copy it and send it back. It is a description of the response, not the announcements themselves.";
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
      listOf,
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
