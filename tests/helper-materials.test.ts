import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

import { createMaterialsReceiver, memoryMaterialsStore, parseLinksPage } from "../src/lib/materials.ts";

/**
 * "Collect course materials", run as shipped on pages shaped like the live
 * HuskyCT ones, measured on 2026-09-27:
 *
 * - A content item is a link labelled "Type, Title"; where it links says what
 *   it is — `/file/`, `/document/`, `/assessment/`, `#` for a tool, or out.
 * - A file's row carries its real address on an anchor keyed by the item id.
 * - Folders fill in when opened; a list ends in "Load more", disabled at the end.
 * - A document's attachments carry an id starting with the document's own.
 */
const SOURCE = readFileSync(
  new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url),
  "utf8",
);

type Link = { path: string[]; title: string; url: string; kind: string };
type Manifest = {
  term: string | null;
  stopped: boolean;
  reused: number;
  problems: Array<{ key: string; params?: Record<string, unknown> }>;
  courses: Array<{
    id: string;
    code: string | null;
    files: Array<{ path: string[]; title: string; url: string }>;
    links: Link[];
    tools: Array<{ path: string[]; title: string; type: string; url?: string }>;
    activities: number;
    skipped: boolean;
  }>;
};

type Helper = {
  collectMaterials: (options?: Record<string, unknown>) => Promise<Manifest>;
  materialsSummary: (manifest: Manifest) => { courses: number; files: number; videos: number; links: number; tools: number };
  saveMaterialsToFolder: (
    root: unknown,
    manifest: Manifest,
    options?: Record<string, unknown>,
  ) => Promise<{ saved: number; skipped: number; failed: number; folder: string | null }>;
  materialsZip: (manifest: Manifest, options?: Record<string, unknown>) => Promise<{ blob: Blob; saved: number; failed: number; name: string }>;
  materialsLinksHtml: (manifest: Manifest) => string;
  unwrapLink: (href: string) => string;
  splitItemLabel: (label: string) => { type: string; title: string };
  safeName: (name: string, fallback: string) => string;
  nameFromStoreUrl: (url: string) => string | null;
  termLabel: (code: number) => string | null;
  crc32: (bytes: Uint8Array) => number;
  zipStored: (entries: Array<{ name: string; bytes: Uint8Array }>) => Blob;
  setLocale: (locale: string) => void;
  classifyOutline: (root: unknown, courseId: string) => { files: unknown[]; unaddressed: number };
  problemsText: (problems: Array<{ key: string; params?: Record<string, unknown> }>) => string;
  DOCUMENTS_KEY: string;
  sendMaterialsToBhc: (
    target: { postMessage(message: unknown, origin: string): void },
    manifest: Manifest,
    options?: Record<string, unknown>,
  ) => Promise<{ connected: boolean; sent: number; skipped: number; failed: number }>;
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// --- the fake HuskyCT ----------------------------------------------------------------

const MATH = "_203765_1";
const ECON = "_198430_1";
const LOAD_MORE = "components.directives.content.content-outline.infiniteScroll.content.loadMoreButton.label.plural";

function item(type: string, title: string, href: string, analytics = "content.item.course.outline.courseContent.link") {
  return `<a aria-label="${type}, ${title}" data-analytics-id="${analytics}" href="${href}">${title}</a>`;
}

let pid = 100;
/** A file row: its link, and the hidden anchor that carries its real address. */
function fileRow(course: string, type: string, title: string) {
  const id = `_${++pid}_1`;
  return (
    `<div>${item(type, title, `https://lms.uconn.edu/ultra/courses/${course}/file/${id}?courseId=${course}`)}` +
    `<a data-ally-content-id="${id}" data-ally-file-preview-url="https://lms.uconn.edu/bbcswebdav/pid-${pid}-dt-content-rid-${pid}_1/xid-${pid}_1" style="display:none"></a></div>`
  );
}

function folder(id: string, title: string, kind: "folder" | "learning-module" = "folder") {
  return (
    `<h3><button id="${kind}-title-${id}" aria-expanded="false" aria-controls="${kind}-contents-${id}">${title}</button></h3>` +
    `<div id="${kind}-contents-${id}"></div>`
  );
}

const loadMore = (enabled: boolean) =>
  `<button data-analytics-id="${LOAD_MORE}"${enabled ? "" : " disabled"}>${enabled ? "Load 10 more content items" : "No more content items to load"}</button>`;

const DOCUMENT_ID = "_14409752_1";
const WEBASSIGN = `https://lms.uconn.edu/webapps/blackboard/execute/blti/launchLink?course_id=${MATH}&content_id=_14380170_1&from_ultra=true`;
const TIPS_VIDEO = `https://lms.uconn.edu/webapps/blackboard/execute/blti/launchLink?course_id=${MATH}&content_id=_14316949_1&from_ultra=true`;

/** An LTI link: its anchor goes nowhere, names the tool it launches, and its row carries the item's id. */
function ltiRow(id: string, title: string, handle: string) {
  return (
    `<div data-content-id="${id}"><a aria-label="LTI Link, ${title}" data-analytics-id="content.item.course.outline.courseContent.link" ` +
    `href="#" data-launch-handle="${handle}">${title}</a></div>`
  );
}

function mathOutline() {
  return (
    `<div class="courseTitle-x">MATH-1070Q-Mathematics for Business and Economics-SEC100-1268</div>` +
    ltiRow("_14380170_1", "Cengage WebAssign", "e46e56a7a7fb4f87b6d75e649cde6cda") +
    // A Kaltura video, launched the same way.
    ltiRow("_14316949_1", "Section 4.1 Problem Solving Tips", "KalturaBSE") +
    item(
      "Text Document",
      "Course Information and Syllabus",
      `https://lms.uconn.edu/ultra/courses/${MATH}/document/${DOCUMENT_ID}?view=content&state=view`,
      "content.item.coures.outline.document.link",
    ) +
    folder("_1_1", "Problem-Solving Tips Blank Notes") +
    loadMore(false) +
    // The instructor's message link is not course material.
    `<a aria-label="Send message to Nicole Massarelli" data-analytics-id="courseCore.components.courseInstructors.link" href="https://lms.uconn.edu/ultra/courses/${MATH}/outline/message">x</a>`
  );
}

const FOLDER_CONTENTS: Record<string, () => string> = {
  "folder-contents-_1_1": () =>
    fileRow(MATH, "PDF", "Section 5.1 Problem Solving Tips.pdf") +
    // Same name as the one above, from another item: saved as "(2)".
    fileRow(MATH, "PDF", "Section 5.1 Problem Solving Tips.pdf") +
    item(
      "Practice Test",
      "Practice Test for Ch 4",
      `https://lms.uconn.edu/ultra/courses/${MATH}/assessment/_9_1/overview`,
      "content.item.courses.outline.gradebook.item.assessment.readOnly.link",
    ) +
    item(
      "Link",
      "How the Irish Became White",
      "https://nam10.safelinks.protection.outlook.com/?url=https%3A%2F%2Fsites.pitt.edu%2Fwhite.html&data=05%7Cbxi25003%40uconn.edu",
    ) +
    folder("_2_1", "Week 1", "learning-module") +
    `<div class="more-slot"></div>` +
    loadMore(true),
  "learning-module-contents-_2_1": () =>
    // A CSV reads "Text Document" but links to /file/: it is a file. Its title
    // has no extension here, so its name comes from the file store.
    fileRow(MATH, "Text Document", "Minitab data") + loadMore(false),
};

function econOutline() {
  return (
    `<div class="courseTitle-x">ECON-1201-Principles of Microeconomics-SEC010-1268</div>` +
    fileRow(ECON, "Presentation", "Micro.Lect.No.1.pptx") +
    item("Link", "Marginal Revolution University Videos", "https://www.youtube.com/watch?v=mru") +
    loadMore(false)
  );
}

const DOCUMENT_PAGE =
  `<div class="bbml-editor-parent"><div class="bbml-editor">` +
  `<div role="region" aria-label="File"><a data-ally-content-id="${DOCUMENT_ID}:r207:" data-ally-file-preview-url="https://lms.uconn.edu/bbcswebdav/pid-900-dt-content-rid-900_1/xid-900_1"></a>` +
  `<div role="button" aria-label="Preview File Syllabus Fall 2026.pdf"><span>Syllabus Fall 2026.pdf</span></div></div>` +
  `<div class="bb-editor-root"><div data-bbtype="video" data-bbfile='{"src":"https://www.youtube.com/embed/mcpGpSSYq8E"}'></div>` +
  `<a href="https://nam10.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Freading&amp;data=bxi25003%40uconn.edu">Reading</a></div>` +
  `</div></div>`;

const COURSE_CARDS =
  `<article class="element-card" data-course-id="${MATH}"><span>1268-UCONN-MATH-1070Q-SEC100-1191</span><h4>MATH-1070Q-Mathematics for Business and Economics-SEC100-1268</h4></article>` +
  `<article class="element-card" data-course-id="${ECON}"><span>1268-UCONN-ECON-1201-SEC010-5757</span><h4>ECON-1201-Principles of Microeconomics-SEC010-1268</h4></article>`;

function fakeHuskyct(window: Window, visited: string[]) {
  const main = window.document.querySelector("main")!;
  let generation = 0;
  window.addEventListener("popstate", () => {
    const path = window.location.pathname;
    visited.push(path);
    const mine = ++generation;
    // The previous page stays up for a while under the new address.
    const render = (html: string) =>
      setTimeout(() => {
        if (mine === generation) main.innerHTML = html;
      }, 60);
    if (path === "/ultra/course") render(COURSE_CARDS);
    else if (path === `/ultra/courses/${MATH}/outline`) render(mathOutline());
    else if (path === `/ultra/courses/${ECON}/outline`) render(econOutline());
    else if (path === `/ultra/courses/${MATH}/document/${DOCUMENT_ID}`) render(DOCUMENT_PAGE);
    else render(`<p>${path}</p>`);
  });

  window.document.addEventListener("click", (event) => {
    const target = event.target as unknown as HTMLElement;
    const controls = target.getAttribute?.("aria-controls");
    if (controls && FOLDER_CONTENTS[controls] && target.getAttribute("aria-expanded") === "false") {
      setTimeout(() => {
        target.setAttribute("aria-expanded", "true");
        window.document.getElementById(controls)!.innerHTML = FOLDER_CONTENTS[controls]();
      }, 30);
    }
    if (target.getAttribute?.("data-analytics-id") === LOAD_MORE && !(target as unknown as HTMLButtonElement).disabled) {
      setTimeout(() => {
        const slot = target.parentElement!.querySelector(".more-slot");
        if (slot) slot.innerHTML = fileRow(MATH, "PDF", "Section 5.2 Problem Solving Tips.pdf");
        (target as unknown as HTMLButtonElement).disabled = true;
      }, 30);
    }
  });
}

// --- the file store and the picked folder -------------------------------------------

/** Stands in for HuskyCT's redirect to the file store: the final URL names the file. */
function fileStore() {
  const requests: string[] = [];
  const fetchImpl = async (url: string) => {
    // HuskyCT's own data is not what this stands in for: the helper reads the pages instead.
    if (String(url).startsWith("/learn/api/")) throw new Error("no data in tests");
    requests.push(url);
    const rid = (url.match(/rid-(\d+)_1/) || [])[1] || "0";
    const storeUrl =
      `https://learn-us-east-1-prod-fleet01-beaker-xythos.content.blackboardcdn.com/x/${rid}` +
      `?response-content-disposition=${encodeURIComponent(`inline; filename*=UTF-8''MINITAB%20Data%20${rid}.csv`)}`;
    return { ok: true, status: 200, url: storeUrl, blob: async () => new Blob([`file ${rid}`]) };
  };
  return { fetchImpl, requests };
}

class MemoryDirectory {
  readonly dirs = new Map<string, MemoryDirectory>();
  readonly files = new Map<string, string>();
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    if (!this.dirs.has(name)) {
      if (!options?.create) throw new Error("NotFoundError");
      this.dirs.set(name, new MemoryDirectory());
    }
    return this.dirs.get(name)!;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) throw new Error("NotFoundError");
    const files = this.files;
    return {
      async createWritable() {
        let written: unknown = "";
        return {
          async write(data: unknown) {
            written = data;
          },
          async close() {
            files.set(name, typeof written === "string" ? written : await (written as Blob).text());
          },
        };
      },
    };
  }
  /** Every file under this folder, as "a/b/name". */
  list(prefix = ""): string[] {
    const out = [...this.files.keys()].map((name) => prefix + name);
    for (const [name, dir] of this.dirs) out.push(...dir.list(prefix + name + "/"));
    return out.sort();
  }
}

