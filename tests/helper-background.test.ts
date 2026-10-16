import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";
import { Window } from "happy-dom";

import { parseGradesSnapshot, type GradesSnapshot } from "../src/lib/grades.ts";
import { parseMaterialsIndex, type MaterialsIndex } from "../src/lib/materials.ts";
import { parseSyncPayloadValue } from "../src/lib/sync.ts";
import type { ReadReport } from "../src/lib/sync-status.ts";

const HELPER = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");
const OFFSCREEN = readFileSync(new URL("../tools/extension/offscreen.js", import.meta.url), "utf8");
const PROTOCOL = "betterhuskyct/background@1";
const EXTENSION = "abcdefghijklmnopabcdefghijklmnop";
const NOW = new Date(2026, 9, 16, 12).valueOf();
const PRIMARY = "_100_1", SECONDARY = "_200_1";
const windows: Window[] = [];
after(async () => { for (const window of windows) await window.happyDOM.close(); });

type Reply = { ok: false; reason: string } | { ok: true; snapshot: {
  version: number; revision: string; at: string; tasks: unknown;
  grades: GradesSnapshot | null; materials: MaterialsIndex | null; status: ReadReport;
}; basket: unknown; colors: Record<string, string> };
type Sender = { id: string; tab?: { id: number } };
type Receiver = (message: unknown, sender: Sender, response: (value: Reply) => void) => boolean;
type Options = { fail?: (path: string) => number | undefined; empty?: boolean; asPage?: boolean; large?: boolean; loading?: boolean };

function load(options: Options = {}) {
  const window = new Window({ url: options.asPage ? "https://lms.uconn.edu/ultra/stream" : `chrome-extension://${EXTENSION}/offscreen.html` });
  windows.push(window);
  window.localStorage.setItem("huskypilot.helper.sync.v1", JSON.stringify({ auto: false }));
  const localBefore = window.localStorage.length;
  let clock = NOW;
  class Clock extends Date {
    constructor(...args: ConstructorParameters<DateConstructor> | []) {
      if (args.length === 0) super(clock);
      else super(...(args as ConstructorParameters<DateConstructor>));
    }
    static now() { return clock; }
  }
  const requests: Array<{ url: string; credentials: RequestCredentials | undefined }> = [];
  const membership = (id: string, code: string) => ({ courseId: id, isAvailable: true,
    course: { id, courseId: "1268-UCONN-" + code, displayName: code + "-Course-SEC001-1268", effectiveAvailability: true }, courseCardColorIndex: 0 });
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  window.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    assert.ok(url.startsWith("https://lms.uconn.edu/learn/api/v1/"), "a file, HTML page or other origin was fetched: " + url);
    requests.push({ url, credentials: init?.credentials });
    clock += 1000;
    const path = new URL(url).pathname;
    const failure = options.fail?.(path);
    if (failure) return answer({}, failure);
    if (path.endsWith("/memberships")) return answer({ paging: { count: 2 }, results: [membership(PRIMARY, "MATH-1070Q"), membership(SECONDARY, "ECON-1201")] });
    if (path.endsWith("/calendarItems")) return answer({ results: options.empty ? [] : [{ id: "calendar-one", itemSourceType: "GradableItem", itemSourceId: "_501_1", calendarId: PRIMARY,
      title: "Homework 4", endDate: "2026-10-20T12:00:00.000Z", calendarNameLocalizable: { rawValue: "MATH-1070Q-Course-SEC001-1268" } }] });
    if (path.endsWith("/studentItems")) return answer({ overdueItems: [], dueTodayItems: [], futureDueItems: options.empty ? [] : [{
      title: "Homework 4", dueDate: "2026-10-20T12:00:00.000Z", column: { id: "_501_1", courseId: PRIMARY },
    }] });
    if (path.endsWith("/users/me")) return answer({ id: "_999_1" });
    if (path.endsWith("/announcements")) return answer({ results: options.empty ? [] : [{ id: "_601_1", title: "Course schedule",
      body: { displayText: "<p>The seminar is <strong>Monday</strong>.</p><script>ignored</script>" }, startDateRestriction: "2026-10-15T12:00:00.000Z" }] });
    if (path.endsWith("/gradebook/grades")) return answer({ paging: { count: options.empty ? 0 : 1 }, results: options.empty ? [] : [{
      columnId: "_501_1", column: { id: "_501_1", effectiveColumnName: "Homework 4" }, status: "GRADED", displayGrade: { score: 90 }, pointsPossible: 100,
    }] });
    if (path.endsWith("/ROOT/children")) {
      const rows = options.empty ? [] : Array.from({ length: options.large ? 3000 : 1 }, (_, index) => ({
        id: `_${700 + index}_1`, title: options.large ? "名".repeat(400) : "Week 3 notes.pdf", contentHandler: "resource/x-bb-file",
        contentDetail: { "resource/x-bb-file": { file: { permanentUrl: "https://lms.uconn.edu/bbcswebdav/" + (options.large ? "x".repeat(900) : "course/") + index + "/notes.pdf" } } },
      }));
      return answer({ results: rows });
    }
    throw new Error("Unexpected API: " + path);
  }) as unknown as typeof window.fetch;
  window.open = (() => { throw new Error("background collection must not open a window"); }) as typeof window.open;
  let receiver: Receiver | undefined;
  const heartbeats: unknown[] = [];
  const intervals = new Map<object, () => void>();
  const runtime = {
    id: EXTENSION,
    onMessage: { addListener: (listener: Receiver) => { receiver = listener; } },
    sendMessage: async (message: unknown) => { heartbeats.push(message); },
  };
  const chrome = new Proxy({ runtime }, { get: (target, key) => {
    assert.equal(key, "runtime", "offscreen used an unavailable chrome API");
    return target.runtime;
  } });
  if (options.loading) Object.defineProperty(window.document, "readyState", { configurable: true, value: "loading" });
  const context = vm.createContext({ window, document: window.document, navigator: window.navigator, chrome, Date: Clock,
    URL, Response, TextEncoder, crypto: webcrypto, setTimeout, clearTimeout,
    setInterval: (run: () => void) => { const id = {}; intervals.set(id, run); return id; },
    clearInterval: (id: object) => intervals.delete(id), console,
  });
  vm.runInContext(OFFSCREEN, context);
  vm.runInContext(HELPER, context);
  const request = (extra: Record<string, unknown> = {}, sender: Sender = { id: EXTENSION }) => new Promise<Reply | undefined>((resolve) => {
    assert.ok(receiver);
    if (!receiver({ protocol: PROTOCOL, target: "offscreen", kind: "run", ...extra }, sender, resolve)) resolve(undefined);
  });
  const run = async (extra: Record<string, unknown> = {}) => {
    const result = await request(extra);
    assert.ok(result);
    return result;
  };
  return { window, requests, request, run, localBefore, heartbeats, intervals };
}

