import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

/**
 * The helper under a userscript manager that sandboxes it, as Tampermonkey does once a script is
 * granted anything: its \`window\` is a stand-in for the page's, and the page's own functions
 * refuse to be called through it ("Illegal invocation"), while \`unsafeWindow\` is the page's.
 * 1.11.0 and 1.12.0 read nothing that way; this keeps the page's window in hand.
 */
const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

/** A stand-in that, like the manager's, refuses to run the page's functions with itself as \`this\`. */
function sandboxed(page: Window) {
  return new Proxy(page, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function" || /^[A-Z]/.test(String(key))) return value;
      return function (this: unknown, ...args: unknown[]) {
        if (this !== target) throw new TypeError("Illegal invocation");
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function huskyct(path: string): Promise<Response> {
  if (/\/users\/me\/memberships/.test(path)) {
    return Promise.resolve(
      json({
        paging: { count: 1, nextPage: "" },
        results: [
          {
            courseId: "_203765_1",
            isAvailable: true,
            userHasHidden: false,
            course: { id: "_203765_1", courseId: "1268-MATH-1070Q-SEC010-6521", displayName: "MATH 1070Q", isOrganization: false, isAvailable: true, effectiveAvailability: true },
          },
        ],
      }),
    );
  }
  if (/\/users\/me(\?|$)/.test(path)) return Promise.resolve(json({ id: "_99_1" }));
  if (/\/announcements/.test(path)) return Promise.resolve(json({ paging: { count: 0, nextPage: "" }, results: [] }));
  if (/\/gradebook\/grades/.test(path)) {
    return Promise.resolve(json({ paging: { count: 1, nextPage: "" }, results: [{ columnId: "_7_1", column: { id: "_7_1", effectiveColumnName: "Quiz 1" }, status: "GRADED", pointsPossible: 10, displayGrade: { score: 9 }, lastAttempt: { status: "COMPLETED" } }] }));
  }
  return Promise.resolve(new Response("{}", { status: 404 }));
}

function load(url: string, extra: Record<string, unknown> = {}) {
  const page = new Window({ url });
  windows.push(page);
  page.document.body.innerHTML = "<main></main>";
  (page as unknown as { fetch: unknown }).fetch = huskyct;
  page.localStorage.setItem("huskypilot.helper.sync.v1", JSON.stringify({ auto: false }));
  const sandbox = {
    window: sandboxed(page),
    unsafeWindow: page,
    document: page.document,
    navigator: page.navigator,
    Blob,
    CompressionStream,
    Response,
    TextEncoder,
    btoa,
    URL,
    console,
    setTimeout,
    clearTimeout,
    ...extra,
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return page;
}

test("sandboxed by the userscript manager, the helper still reads HuskyCT through the page's own window", async () => {
  const page = load("https://lms.uconn.edu/ultra/stream");
  const helper = (page as unknown as { __huskyctHelper?: { syncLight: () => Promise<{ ok: boolean; courses: number; gradeItems: number }> } }).__huskyctHelper;
  assert.ok(helper, "the helper did not start");
  assert.ok(page.document.querySelector("#huskypilot-helper"), "the panel did not mount");

  const out = await helper.syncLight();
  assert.equal(out.ok, true, "nothing could be read");
  assert.equal(out.courses, 1);
  assert.equal(out.gradeItems, 1);
});

test("sandboxed on BetterHuskyCT, the helper still knows the page's own messages, and answers its ping", async () => {
  const store = new Map<string, unknown>();
  const page = load("https://betterhuskyct.vercel.app/", {
    GM_getValue: (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
    GM_setValue: (key: string, value: unknown) => store.set(key, value),
    GM_addValueChangeListener: () => 1,
    GM_openInTab: () => ({ close() {} }),
  });
  let pong = false;
  page.addEventListener("message", ((event: { data: { protocol?: string; kind?: string } }) => {
    if (event.data && event.data.protocol === "betterhuskyct/bridge@1" && event.data.kind === "pong") pong = true;
  }) as never);

  page.postMessage({ protocol: "betterhuskyct/bridge@1", kind: "ping" }, "https://betterhuskyct.vercel.app");
  for (let wait = 0; wait < 50 && !pong; wait++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(pong, true, "the page's ping was taken for someone else's");
});