// --- the page ---------------------------------------------------------------------

function openPage() {
  const window = new Window({ url: "https://lms.uconn.edu/ultra/stream" });
  windows.push(window);
  window.document.body.innerHTML = "<main><p>Activity stream</p></main>";
  // happy-dom shares one storage between windows on the same origin, so a
  // document cached by one test would be found by the next.
  window.localStorage.clear();
  const store = fileStore();
  (window as unknown as { fetch: unknown }).fetch = store.fetchImpl;

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
  const helper = (window as unknown as { __huskyctHelper: Helper }).__huskyctHelper;
  helper.setLocale("en");
  const visited: string[] = [];
  fakeHuskyct(window, visited);
  return { window, helper, store, visited };
}

const FAST = {
  every: 20,
  pageTimeout: 1500,
  outlineTimeout: 3000,
  expandPause: 120,
  documentTimeout: 1000,
  documentSettle: 40,
  gap: 0,
};

// --- walking the courses -------------------------------------------------------------

test("every course's files, links, videos and tools are found, folders and documents included", async () => {
  const { window, helper } = openPage();

  const manifest = plain(await helper.collectMaterials(FAST));

  assert.equal(manifest.term, "Fall 2026");
  assert.deepEqual(manifest.courses.map((course) => course.code), ["MATH 1070Q", "ECON 1201"]);
  const math = manifest.courses[0];

  const byPath = (a: string[], b: string[]) => a.join("|").localeCompare(b.join("|"));
  assert.deepEqual(
    math.files.map((file) => [file.path.join(" / "), file.title]).sort(byPath),
    [
      ["Problem-Solving Tips Blank Notes", "Section 5.1 Problem Solving Tips.pdf"],
      ["Problem-Solving Tips Blank Notes", "Section 5.1 Problem Solving Tips.pdf"],
      // Behind "Load more".
      ["Problem-Solving Tips Blank Notes", "Section 5.2 Problem Solving Tips.pdf"],
      // Inside a nested learning module.
      ["Problem-Solving Tips Blank Notes / Week 1", "Minitab data"],
      // The document's attachment, in the folder the document sits in.
      ["", "Syllabus Fall 2026.pdf"],
    ].sort(byPath),
  );

  assert.deepEqual(
    math.links.map((link) => [link.kind, link.url]).sort(),
    [
      ["link", "https://example.com/reading"],
      ["link", "https://sites.pitt.edu/white.html"],
      ["video", TIPS_VIDEO],
      ["video", "https://www.youtube.com/embed/mcpGpSSYq8E"],
    ],
  );
  assert.ok(!/safelinks|bxi25003|%40uconn/.test(JSON.stringify(math.links)), "a safe-links wrapper, and the email in it, survived");
  assert.deepEqual(math.tools.map((tool) => [tool.title, tool.url]), [["Cengage WebAssign", WEBASSIGN]]);
  assert.equal(math.activities, 1, "the practice test was not counted as work");

  const econ = manifest.courses[1];
  assert.deepEqual(econ.files.map((file) => file.title), ["Micro.Lect.No.1.pptx"]);
  assert.deepEqual(econ.links.map((link) => link.kind), ["video"]);
  // A page still showing MATH's outline while ECON's loaded added nothing of MATH's.
  assert.ok(!econ.files.some((file) => /Section/.test(file.title)));

  assert.deepEqual(plain(helper.materialsSummary(manifest)), { courses: 2, files: 6, videos: 3, links: 2, tools: 1 });
  assert.equal(window.location.pathname, "/ultra/stream", "it did not go back to where it started");
});

