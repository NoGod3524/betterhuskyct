import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

import { createMaterialsReceiver } from "../src/lib/materials.ts";
import { onlyAtHuskyct } from "./support/huskyct-fetch.ts";
import { memoryMaterialsStore } from "./support/memory-stores.ts";

/**
 * The materials walk, run as shipped against HuskyCT's own data, and the files' way into
 * BetterHuskyCT. How one course's content reads is helper-materials-api's; this is the walk
 * around it and the delivery after it.
 */
const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");

type Link = { path: string[]; title: string; url: string; kind: string };
type Manifest = {
  term: string | null;
  stopped: boolean;
  problems: Array<{ key: string; params?: Record<string, unknown> }>;
  courses: Array<{
    id: string;
    code: string | null;
    files: Array<{ path: string[]; title: string; url: string }>;
    links: Link[];
    tools: Array<{ path: string[]; title: string }>;
    activities: number;
    skipped: boolean;
  }>;
};

type Helper = {
  collectMaterials: (options?: Record<string, unknown>) => Promise<Manifest>;
  materialsSummary: (manifest: Manifest) => { courses: number; files: number; videos: number; links: number; tools: number };
  safeName: (name: string, fallback: string) => string;
  nameFromStoreUrl: (url: string) => string | null;
  termLabel: (code: number) => string | null;
  setLocale: (locale: string) => void;
  problemsText: (problems: Array<{ key: string; params?: Record<string, unknown> }>) => string;
  sendMaterialsToBhc: (
    target: { postMessage(message: unknown, origin: string): void },
    manifest: Manifest,
    options?: Record<string, unknown>,
  ) => Promise<{ connected: boolean; sent: number; skipped: number; failed: number; tooBig: number }>;
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const MATH = "_203765_1";
const ECON = "_198430_1";
const webdav = (n: number) => `/bbcswebdav/pid-${n}-dt-content-rid-${n}_1/xid-${n}_1`;

// --- HuskyCT's data ------------------------------------------------------------------

const membership = (id: string, readableId: string, displayName: string) => ({
  courseId: id,
  isAvailable: true,
  userHasHidden: false,
  course: { id, courseId: readableId, displayName, isOrganization: false, isAvailable: true, effectiveAvailability: true },
});
const MEMBERSHIPS = {
  paging: { count: 2, nextPage: "" },
  results: [
    membership(MATH, "1268-UCONN-MATH-1070Q-SEC100-1191", "MATH-1070Q-Mathematics for Business and Economics-SEC100-1268"),
    membership(ECON, "1268-UCONN-ECON-1201-SEC010-5757", "ECON-1201-Principles of Microeconomics-SEC010-1268"),
  ],
};

const item = (id: string, handler: string, title: string, detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  contentHandler: handler,
  visibility: "VISIBLE",
  contentDetail: { [handler]: detail },
  ...extra,
});
const file = (id: string, title: string, n: number) => item(id, "resource/x-bb-file", title, { file: { permanentUrl: webdav(n) } });

const SYLLABUS_PAGE = `<p>Read this first.</p><a data-bbfile='{"linkName":"Syllabus Fall 2026.pdf"}' href="${webdav(3)}">Syllabus Fall 2026.pdf</a>`;

/** Each course's content tree, by parent. */
const CONTENT: Record<string, Record<string, unknown[]>> = {
  [MATH]: {
    ROOT: [item("_10_1", "resource/x-bb-lesson", "Week 1"), file("_11_1", "Course Policies.pdf", 1)],
    _10_1: [
      file("_20_1", "Section 4.1 PDF.pdf", 2),
      item("_21_1", "resource/x-bb-document", "Syllabus", {}, { body: { rawText: SYLLABUS_PAGE } }),
      item("_22_1", "resource/x-bb-externallink", "Section 4.1 - Lecture", { url: "https://www.youtube.com/watch?v=mcpGpSSYq8E" }),
      item("_23_1", "resource/x-bb-blti-link", "Cengage WebAssign"),
    ],
  },
  [ECON]: { ROOT: [file("_30_1", "Chapter 1 Slides.pptx", 4)] },
};

