import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

import { createMaterialsReceiver } from "../src/lib/materials.ts";
import { onlyAtHuskyct } from "./support/huskyct-fetch.ts";
import { memoryMaterialsStore } from "./support/memory-stores.ts";

/**
 * The materials a sync reads, run as shipped against HuskyCT's own data, and the files' way into
 * BetterHuskyCT. How one course's content reads is helper-materials-api's; this is the reading
 * around it and the delivery after it.
 */
const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");

type Link = { path: string[]; title: string; url: string; kind: string };
type Manifest = {
  term: string | null;
  complete: boolean;
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
  syncLight: (options?: Record<string, unknown>) => Promise<{ materials: Manifest | null }>;
  deliverSync: (
    target: { postMessage(message: unknown, origin: string): void; maxBlobBytes?: number },
    basket: unknown,
    grades: unknown,
    options: Record<string, unknown>,
    materials: Manifest,
  ) => Promise<{ parts: string[]; failed: boolean; files: number }>;
  readSyncState: (storage: unknown) => { pending: boolean };
  safeName: (name: string, fallback: string) => string;
  nameFromStoreUrl: (url: string) => string | null;
  termLabel: (code: number) => string | null;
  setLocale: (locale: string) => void;
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

/** One sync's course content: the manifest a send would carry. */
async function readMaterials(helper: Helper, options: Record<string, unknown> = {}): Promise<Manifest> {
  const out = await helper.syncLight({ ...FAST, ...options });
  return plain(out.materials as Manifest);
}

// --- the walk --------------------------------------------------------------------------

test("every course's files, links and tools are found, folders and documents included, and no page is opened", async () => {
  const { helper, moved } = openPage();

  const manifest = await readMaterials(helper);

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
  const read = manifest.courses.filter((course) => !course.skipped);
  const count = (pick: (course: (typeof read)[number]) => number) => read.reduce((total, course) => total + pick(course), 0);
  assert.deepEqual(
    {
      courses: read.length,
      files: count((course) => course.files.length),
      videos: count((course) => course.links.filter((link) => link.kind === "video").length),
      links: count((course) => course.links.filter((link) => link.kind !== "video").length),
      tools: count((course) => course.tools.length),
    },
    { courses: 2, files: 4, videos: 1, links: 0, tools: 1 },
  );
  assert.equal(moved(), 0, "a page was opened");
});

test("a course whose content HuskyCT will not give is named, and the others are still read", async () => {
  const { helper } = openPage([ECON]);

  const manifest = await readMaterials(helper);

  assert.deepEqual(manifest.courses.map((course) => [course.code, course.skipped]), [
    ["MATH 1070Q", false],
    ["ECON 1201", true],
  ]);
});

test("stopping keeps what was found so far", async () => {
  const { helper } = openPage();
  let checks = 0;

  const manifest = await readMaterials(helper, { shouldStop: () => checks++ >= 1 });

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
  let delivered = Promise.resolve();
  const source = {
    postMessage(reply: unknown) {
      window.dispatchEvent(new window.MessageEvent("message", { data: reply, origin: "https://betterhuskyct.vercel.app" }));
    },
  };
  const target = {
    postMessage(message: unknown, origin: string) {
      posted.push({ kind: (message as { kind?: unknown }).kind, origin });
      delivered = receive({
        origin: "https://lms.uconn.edu",
        data: message,
        source,
      });
    },
  };
  return { store, target, posted, flush: () => delivered };
}

const SEND = { helloEvery: 20, connectTimeout: 1000, fileTimeout: 1000 };

test("sent to BetterHuskyCT: every file stored there, then only what is new", async () => {
  const { window, helper, requests } = openPage();
  const manifest = await readMaterials(helper);
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

test("a file above the bridge limit makes delivery partial while smaller files still arrive", async () => {
  const { window, helper } = openPage();
  (window as unknown as { fetch: unknown }).fetch = async (path: string) =>
    new Response(new Blob([path.includes("xid-1_1") ? "1" : "12"], { type: "application/pdf" }));
  const manifest: Manifest = {
    term: "Fall 2026", complete: true, stopped: false, problems: [],
    courses: [{ id: MATH, code: "MATH 1070Q", skipped: false, activities: 0, links: [], tools: [], files: [
      { path: [], title: "Small.pdf", url: "https://lms.uconn.edu" + webdav(1) },
      { path: [], title: "Large.pdf", url: "https://lms.uconn.edu" + webdav(2) },
    ] }],
  };
  const basket = { version: 1, courses: [], todos: [], todosAt: null, dueDates: [], dueDatesAt: null };
  const app = appTab(window);

  // The same branch as the production 100 MiB limit, without allocating a large file.
  const partial = plain(await helper.deliverSync({ ...app.target, maxBlobBytes: 1 }, basket, null, SEND, manifest));
  await app.flush();
  assert.deepEqual(await app.store.keys(), ["https://lms.uconn.edu" + webdav(1)]);
  assert.equal(partial.files, 1, "the file that fits still arrived");
  assert.equal(partial.failed, true, "a skipped oversized file must not qualify as a full delivery");

  // The panel's direct transfer has no bridge cap and can finish the delivery.
  const complete = plain(await helper.deliverSync(app.target, basket, null, SEND, manifest));
  await app.flush();
  assert.equal(complete.failed, false);
  assert.equal(complete.files, 1, "the already stored file need not be sent again");
  assert.equal((await app.store.keys()).length, 2);
});

test("a sync with oversized files reports sent:false, keeps pending, and shows the warning", async () => {
  const { window, helper } = openPage();
  const base = huskyctData([], []);
  (window as unknown as { fetch: unknown }).fetch = async (path: string) => {
    if (path.includes("/announcements") || path.includes("/gradebook/grades") || path.includes("/calendarItems")) {
      return new Response(JSON.stringify({ results: [], paging: { count: 0 } }));
    }
    if (path.includes("/todo/studentItems")) return new Response(JSON.stringify({ overdueItems: [], dueTodayItems: [], futureDueItems: [] }));
    if (path === "/learn/api/v1/users/me") return new Response(JSON.stringify({ id: "_1003488_1" }));
    return base(path);
  };
  const app = appTab(window);
  let finish: (message: Record<string, unknown>) => void = () => undefined;
  let timer: ReturnType<typeof setTimeout>;
  const done = new Promise<Record<string, unknown>>((resolve, reject) => {
    finish = resolve;
    timer = setTimeout(() => reject(new Error("sync did not finish")), 5000);
  });
  const target = {
    maxBlobBytes: 1,
    postMessage(message: unknown, origin: string) {
      const data = message as Record<string, unknown>;
      if (data.protocol === "betterhuskyct/materials@1") app.target.postMessage(message, origin);
      else if (data.protocol === "betterhuskyct/grades@1") {
        const reply = data.kind === "hello" ? { protocol: data.protocol, kind: "ready" } : { protocol: data.protocol, kind: "stored", ok: true };
        window.dispatchEvent(new window.MessageEvent("message", { data: reply, origin: "https://betterhuskyct.vercel.app" }));
      } else if (data.protocol === "betterhuskyct/sync@1" && data.kind === "done") finish(data);
    },
  };
  window.dispatchEvent(new window.MessageEvent("message", {
    data: { protocol: "betterhuskyct/sync@1", kind: "request" },
    origin: "https://betterhuskyct.vercel.app", source: target as never,
  }));

  let result: Record<string, unknown>;
  try { result = await done; } finally { clearTimeout(timer!); }
  await app.flush();
  assert.equal((await app.store.keys()).length, 0, "every fixture file exceeds the one-byte bridge cap");
  assert.equal(result.ok, true, "the API reading and grade delivery succeeded");
  assert.equal(result.sent, false);
  assert.equal(helper.readSyncState(window.localStorage).pending, true);
  const line = window.document.querySelector("#huskypilot-helper")?.shadowRoot?.querySelector('[data-role="sync"]');
  assert.match(line?.className ?? "", /warn/);
  assert.match(line?.textContent ?? "", /Only part of it reached/);
  assert.doesNotMatch(line?.textContent ?? "", /Sent to BetterHuskyCT/);
});

test("an app that never answers is reported, not waited on forever", async () => {
  const { helper } = openPage();
  const manifest = await readMaterials(helper);
  const silent = { postMessage() {} };

  const result = plain(await helper.sendMaterialsToBhc(silent, manifest, { ...SEND, connectTimeout: 200 }));

  assert.deepEqual(result, { connected: false, sent: 0, skipped: 0, failed: 0, tooBig: 0 });
});

test("a partial material scan keeps old entries through later complete syncs of another course", async () => {
  const { window, helper } = openPage();
  const original = await readMaterials(helper);
  const app = appTab(window);
  await helper.sendMaterialsToBhc(app.target, original, SEND);
  await app.flush();

  const partial = plain(original);
  partial.complete = false;
  const math = partial.courses.find((course) => course.id === MATH)!;
  math.files = math.files.slice(0, 1);
  math.links = [];
  math.tools = [];
  await helper.sendMaterialsToBhc(app.target, partial, SEND);
  await app.flush();

  await helper.sendMaterialsToBhc(app.target, { ...original, courses: original.courses.filter((course) => course.id === ECON) }, SEND);
  await app.flush();
  const saved = (await app.store.getIndex())!.courses.find((course) => course.id === MATH)!;
  assert.equal(saved.files.length, 3);
  assert.equal(saved.links.length, 1);
  assert.equal(saved.tools.length, 1);
  assert.equal((await app.store.keys()).length, 4);

  await helper.sendMaterialsToBhc(app.target, { ...partial, complete: true }, SEND);
  await app.flush();
  assert.equal((await app.store.getIndex())!.courses.find((course) => course.id === MATH)!.files.length, 1);
  assert.equal((await app.store.keys()).length, 2);
});

test("a reply from any other page is ignored", async () => {
  const { window, helper } = openPage();
  const manifest = await readMaterials(helper);
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