function success(reply: Reply) {
  assert.ok(reply.ok, JSON.stringify(reply));
  return reply;
}

test("the packaged offscreen page uses external scripts in configuration-before-helper order", () => {
  const html = readFileSync(new URL("../tools/extension/offscreen.html", import.meta.url), "utf8");
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"[^>]*>\s*<\/script>/g)].map((match) => match[1]), ["offscreen.js", "huskyct-helper.js"]);
  assert.equal((html.match(/<script/g) ?? []).length, 2, "an inline or unexpected script was packaged");
});

test("the same helper collects API metadata headlessly with include credentials and one stable snapshot time", async () => {
  const env = load();
  const result = success(await env.run({ colors: { _800_1: "#123456" } }));
  assert.equal(result.snapshot.version, 1);
  assert.match(result.snapshot.revision, /^[\da-f-]{36}$/i);
  assert.equal(result.snapshot.at, new Date(NOW).toISOString());
  const tasks = parseSyncPayloadValue(result.snapshot.tasks);
  assert.ok(tasks);
  assert.equal(tasks.exportedAt, result.snapshot.at);
  assert.equal(tasks.feeds[0].events.length, 1, "Calendar and To Do identities diverged");
  assert.equal((tasks.feeds[0].events[0] as { sourceCourseId?: string }).sourceCourseId, PRIMARY);
  assert.equal(tasks.announcements[0].body, "The seminar is Monday.");
  assert.equal(result.snapshot.grades?.takenAt, result.snapshot.at);
  assert.ok(parseGradesSnapshot(result.snapshot.grades));
  assert.equal(result.snapshot.materials?.updatedAt, result.snapshot.at);
  assert.ok(parseMaterialsIndex(result.snapshot.materials));
  assert.equal(result.snapshot.materials?.courses[0].files[0].title, "Week 3 notes.pdf");
  assert.deepEqual(JSON.parse(JSON.stringify(result.snapshot.status)), { dueDates: true, todo: true, courses: [PRIMARY, SECONDARY].map((id) => ({
    id, code: id === PRIMARY ? "MATH 1070Q" : "ECON 1201", announcements: true, grades: true, files: true,
  })) });
  assert.ok(env.requests.every((request) => request.credentials === "include"));
  assert.equal(env.window.document.querySelector("#huskypilot-helper"), null);
  assert.equal(env.window.localStorage.length, env.localBefore, "offscreen persisted course content in DOM localStorage");
  assert.equal(result.colors._800_1, "#123456");
  assert.equal(env.intervals.size, 0, "the run left a heartbeat behind");
});

test("a successful empty source is retained as an explicit course baseline", async () => {
  const result = success(await load({ empty: true }).run());
  assert.equal(parseSyncPayloadValue(result.snapshot.tasks)?.announcements.length, 0);
  assert.equal(result.snapshot.grades?.courses.length, 2);
  assert.equal(result.snapshot.grades?.courses[0].items.length, 0);
  assert.equal(result.snapshot.materials?.courses.length, 2);
  assert.equal(result.snapshot.materials?.courses[0].files.length, 0);
  assert.ok(result.snapshot.status.courses.every((course) => course.announcements && course.grades && course.files));
});