function huskyctData(refused: string[], requests: string[]) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return async (path: string) => {
    if (path.startsWith("/learn/api/v1/users/me/memberships")) return json(MEMBERSHIPS);
    const content = /^\/learn\/api\/v1\/courses\/([^/]+)\/contents\/([^/]+)\/children/.exec(path);
    if (content) {
      if (refused.includes(content[1])) return json({}, 500);
      const results = CONTENT[content[1]]?.[content[2]] ?? [];
      return json({ paging: { count: results.length, nextPage: "" }, results });
    }
    if (path.startsWith("/bbcswebdav/")) {
      // The file store, as far as the helper can tell: the bytes, and a note of every fetch.
      requests.push(path);
      return new Response(new Blob(["bytes of " + path], { type: "application/pdf" }), { status: 200 });
    }
    return json({}, 404);
  };
}

function openPage(refused: string[] = []) {
  const window = new Window({ url: "https://lms.uconn.edu/ultra/stream" });
  onlyAtHuskyct(window);
  windows.push(window);
  window.document.body.innerHTML = "<main><p>Activity stream</p></main>";
  window.localStorage.clear();
  const requests: string[] = [];
  (window as unknown as { fetch: unknown }).fetch = huskyctData(refused, requests);
  const sandbox = { window, document: window.document, navigator: window.navigator, localStorage: window.localStorage, Blob, CompressionStream, Response, TextEncoder, btoa, URL, console, setTimeout, clearTimeout };
  // The sync that starts on its own when HuskyCT opens is tested on its own; here it would run in the middle of the tests.
  window.localStorage.setItem("huskypilot.helper.sync.v1", JSON.stringify({ auto: false }));
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  const helper = (window as unknown as { __huskyctHelper: Helper }).__huskyctHelper;
  helper.setLocale("en");
  let moved = 0;
  window.addEventListener("popstate", () => moved++);
  return { window, helper, requests, moved: () => moved };
}

const FAST = { gap: 0 };

// --- the walk --------------------------------------------------------------------------

test("every course's files, links and tools are found, folders and documents included, and no page is opened", async () => {
  const { helper, moved } = openPage();

  const manifest = plain(await helper.collectMaterials(FAST));

  assert.equal(manifest.term, "Fall 2026");
  assert.deepEqual(manifest.problems, []);
  const math = manifest.courses.find((course) => course.id === MATH)!;
  assert.deepEqual(math.files.map((entry) => [entry.path.join("/"), entry.title]), [
    ["Week 1", "Section 4.1 PDF.pdf"],
    ["Week 1", "Syllabus Fall 2026.pdf"],
    ["", "Course Policies.pdf"],
  ]);
  assert.deepEqual(math.links.map((link) => [link.path.join("/"), link.title, link.kind]), [["Week 1", "Section 4.1 - Lecture", "video"]]);
  assert.deepEqual(math.tools.map((tool) => [tool.path.join("/"), tool.title]), [["Week 1", "Cengage WebAssign"]]);
  assert.deepEqual(plain(helper.materialsSummary(manifest)), { courses: 2, files: 4, videos: 1, links: 0, tools: 1 });
  assert.equal(moved(), 0, "a page was opened");
});

test("a course whose content HuskyCT will not give is named, and the others are still read", async () => {
  const { helper } = openPage([ECON]);

  const manifest = plain(await helper.collectMaterials(FAST));

  assert.deepEqual(manifest.courses.map((course) => [course.code, course.skipped]), [
    ["MATH 1070Q", false],
    ["ECON 1201", true],
  ]);
  assert.deepEqual(manifest.problems, [{ key: "problemOutlines", params: { courses: "ECON 1201" } }]);
  assert.match(helper.problemsText(manifest.problems), /could not be read: ECON 1201/);
});

test("stopping keeps what was found so far", async () => {
  const { helper } = openPage();
  let checks = 0;

  const manifest = plain(await helper.collectMaterials({ ...FAST, shouldStop: () => checks++ >= 1 }));

  assert.equal(manifest.stopped, true);
  assert.deepEqual(manifest.courses.map((course) => course.code), ["MATH 1070Q"]);
});

test("names are made safe for every desktop", () => {
  const { helper } = openPage();
  assert.equal(helper.safeName('Week 1: "Intro"/Notes?.pdf', "x"), "Week 1_ _Intro__Notes_.pdf");
  assert.equal(helper.safeName("Notes. ", "x"), "Notes");
  assert.equal(helper.safeName("CON", "fallback"), "fallback");
  assert.equal(helper.safeName("", "fallback"), "fallback");
});