test("stopping keeps what was found so far", async () => {
  const { helper } = openPage();
  let checks = 0;

  const manifest = plain(await helper.collectMaterials({ ...FAST, shouldStop: () => checks++ >= 1 }));

  assert.equal(manifest.stopped, true);
  assert.equal(manifest.courses.length, 1);
});

// --- saving ---------------------------------------------------------------------------

test("files are saved into term / course / folder, and a second run fetches nothing already there", async () => {
  const { helper, store } = openPage();
  const manifest = await helper.collectMaterials(FAST);
  const root = new MemoryDirectory();

  const first = plain(await helper.saveMaterialsToFolder(root, manifest, { gap: 0 }));

  assert.deepEqual(first, { saved: 6, skipped: 0, failed: 0, folder: "HuskyCT Fall 2026" });
  assert.deepEqual(root.list(), [
    "HuskyCT Fall 2026/ECON 1201/Micro.Lect.No.1.pptx",
    "HuskyCT Fall 2026/MATH 1070Q/Problem-Solving Tips Blank Notes/Section 5.1 Problem Solving Tips (2).pdf",
    "HuskyCT Fall 2026/MATH 1070Q/Problem-Solving Tips Blank Notes/Section 5.1 Problem Solving Tips.pdf",
    "HuskyCT Fall 2026/MATH 1070Q/Problem-Solving Tips Blank Notes/Section 5.2 Problem Solving Tips.pdf",
    // No extension in its title: named as the file store names it.
    `HuskyCT Fall 2026/MATH 1070Q/Problem-Solving Tips Blank Notes/Week 1/${root.dirs.get("HuskyCT Fall 2026")!.dirs.get("MATH 1070Q")!.dirs.get("Problem-Solving Tips Blank Notes")!.dirs.get("Week 1")!.list()[0]}`,
    "HuskyCT Fall 2026/MATH 1070Q/Syllabus Fall 2026.pdf",
  ]);
  assert.match(root.list()[4], /Week 1\/MINITAB Data \d+\.csv$/);

  const fetchedBefore = store.requests.length;
  const second = plain(await helper.saveMaterialsToFolder(root, manifest, { gap: 0 }));
  assert.equal(second.saved, 0);
  assert.equal(second.skipped, 6);
  // Only the file with no extension in its title has to be fetched to learn its name.
  assert.equal(store.requests.length - fetchedBefore, 1, "files already saved were downloaded again");
});

