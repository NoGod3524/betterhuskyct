import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

import { chipStyle, colorKey, courseColor, mergeCourseColors, parseCourseColors } from "../src/lib/course-colors.ts";
import { buildSyncPayload, parseSyncPayload, serialiseSyncPayload } from "../src/lib/sync.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";

/**
 * Each course's colour: read off HuskyCT's course cards by the helper, carried with the
 * deadlines, and used for the course here.
 */
const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");

type Helper = {
  readCourseColors: (root: unknown) => Record<string, string>;
  readColors: (storage: unknown) => Record<string, string>;
  colorsByCode: (storage: unknown, basket: unknown) => Record<string, string>;
  COLORS_KEY: string;
  sendTasksToBhc: (target: unknown, basket: unknown, opts?: Record<string, unknown>) => Promise<{ connected: boolean; stored: boolean }>;
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

function helperOn(html: string) {
  const window = new Window({ url: "https://lms.uconn.edu/ultra/stream" });
  windows.push(window);
  window.document.body.innerHTML = html;
  (window as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error("no network in tests"));
  window.localStorage.setItem("huskypilot.helper.sync.v1", JSON.stringify({ auto: false }));
  const sandbox = { window, document: window.document, navigator: window.navigator, localStorage: window.localStorage, Blob, CompressionStream, Response, TextEncoder, btoa, URL, console, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { window, helper: (window as unknown as { __huskyctHelper: Helper }).__huskyctHelper };
}

const card = (id: string, inner: string) => `<article class="element-card course-element-card" data-course-id="${id}">${inner}<h4>Course ${id}</h4></article>`;
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("a card's colour is its most vivid one, whether a background, a gradient or a drawing; a grey card has none", () => {
  const { window, helper } = helperOn(
    card("_1_1", `<div style="background-color: rgb(255, 255, 255)"><div style="background-color: rgb(30, 110, 200)"></div></div>`) +
      card("_2_1", `<div style="background-image: linear-gradient(rgb(200, 40, 60), rgb(245, 245, 245))"></div>`) +
      card("_3_1", `<div style="background-color: rgb(240, 240, 240)"><p style="background-color: #222222">x</p></div>`) +
      card("_4_1", `<svg><rect style="fill: rgb(40, 160, 90)" width="10" height="10"></rect></svg>`) +
      card("", `<div style="background-color: rgb(30, 110, 200)"></div>`),
  );

  assert.deepEqual(plain(helper.readCourseColors(window.document)), { _1_1: "#1e6ec8", _2_1: "#c8283c", _4_1: "#28a05a" });
});

test("colours are kept by course id, and go out by course code for the courses in the basket", () => {
  const { window, helper } = helperOn("");
  window.localStorage.setItem(helper.COLORS_KEY, JSON.stringify({ _1_1: "#1E6EC8", _2_1: "#c8283c", bad: "#ffffff", _3_1: "red" }));

  assert.deepEqual(plain(helper.readColors(window.localStorage)), { _1_1: "#1e6ec8", _2_1: "#c8283c" });
  const basket = { courses: [{ id: "_1_1", code: "MATH 1070Q" }, { id: "_2_1", code: null }, { id: "_9_1", code: "ECON 1201" }] };
  assert.deepEqual(plain(helper.colorsByCode(window.localStorage, basket)), { "MATH 1070Q": "#1e6ec8" });
});

test("the deadlines sent to BetterHuskyCT carry the colours", async () => {
  const { window, helper } = helperOn("");
  window.localStorage.setItem(helper.COLORS_KEY, JSON.stringify({ _1_1: "#1e6ec8" }));
  const basket = { version: 1, courses: [{ id: "_1_1", code: "MATH 1070Q", announcements: [], announcementsAt: null }], todos: [], todosAt: null };
  const sent: { payload: Record<string, unknown> | null } = { payload: null };
  const target = {
    postMessage(message: { protocol: string; kind: string; payload?: Record<string, unknown> }) {
      if (message.kind === "sync") sent.payload = message.payload ?? null;
      const answer = message.kind === "hello" ? { protocol: message.protocol, kind: "ready" } : message.kind === "sync" ? { protocol: message.protocol, kind: "stored", ok: true } : null;
      if (answer) setTimeout(() => window.dispatchEvent(new window.MessageEvent("message", { data: answer, origin: "https://betterhuskyct.vercel.app" })), 0);
    },
  };

  await helper.sendTasksToBhc(target, basket, { connectTimeout: 2000, storedTimeout: 2000 });

  assert.ok(sent.payload, "nothing was sent");
  assert.deepEqual(plain(sent.payload.courseColors), { "MATH 1070Q": "#1e6ec8" });
});

test("on this side, colours are read leniently and keyed so one course is one course", () => {
  assert.equal(colorKey("MATH 1070Q"), colorKey("math-1070q"));
  assert.deepEqual(parseCourseColors({ "MATH 1070Q": "#1E6EC8", "ECON 1201": "blue", "": "#000000", x: 3 }), { MATH1070Q: "#1e6ec8" });
  assert.deepEqual(parseCourseColors(null), {});
  assert.equal(courseColor(parseCourseColors({ "MATH 1070Q": "#1e6ec8" }), "MATH-1070Q"), "#1e6ec8");
  assert.equal(courseColor({}, "MATH 1070Q"), null);
  assert.deepEqual(mergeCourseColors({ MATH1070Q: "#111111", ECON1201: "#222222" }, { MATH1070Q: "#333333" }), { MATH1070Q: "#333333", ECON1201: "#222222" });
  assert.match(String(chipStyle("#1e6ec8").backgroundColor), /color-mix\(in srgb, #1e6ec8/);
});

test("a sync payload keeps the colours through a link, and one from before them reads as none", () => {
  const payload = buildSyncPayload({ feeds: [], completedIds: [], courses: EMPTY_COURSE_BOOK, courseColors: { MATH1070Q: "#1e6ec8" } });
  assert.deepEqual(parseSyncPayload(serialiseSyncPayload(payload))?.courseColors, { MATH1070Q: "#1e6ec8" });

  const older = JSON.parse(serialiseSyncPayload(payload));
  delete older.courseColors;
  assert.deepEqual(parseSyncPayload(JSON.stringify(older))?.courseColors, {});
});