test("term codes read as seasons", () => {
  const { helper } = openPage();
  assert.equal(helper.termLabel(1268), "Fall 2026");
  assert.equal(helper.termLabel(1273), "Spring 2027");
  assert.equal(helper.termLabel(1275), "Summer 2027");
  assert.equal(helper.termLabel(1261), null);
});

test("the file store's signed address names the file", () => {
  const { helper } = openPage();
  const url =
    "https://x.blackboardcdn.com/y?response-content-disposition=" +
    encodeURIComponent("inline; filename*=UTF-8''Section%205.1%20Problem%20Solving%20Tips.pdf") +
    "&X-Amz-Signature=abc";
  assert.equal(helper.nameFromStoreUrl(url), "Section 5.1 Problem Solving Tips.pdf");
  assert.equal(helper.nameFromStoreUrl("https://x/y"), null);
});

// --- into BetterHuskyCT ------------------------------------------------------------------

/**
 * The app's Materials page, as far as the helper can tell: its real receiver
 * (the code the page runs), fed what the helper posts, answering back into the
 * helper's window as a message from the app's origin.
 */
function appTab(window: Window) {
  const store = memoryMaterialsStore();
  const receive = createMaterialsReceiver({ store });
  const posted: Array<{ kind: unknown; origin: string }> = [];
  const target = {
    postMessage(message: unknown, origin: string) {
      posted.push({ kind: (message as { kind?: unknown }).kind, origin });
      void receive({
        origin: "https://lms.uconn.edu",
        data: message,
        source: {
          postMessage(reply: unknown) {
            window.dispatchEvent(new window.MessageEvent("message", { data: reply, origin: "https://betterhuskyct.vercel.app" }));
          },
        },
      });
    },
  };
  return { store, target, posted };
}

const SEND = { helloEvery: 20, connectTimeout: 1000, fileTimeout: 1000 };

test("sent to BetterHuskyCT: every file stored there, then only what is new", async () => {
  const { window, helper, requests } = openPage();
  const manifest = await helper.collectMaterials(FAST);
  const app = appTab(window);

  const first = plain(await helper.sendMaterialsToBhc(app.target, manifest, SEND));

  assert.deepEqual(first, { connected: true, sent: 4, skipped: 0, failed: 0, tooBig: 0 });
  assert.ok(app.posted.every((post) => post.origin === "https://betterhuskyct.vercel.app"), "posted to another origin");
  assert.equal((await app.store.keys()).length, 4);
  const index = await app.store.getIndex();
  assert.deepEqual(index?.courses.map((course) => course.code), ["ECON 1201", "MATH 1070Q"]);
  assert.ok((await app.store.files()).some((stored) => stored.name === "Syllabus Fall 2026.pdf"), "the document's attachment did not arrive");

  const fetchedBefore = requests.length;
  const second = plain(await helper.sendMaterialsToBhc(app.target, manifest, SEND));
  assert.deepEqual(second, { connected: true, sent: 0, skipped: 4, failed: 0, tooBig: 0 });
  assert.equal(requests.length, fetchedBefore, "files the app already had were fetched again");
});

test("an app that never answers is reported, not waited on forever", async () => {
  const { helper } = openPage();
  const manifest = await helper.collectMaterials(FAST);
  const silent = { postMessage() {} };

  const result = plain(await helper.sendMaterialsToBhc(silent, manifest, { ...SEND, connectTimeout: 200 }));

  assert.deepEqual(result, { connected: false, sent: 0, skipped: 0, failed: 0, tooBig: 0 });
});

test("a reply from any other page is ignored", async () => {
  const { window, helper } = openPage();
  const manifest = await helper.collectMaterials(FAST);
  // Something else on the web answering "ready" must not start a delivery.
  const impostor = {
    postMessage() {
      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: { protocol: "betterhuskyct/materials@1", kind: "ready", have: [] },
          origin: "https://evil.example",
        }),
      );
    },
  };

  const result = plain(await helper.sendMaterialsToBhc(impostor, manifest, { ...SEND, connectTimeout: 200 }));

  assert.equal(result.connected, false);
});
