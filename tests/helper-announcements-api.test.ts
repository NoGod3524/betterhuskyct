import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";
import { onlyAtHuskyct } from "./support/huskyct-fetch.ts";

/**
 * Announcements read from HuskyCT's own data, shaped as the page's requests were
 * recorded on 2026-10-04: a page of `results` with `paging.nextPage` as a path.
 */
const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");

type Row = { title: string; body: string; posted: string | null };
type Helper = {
  readAnnouncementsApi: (courseId: string, options?: Record<string, unknown>) => Promise<Row[] | null>;
  postedText: (iso: string) => string | null;
  htmlToText: (html: string) => string;
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

/** A page whose `fetch` answers from `serve`, and a log of every address it was asked for. */
function openPage(serve: (path: string) => unknown | null) {
  const window = new Window({ url: "https://lms.uconn.edu/ultra/stream" });
  onlyAtHuskyct(window);
  windows.push(window);
  const asked: Array<{ path: string; init: Record<string, unknown> }> = [];
  (window as unknown as { fetch: unknown }).fetch = async (path: string, init: Record<string, unknown>) => {
    asked.push({ path, init });
    const answer = serve(path);
    return answer === null
      ? new Response("{}", { status: 404 })
      : new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  };
  const sandbox = {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
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
  window.localStorage.setItem("huskypilot.helper.sync.v1", JSON.stringify({ auto: false }));
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { window, helper: (window as unknown as { __huskyctHelper: Helper }).__huskyctHelper, asked };
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const item = (title: string, html: string, startDateRestriction: string, extra: Record<string, unknown> = {}) => ({
  id: "_" + title.length + "_1",
  title,
  body: { rawText: html, displayText: html },
  startDateRestriction,
  isDraft: false,
  readStatus: { isRead: true },
  ...extra,
});

const FIRST = "/learn/api/v1/courses/_203765_1/announcements?limit=50&offset=0&sort=startDateRestriction(desc)";

test("the announcements are asked for as the page asks, with the student's own session, and read in full", async () => {
  const { helper, asked } = openPage((path) =>
    path === FIRST
      ? { paging: { nextPage: "" }, results: [item("Exam moved", "<p>The exam is <b>Friday</b> &amp; online.</p>", "2026-09-25T20:00:00.000Z")] }
      : null,
  );

  const rows = plain(await helper.readAnnouncementsApi("_203765_1"));

  assert.equal(asked.length, 1);
  assert.equal(asked[0].path, FIRST);
  assert.equal(asked[0].init.credentials, "same-origin");
  assert.equal(rows?.length, 1);
  assert.equal(rows?.[0].title, "Exam moved");
  assert.equal(rows?.[0].body, "The exam is Friday & online.", "the HTML was not turned into its text");
});

test("every page is followed through paging.nextPage, and a draft is left out", async () => {
  const second = "/learn/api/v1/courses/_203765_1/announcements?limit=50&sort=startDateRestriction(desc)&offset=50";
  const { helper, asked } = openPage((path) => {
    if (path === FIRST) return { paging: { nextPage: second }, results: [item("One", "a", "2026-09-25T20:00:00.000Z"), item("Secret draft", "b", "2026-09-24T20:00:00.000Z", { isDraft: true })] };
    if (path === second) return { paging: { nextPage: "" }, results: [item("Two", "c", "2026-09-20T20:00:00.000Z")] };
    return null;
  });

  const rows = plain(await helper.readAnnouncementsApi("_203765_1"));

  assert.deepEqual(rows?.map((row) => row.title), ["One", "Two"]);
  assert.deepEqual(asked.map((call) => call.path), [FIRST, second]);
});

test("an address the answer names outside HuskyCT's own data is never followed", async () => {
  const { helper, asked } = openPage((path) =>
    path === FIRST ? { paging: { nextPage: "https://evil.example/steal?x=1" }, results: [item("One", "a", "2026-09-25T20:00:00.000Z")] } : null,
  );

  const rows = plain(await helper.readAnnouncementsApi("_203765_1"));

  assert.equal(rows?.length, 1);
  assert.equal(asked.length, 1, "a request went to an address the answer named");
});

test("a course with no announcements is an empty list, not a failure", async () => {
  const { helper } = openPage((path) => (path === FIRST ? { paging: { nextPage: "" }, results: [] } : null));

  assert.deepEqual(plain(await helper.readAnnouncementsApi("_203765_1")), []);
});

test("an answer that is refused, or not a list, gives null so the page is read instead", async () => {
  assert.equal(await openPage(() => null).helper.readAnnouncementsApi("_203765_1"), null);
  assert.equal(await openPage(() => ({ unexpected: true })).helper.readAnnouncementsApi("_203765_1"), null);

  const { window, helper } = openPage(() => null);
  (window as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error("offline"));
  assert.equal(await helper.readAnnouncementsApi("_203765_1"), null);
});

test("the posted time reads as the Announcements page writes it, so an announcement keeps one id", () => {
  const { helper } = openPage(() => null);
  const text = helper.postedText("2026-09-25T20:00:00.000Z");

  // "9/25/26, 4:00 PM" in the viewer's own time, with plain spaces.
  assert.match(String(text), /^\d{1,2}\/\d{1,2}\/26, \d{1,2}:\d{2} [AP]M$/);
  assert.equal(helper.postedText("not a time"), null);
});

test("HTML is read as text in a document of its own, so a script or handler in it never runs", () => {
  const { window, helper } = openPage(() => null);
  (window as unknown as { pwned?: boolean }).pwned = false;

  const text = helper.htmlToText(`<img src="x" onerror="window.pwned=true"><script>window.pwned=true</script><p>Hello</p>`);

  assert.equal(text, "Hello");
  assert.equal((window as unknown as { pwned: boolean }).pwned, false);
});
