import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

/**
 * The API recorder writes down what HuskyCT's own page asks its server for, so
 * the helper can later read those answers directly. The one thing that must
 * hold is that it keeps structure and nothing else: a score, a title, a name or
 * a token must not come out of it.
 */
const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");

type Helper = {
  apiPathOf: (href: string) => string | null;
  shapeOf: (value: unknown, key: string, depth: number) => unknown;
  startApiRecorder: () => { finish: () => { count: number; text: string } };
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

function openPage(): { window: Window; helper: Helper } {
  const window = new Window({ url: "https://lms.uconn.edu/ultra/courses/_203765_1/grades" });
  windows.push(window);
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
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { window, helper: (window as unknown as { __huskyctHelper: Helper }).__huskyctHelper };
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("an address keeps its path with ids made generic, and its query only by name", () => {
  const { helper } = openPage();

  assert.equal(
    helper.apiPathOf("/learn/api/v1/courses/_203765_1/gradebook/columns/_3876639_1?expand=attempts&access_token=SECRET123&userId=_42_1"),
    "/learn/api/v1/courses/_N_N/gradebook/columns/_N_N?expand=attempts&access_token=…&userId=…",
  );
  assert.equal(helper.apiPathOf("https://lms.uconn.edu/learn/api/v1/users/me"), "/learn/api/v1/users/me");
  assert.equal(helper.apiPathOf("/x/0f8fad5b-d9cb-469f-a165-70867728950e/y"), "/x/UUID/y");
  assert.equal(helper.apiPathOf("https://developer.blackboard.com/portal/tokeninfo?access_token=SECRET"), null, "another site's address was kept");
});

test("a value's shape is kept and its content is not", () => {
  const { helper } = openPage();
  const shape = plain(
    helper.shapeOf(
      {
        results: [
          { id: "_1_1", name: "Take-home Quiz 1", status: "Graded", score: 100, possible: 100, student: { givenName: "Ada", email: "ada@uconn.edu" } },
          { id: "_2_1", name: "Exam 1", status: "NotGraded", feedback: null },
        ],
        paging: { nextPage: "/learn/api/v1/courses/_203765_1/gradebook/columns?offset=100" },
        byCourse: { _203765_1: { count: 3 } },
      },
      "",
      0,
    ),
  );
  const text = JSON.stringify(shape);

  assert.ok(!/Take-home|Exam 1|Ada|ada@|uconn\.edu|"score":100/.test(text), "content leaked: " + text);
  assert.equal((shape as { results: Record<string, unknown> }).results["[length]"], 2);
  // Rows are merged, so a field only some rows have still shows.
  const row = (shape as { results: { "[items]": Record<string, unknown> } }).results["[items]"];
  assert.deepEqual(Object.keys(row).sort(), ["feedback", "id", "name", "possible", "score", "status", "student"]);
  assert.equal(row.status, "string:Graded", "a field that names a kind of thing keeps its word");
  assert.equal(row.score, "number");
  assert.equal(row.name, "string(16)");
  assert.equal((shape as { paging: { nextPage: string } }).paging.nextPage, "path:/learn/api/v1/courses/_N_N/gradebook/columns?offset=100");
  assert.ok("byCourse" in (shape as object) && "_N_N" in (shape as { byCourse: object }).byCourse, "an id used as a key was kept");
});

test("a recording of the page's own requests keeps their structure and leaves the page working", async () => {
  const { window, helper } = openPage();
  const calls: string[] = [];
  const original = async (input: unknown) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ results: [{ title: "Exam 1", grade: 91.5, status: "Graded" }] }), {
      status: 200,
      headers: { "content-type": "application/json;charset=UTF-8" },
    });
  };
  (window as unknown as { fetch: unknown }).fetch = original;

  const recorder = helper.startApiRecorder();
  const page = window as unknown as { fetch: (input: string, init?: Record<string, unknown>) => Promise<Response> };
  const got = await page.fetch("/learn/api/v1/courses/_203765_1/gradebook?access_token=SECRET123", {
    method: "POST",
    body: JSON.stringify({ requests: [{ method: "GET", url: "/learn/api/v1/courses/_203765_1/gradebook/columns", note: "private note" }] }),
  });
  // The page still gets its answer, whole.
  assert.equal(((await got.json()) as { results: unknown[] }).results.length, 1);
  await page.fetch("https://example.com/ads.json");
  await new Promise((resolve) => setTimeout(resolve, 30));

  const { count, text } = recorder.finish();

  assert.equal(count, 1, "another site's request was recorded");
  assert.match(text, /POST \/learn\/api\/v1\/courses\/_N_N\/gradebook\?access_token=… -> 200/);
  assert.match(text, /path:\/learn\/api\/v1\/courses\/_N_N\/gradebook\/columns/);
  assert.ok(!/SECRET123|Exam 1|91\.5|private note/.test(text), "content leaked: " + text);
  // Stopped, the page's own fetch is back.
  assert.equal(page.fetch as unknown, original);
  assert.equal(calls.length, 2);
});