test("without a folder picker the same files arrive as one ZIP", async () => {
  const { helper } = openPage();
  const manifest = await helper.collectMaterials(FAST);

  const zip = await helper.materialsZip(manifest, { gap: 0 });

  assert.equal(zip.saved, 6);
  assert.equal(zip.name, "HuskyCT Fall 2026.zip");
  const bytes = new Uint8Array(await zip.blob.arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50, "not a ZIP");
  assert.ok(text.includes("HuskyCT Fall 2026/MATH 1070Q/Problem-Solving Tips Blank Notes/Section 5.1 Problem Solving Tips.pdf"));
  // The end record counts every entry.
  const end = bytes.length - 22;
  assert.equal(new DataView(bytes.buffer).getUint16(end + 10, true), 6);
});

test("the ZIP's checksums are the standard CRC-32", () => {
  const { helper } = openPage();
  assert.equal(helper.crc32(new TextEncoder().encode("hello")), 0x3610a686);
  assert.equal(helper.crc32(new Uint8Array()), 0);
});

test("the links page lists videos, links and tools by course, with no email in it", async () => {
  const { helper } = openPage();
  const manifest = await helper.collectMaterials(FAST);

  const html = helper.materialsLinksHtml(manifest);

  assert.ok(html.includes("https://www.youtube.com/embed/mcpGpSSYq8E"));
  assert.ok(html.includes("https://sites.pitt.edu/white.html"));
  assert.ok(html.includes(WEBASSIGN.replaceAll("&", "&amp;")), "an LTI tool does not launch from the page");
  assert.ok(html.indexOf("MATH 1070Q") < html.indexOf("ECON 1201"));
  assert.ok(!/bxi25003|%40uconn/.test(html), "the student's email address is in the file");
});

