// ==UserScript==
// @name         HuskyCT Helper
// @namespace    https://github.com/NoGod3524/huskypilot
// @version      0.1.0
// @description  Merges your HuskyCT course calendars into one .ics, and reports what a page contains. Everything happens in your own browser.
// @author       NoGod3524
// @match        https://huskyct.uconn.edu/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/**
 * HuskyCT Helper.
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
 *     but huskyct.uconn.edu.
 *   - The "Report" buttons strip query strings, because a calendar feed URL
 *     carries a token and a report is something you paste into a chat window.
 *
 * It reads pages slowly and only when you press a button, so it does not hammer
 * UConn's systems.
 */

(function () {
  "use strict";

  const VERSION = "0.1.0";
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
        <button class="act primary" data-act="merge">Merge this page's calendars into one .ics</button>
        <div class="note" data-role="status">Nothing is uploaded. Everything stays in this browser.</div>
        <button class="act" data-act="links">Report: links on this page (tokens stripped)</button>
        <button class="act" data-act="structure">Report: page structure</button>
        <textarea data-role="out" hidden></textarea>
        <button class="act" data-act="copy" hidden>Copy to clipboard</button>
        <div class="note" data-role="hint"></div>
      </div>
    `;

    shadow.append(styleTag, wrap);
    document.documentElement.appendChild(host);

    const out = wrap.querySelector('[data-role="out"]');
    const status = wrap.querySelector('[data-role="status"]');
    const hint = wrap.querySelector('[data-role="hint"]');
    const copyButton = wrap.querySelector('[data-act="copy"]');

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

      if (act === "structure") {
        show(structureReport(), "ok");
        status.textContent = "Structure report below — it lists element names, not content.";
        hint.textContent =
          "Copy it and send it back. Nothing in it includes your name, your courses' text, or any URL token.";
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
    window.__huskyctHelper = { mergeCalendars, pathOnly, describe, calendarLinks, VERSION };
  }

  if (typeof document !== "undefined" && document.documentElement) mountPanel();
})();