test("partial API failures are marked missed and omit failed courses rather than reporting empty data", async () => {
  const result = success(await load({ fail: (path) => path.includes(PRIMARY + "/gradebook") || path.includes(SECONDARY + "/contents") ? 500 : undefined }).run());
  assert.deepEqual(Array.from(result.snapshot.grades?.courses ?? [], (course) => course.id), [SECONDARY]);
  assert.deepEqual(Array.from(result.snapshot.materials?.courses ?? [], (course) => course.id), [PRIMARY]);
  assert.equal(result.snapshot.status.courses[0].grades, false);
  assert.equal(result.snapshot.status.courses[1].files, false);
});

test("successful optional sources survive when every announcement and gradebook fails", async () => {
  const env = load({ fail: (path) => path.endsWith("/announcements") || path.endsWith("/gradebook/grades") ? 500 : undefined });
  const result = success(await env.run());
  assert.equal(result.snapshot.grades, null, "failed grades were represented as an empty reading");
  assert.equal(parseSyncPayloadValue(result.snapshot.tasks)?.feeds[0].events.length, 1);
  assert.ok(result.snapshot.materials);
  assert.ok(result.snapshot.status.courses.every((course) => !course.announcements && !course.grades && course.files));
  const failed = await load({ fail: () => 500 }).run();
  assert.equal(failed.ok, false);
  assert.ok(!failed.ok);
  assert.equal(failed.reason, "failed");
});

test("a source-less retained deadline stays source-less rather than guessing its course identity", async () => {
  const old = { uid: "old-calendar", title: "Older homework", course: "MATH 1070Q", courseId: null,
    start: "2026-10-17T12:00:00.000Z", end: null, allDay: false, kind: "assignment" };
  const result = success(await load({ fail: (path) => path.endsWith("/calendarItems") || path.endsWith("/studentItems") ? 500 : undefined }).run({ basket: {
    version: 1, courses: [], todos: [old], todosAt: new Date(NOW).toISOString(), dueDates: [], dueDatesAt: null,
  } }));
  const tasks = parseSyncPayloadValue(result.snapshot.tasks);
  assert.ok(tasks);
  assert.equal(tasks.feeds[0].events[0].id, "old-calendar:" + old.start);
  assert.equal((tasks.feeds[0].events[0] as { sourceCourseId?: string }).sourceCourseId, undefined);
  assert.equal(result.snapshot.status.dueDates, false);
  assert.equal(result.snapshot.status.todo, false);
});

test("401 at every stage stops the entire run without issuing another API request", async () => {
  for (const stage of ["/memberships", "/calendarItems", "/studentItems", "/users/me", "/announcements", "/gradebook/grades", "/ROOT/children"]) {
    const env = load({ fail: (path) => path.endsWith(stage) ? 401 : undefined });
    assert.deepEqual(JSON.parse(JSON.stringify(await env.run())), { ok: false, reason: "signedout" }, stage);
    assert.ok(env.requests.at(-1)?.url.split("?")[0].endsWith(stage), stage);
    assert.equal(env.requests.filter(({ url }) => url.split("?")[0].endsWith(stage)).length, 1, stage);
  }
});

test("a new explicit run may succeed after a previous session failure", async () => {
  let expired = true;
  const env = load({ fail: () => expired ? 401 : undefined });
  assert.equal((await env.run()).ok, false);
  expired = false;
  assert.equal((await env.run()).ok, true);
});

test("offscreen rejects content-tab messages and shares concurrent runs until the helper is ready", async () => {
  const env = load({ loading: true });
  assert.equal(await env.request({}, { id: EXTENSION, tab: { id: 1 } }), undefined);
  assert.equal(await env.request({}, { id: "someone-else" }), undefined);
  assert.equal(await env.request({ target: "background" }), undefined);
  const first = env.run();
  const second = env.run();
  assert.equal(env.requests.length, 0);
  for (const beat of env.intervals.values()) beat();
  assert.deepEqual(JSON.parse(JSON.stringify(env.heartbeats)), [{ protocol: PROTOCOL, target: "background", kind: "heartbeat" }]);
  env.window.document.dispatchEvent(new env.window.Event("DOMContentLoaded"));
  const [a, b] = (await Promise.all([first, second])).map(success);
  assert.equal(a.snapshot.revision, b.snapshot.revision);
  assert.equal(env.requests.filter(({ url }) => url.includes("/memberships")).length, 1);
});

test("input and output snapshots are bounded by UTF-8 JSON bytes", async () => {
  const input = load();
  assert.deepEqual(JSON.parse(JSON.stringify(await input.run({ basket: { oversized: "名".repeat(3 * 1024 * 1024) } }))), { ok: false, reason: "too-large" });
  assert.equal(input.requests.length, 0);
  const output = await load({ large: true }).run();
  assert.equal(output.ok, false);
  assert.ok(!output.ok);
  assert.equal(output.reason, "too-large");
});

test("a webpage cannot enable headless collection or change its normal credentials through a global", async () => {
  const env = load({ asPage: true });
  const result = success(await env.run());
  assert.equal(result.snapshot.grades?.courses.length, 2);
  assert.ok(env.requests.every((request) => request.credentials === "same-origin"));
  assert.ok(env.window.document.querySelector("#huskypilot-helper"));
});