// --- the small pieces -------------------------------------------------------------------

test("names are made safe for every desktop", () => {
  const { helper } = openPage();
  assert.equal(helper.safeName('Week 1: "Intro"/Notes?.pdf', "x"), "Week 1_ _Intro__Notes_.pdf");
  assert.equal(helper.safeName("Notes. ", "x"), "Notes");
  assert.equal(helper.safeName("CON", "fallback"), "fallback");
  assert.equal(helper.safeName("", "fallback"), "fallback");
});

test("an item's label splits into its kind and a title that may hold commas", () => {
  const { helper } = openPage();
  assert.deepEqual(plain(helper.splitItemLabel("Link, Race, Class, and Gender")), { type: "Link", title: "Race, Class, and Gender" });
  assert.deepEqual(plain(helper.splitItemLabel("Syllabus")), { type: "", title: "Syllabus" });
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

// --- a faster second walk -------------------------------------------------------------

const documentVisits = (visited: string[]) => visited.filter((path) => path.includes("/document/")).length;

test("a second walk within a week does not open the documents again", async () => {
  const { helper, visited } = openPage();
  const first = plain(await helper.collectMaterials(FAST));
  assert.equal(documentVisits(visited), 1);
  assert.equal(first.reused, 0);

  const second = plain(await helper.collectMaterials(FAST));

  assert.equal(documentVisits(visited), 1, "the document was opened again");
  assert.equal(second.reused, 1);
  // Same result, the attachment and the video included.
  assert.deepEqual(
    second.courses[0].files.map((file) => file.title).sort(),
    first.courses[0].files.map((file) => file.title).sort(),
  );
  assert.deepEqual(second.courses[0].links, first.courses[0].links);
});

test("after a week every document is read afresh", async () => {
  const { window, helper, visited } = openPage();
  await helper.collectMaterials(FAST);

  const cache = JSON.parse(window.localStorage.getItem(helper.DOCUMENTS_KEY)!);
  for (const entry of Object.values(cache.documents) as Array<{ at: string }>) {
    entry.at = new Date(Date.now() - 8 * 86400000).toISOString();
  }
  window.localStorage.setItem(helper.DOCUMENTS_KEY, JSON.stringify(cache));

  const again = plain(await helper.collectMaterials(FAST));

  assert.equal(documentVisits(visited), 2, "a week-old reading was trusted");
  assert.equal(again.reused, 0);
});

// --- the self-check ----------------------------------------------------------------------

test("a walk with nothing wrong reports no problems", async () => {
  const { helper } = openPage();
  const manifest = plain(await helper.collectMaterials(FAST));
  assert.deepEqual(manifest.problems, []);
});

test("a file row with no download address is counted, so the panel can say so", () => {
  const { window, helper } = openPage();
  const page = new Window({ url: "https://lms.uconn.edu/ultra/courses/_1_1/outline" });
  windows.push(page);
  // HuskyCT moving the hidden address anchor would look like this: a file link, no address.
  page.document.body.innerHTML =
    item("PDF", "Notes.pdf", "https://lms.uconn.edu/ultra/courses/_1_1/file/_5_1?courseId=_1_1") + fileRow("_1_1", "PDF", "Kept.pdf");

  const found = plain(helper.classifyOutline(page.document, "_1_1"));

  assert.equal(found.files.length, 1);
  assert.equal(found.unaddressed, 1);
  assert.equal(
    helper.problemsText([{ key: "problemFileAddress", params: { count: 1 } }]),
    "Self-check: 1 file(s) had no download address — HuskyCT may have changed.",
  );
  helper.setLocale("zh-CN");
  assert.match(helper.problemsText([{ key: "problemFileAddress", params: { count: 1 } }]), /^自检：有 1 个文件找不到下载地址/);
  helper.setLocale("en");
  assert.ok(window);
});

test("only an LTI link whose row carries its id gets a launch address", () => {
  const { helper } = openPage();
  const page = new Window({ url: "https://lms.uconn.edu/ultra/courses/_1_1/outline" });
  windows.push(page);
  page.document.body.innerHTML =
    `<div data-content-id="_7_1">${item("LTI Link", "Launched", "#")}</div>` +
    // No id on the row: HuskyCT changed, so the course page it is.
    item("LTI Link", "No id", "#") +
    // Not an LTI link: its launch address would be an error page.
    `<div data-content-id="_8_1">${item("Tool", "Other", "#")}</div>` +
    `<div data-content-id="not-an-id">${item("LTI Link", "Bad id", "#")}</div>` +
    ltiRow("_9_1", "Kaltura video", "KalturaBSE");

  const found = plain(helper.classifyOutline(page.document, "_1_1")) as unknown as {
    tools: Array<{ title: string; url?: string }>;
    links: Array<{ title: string; url: string; kind: string }>;
  };

  assert.deepEqual(
    found.tools.map((tool) => [tool.title, tool.url ?? null]),
    [
      ["Launched", "https://lms.uconn.edu/webapps/blackboard/execute/blti/launchLink?course_id=_1_1&content_id=_7_1&from_ultra=true"],
      ["No id", null],
      ["Other", null],
      ["Bad id", null],
    ],
  );
  // A Kaltura launch plays a video, so it is listed with the videos.
  assert.deepEqual(found.links, [
    {
      path: [],
      title: "Kaltura video",
      url: "https://lms.uconn.edu/webapps/blackboard/execute/blti/launchLink?course_id=_1_1&content_id=_9_1&from_ultra=true",
      kind: "video",
    },
  ]);
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
  const { window, helper, store: fileStoreSeen } = openPage();
  const manifest = await helper.collectMaterials(FAST);
  const app = appTab(window);

  const first = plain(await helper.sendMaterialsToBhc(app.target, manifest, SEND));

  assert.deepEqual(first, { connected: true, sent: 6, skipped: 0, failed: 0, tooBig: 0 });
  assert.ok(app.posted.every((post) => post.origin === "https://betterhuskyct.vercel.app"), "posted to another origin");
  assert.equal((await app.store.keys()).length, 6);
  const index = await app.store.getIndex();
  assert.deepEqual(index?.courses.map((course) => course.code), ["ECON 1201", "MATH 1070Q"]);
  const syllabus = (await app.store.files()).find((file) => file.name === "Syllabus Fall 2026.pdf");
  assert.ok(syllabus, "the document's attachment did not arrive");
  const math = index?.courses.find((course) => course.code === "MATH 1070Q");
  assert.deepEqual(math?.tools.map((tool) => tool.url), [WEBASSIGN], "the tool's launch address was lost");
  // Named as the file store names it when the title has no extension.
  assert.ok((await app.store.files()).some((file) => /^MINITAB Data \d+\.csv$/.test(file.name)));

  const fetchedBefore = fileStoreSeen.requests.length;
  const second = plain(await helper.sendMaterialsToBhc(app.target, manifest, SEND));
  assert.deepEqual(second, { connected: true, sent: 0, skipped: 6, failed: 0, tooBig: 0 });
  assert.equal(fileStoreSeen.requests.length, fetchedBefore, "files the app already had were fetched again");
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

test("the saved links page reads back into the app with its courses, kinds and folders", async () => {
  const { helper } = openPage();
  const manifest = await helper.collectMaterials(FAST);
  const html = helper.materialsLinksHtml(manifest);
  const parser = new Window();
  windows.push(parser);

  const links = parseLinksPage(html, (source) => new parser.DOMParser().parseFromString(source, "text/html") as unknown as Document);

  assert.deepEqual(Object.keys(links).sort(), ["ECON 1201", "MATH 1070Q"]);
  assert.equal(links["MATH 1070Q"].id, "_203765_1");
  assert.deepEqual(links["MATH 1070Q"].links.map((link) => link.kind).sort(), ["link", "link", "video", "video"]);
  assert.ok(links["MATH 1070Q"].links.some((link) => link.url === TIPS_VIDEO), "the Kaltura video was not read back");
  assert.deepEqual(plain(links["MATH 1070Q"].tools), [{ path: [], title: "Cengage WebAssign", url: WEBASSIGN }]);
  const white = links["MATH 1070Q"].links.find((link) => /white/.test(link.url));
  assert.deepEqual(white?.path, ["Problem-Solving Tips Blank Notes"]);
});

