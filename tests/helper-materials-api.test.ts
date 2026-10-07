import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";
import { onlyAtHuskyct } from "./support/huskyct-fetch.ts";

/**
 * Course materials and course colours read from HuskyCT's own data, shaped as they were measured
 * in one course on 2026-10-06: a content tree of lessons, folders (some of them Ultra's
 * documents), files, documents, links and tools; and a colour index on each membership.
 */
const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");

type Outline = {
  files: Array<{ path: string[]; title: string; url: string }>;
  links: Array<{ path: string[]; title: string; url: string; kind: string }>;
  tools: Array<{ path: string[]; title: string }>;
  activities: number;
  unaddressed: number;
  documents: unknown[];
};
type Helper = {
  readMaterialsApi: (courseId: string) => Promise<Outline | null>;
  readCoursesApi: () => Promise<unknown>;
  readColors: (storage: Storage) => Record<string, string>;
  cardColorFromIndex: (index: unknown) => string | null;
  collectMaterials: (options?: Record<string, unknown>) => Promise<{ courses: Array<{ id: string; files: unknown[]; skipped: boolean }> }>;
  COLORS_KEY: string;
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function openPage(serve: (path: string) => unknown | null) {
  const window = new Window({ url: "https://lms.uconn.edu/ultra/stream" });
  onlyAtHuskyct(window);
  windows.push(window);
  const asked: string[] = [];
  (window as unknown as { fetch: unknown }).fetch = async (path: string) => {
    asked.push(path);
    const answer = serve(path);
    return answer === null
      ? new Response("{}", { status: 404 })
      : new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  };
  window.localStorage.setItem("huskypilot.helper.sync.v1", JSON.stringify({ auto: false }));
  const sandbox = { window, document: window.document, navigator: window.navigator, localStorage: window.localStorage, Blob, Response, TextEncoder, btoa, URL, console, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  let moved = 0;
  window.addEventListener("popstate", () => moved++);
  return { window, helper: (window as unknown as { __huskyctHelper: Helper }).__huskyctHelper, asked, moved: () => moved };
}

const COURSE = "_198430_1";
const webdav = (n: number) => `/bbcswebdav/pid-${n}-dt-content-rid-${n}_1/xid-${n}_1`;
const item = (id: string, handler: string, title: string, detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  contentHandler: handler,
  visibility: "VISIBLE",
  contentDetail: { [handler]: detail },
  ...extra,
});
const page = (results: unknown[]) => ({ paging: { count: results.length, nextPage: "" }, results });

const MIDTERM_PAGE = `<p>Old exams</p>
  <a data-bbfile='{"linkName":"Midterm.pdf","mimeType":"application/pdf"}' href="https://lms.uconn.edu${webdav(2)}">Midterm.pdf</a>
  <a href="https://vimeo.com/1">The review session</a>
  <a href="mailto:ta@uconn.edu">Write to the TA</a>`;

/** One course's content tree, by parent. */
const TREE: Record<string, unknown[]> = {
  ROOT: [
    item("_10_1", "resource/x-bb-lesson", "Week 1"),
    item("_11_1", "resource/x-bb-file", "Syllabus.pdf", { file: { fileName: "Syllabus.pdf", permanentUrl: webdav(1) } }),
    item("_12_1", "resource/x-bb-externallink", "Lecture videos", { url: "https://www.youtube.com/watch?v=abc" }),
    item("_13_1", "resource/x-bb-blti-link", "Pearson eText"),
    item("_14_1", "resource/x-bb-file", "Hidden.pdf", { file: { permanentUrl: webdav(9) } }, { visibility: "HIDDEN" }),
    item("_15_1", "resource/x-bb-folder", "Midterm page", { isBbPage: true, isFolder: true }),
  ],
  _10_1: [
    item("_20_1", "resource/x-bb-file", "Lecture 1.pptx", { file: { permanentUrl: webdav(3) } }),
    item("_21_1", "resource/x-bb-folder", "Readings", { isFolder: true }),
  ],
  _21_1: [
    item("_30_1", "resource/x-bb-file", "No address.pdf", { file: { fileName: "No address.pdf" } }),
    item("_31_1", "resource/x-bb-asmt-test-link", "Quiz 1"),
    // The same file linked twice is one file.
    item("_32_1", "resource/x-bb-file", "Lecture 1 again.pptx", { file: { permanentUrl: webdav(3) } }),
  ],
  _15_1: [item("_40_1", "resource/x-bb-document", "ultraDocumentBody", {}, { body: { rawText: MIDTERM_PAGE, displayText: "" } })],
};

function content(path: string) {
  const match = new RegExp(`^/learn/api/v1/courses/${COURSE}/contents/([^/]+)/children`).exec(path);
  return match && TREE[match[1]] ? page(TREE[match[1]]) : null;
}

test("a course's files, links and tools come from HuskyCT's content data, in their folders, with no page opened", async () => {
  const { helper, moved } = openPage(content);

  const outline = plain(await helper.readMaterialsApi(COURSE));

  assert.ok(outline, "the content could not be read");
  assert.deepEqual(outline.files, [
    { path: ["Week 1"], title: "Lecture 1.pptx", url: `https://lms.uconn.edu${webdav(3)}` },
    { path: [], title: "Syllabus.pdf", url: `https://lms.uconn.edu${webdav(1)}` },
    // An Ultra document's attachment sits where the document does, as the outline shows it.
    { path: [], title: "Midterm.pdf", url: `https://lms.uconn.edu${webdav(2)}` },
  ]);
  assert.deepEqual(outline.links, [
    { path: [], title: "Lecture videos", url: "https://www.youtube.com/watch?v=abc", kind: "video" },
    { path: [], title: "The review session", url: "https://vimeo.com/1", kind: "video" },
  ]);
  assert.deepEqual(outline.tools, [{ path: [], title: "Pearson eText" }]);
  assert.equal(outline.activities, 1);
  assert.equal(outline.unaddressed, 1, "a file with no address was not counted");
  assert.deepEqual(outline.documents, [], "a document was left to open");
  assert.equal(moved(), 0);
});

test("content that is refused, or a next address outside HuskyCT's content, gives what HuskyCT's data allows and no more", async () => {
  assert.equal(await openPage(() => null).helper.readMaterialsApi(COURSE), null);

  const { helper, asked } = openPage((path) =>
    path.includes("/contents/ROOT/children") ? { paging: { nextPage: "https://evil.example/x" }, results: [TREE.ROOT[1]] } : null,
  );
  const outline = plain(await helper.readMaterialsApi(COURSE));
  assert.equal(outline?.files.length, 1);
  assert.ok(!asked.some((path) => path.includes("evil.example")), "followed an address outside HuskyCT");
});

test("Collect everything reads materials from HuskyCT's data when it answers, and opens no outline", async () => {
  const memberships = page([
    {
      courseId: COURSE,
      isAvailable: true,
      userHasHidden: false,
      course: { id: COURSE, courseId: "1268-UCONN-ECON-1201-SEC010-5757", displayName: "ECON-1201-Principles of Microeconomics-SEC010-1268", isOrganization: false, isAvailable: true, effectiveAvailability: true },
    },
  ]);
  const { helper, window } = openPage((path) => (path.startsWith("/learn/api/v1/users/me/memberships") ? memberships : content(path)));
  const visited: string[] = [];
  window.addEventListener("popstate", () => visited.push(window.location.pathname));

  const manifest = plain(await helper.collectMaterials({ useCache: false }));

  assert.deepEqual(manifest.courses.map((course) => [course.id, course.skipped, course.files.length]), [[COURSE, false, 3]]);
  assert.ok(!visited.some((path) => path.includes("/outline")), "opened an outline: " + visited.join(", "));
});

test("each course's colour comes with the course list, and replaces one read off the page before", async () => {
  const membership = (id: string, index: number) => ({
    courseId: id,
    isAvailable: true,
    userHasHidden: false,
    courseCardColorIndex: index,
    course: { id, courseId: "1268-UCONN-ECON-1201-SEC010-5757", displayName: "ECON-1201-Micro-SEC010-1268", isOrganization: false, isAvailable: true, effectiveAvailability: true },
  });
  const { helper, window } = openPage((path) =>
    path.startsWith("/learn/api/v1/users/me/memberships") ? page([membership("_1_1", 180), membership("_2_1", 77), membership("_3_1", 18)]) : null,
  );
  // Read wrong off the page before, as an earlier helper did.
  window.localStorage.setItem(helper.COLORS_KEY, JSON.stringify({ _1_1: "#a234b5" }));

  await helper.readCoursesApi();

  // course-color-1, -8 and -9, as HuskyCT draws them.
  assert.deepEqual(plain(helper.readColors(window.localStorage)), { _1_1: "#c473d4", _2_1: "#22c7cc", _3_1: "#ca22ad" });

  assert.equal(helper.cardColorFromIndex(2491), "#2fd9fc", "2491 is course-color-2");
  assert.equal(helper.cardColorFromIndex(undefined), null);
  assert.equal(helper.cardColorFromIndex(-1), null);
});
