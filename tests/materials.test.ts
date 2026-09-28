import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Window } from "happy-dom";

import {
  MATERIALS_PROTOCOL,
  createMaterialsReceiver,
  folderTree,
  foldersIn,
  formatBytes,
  groupByFolder,
  huskyctCourseUrl,
  importMaterialsFolder,
  isToolLaunchUrl,
  memoryMaterialsStore,
  mergeMaterialsIndex,
  parseLinksPage,
  parseMaterialsMessage,
  type DirectoryHandle,
  type FileHandle,
  type MaterialsIndex,
} from "../src/lib/materials.ts";

/**
 * The app's side of course materials: what it accepts from the helper, how it
 * stores it, and how it reads a folder the helper saved.
 */

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

const FILE_URL = "https://lms.uconn.edu/bbcswebdav/pid-14316897-dt-content-rid-199857310_1/xid-199857310_1";
const OTHER_URL = "https://lms.uconn.edu/bbcswebdav/pid-900-dt-content-rid-900_1/xid-900_1";

function index(files: string[], code = "MATH 1070Q", id = "_203765_1"): MaterialsIndex {
  return {
    version: 1,
    term: "Fall 2026",
    updatedAt: "2026-09-27T12:00:00.000Z",
    courses: [
      {
        id,
        code,
        files: files.map((key, i) => ({ key, path: ["Week 1"], title: `File ${i}.pdf` })),
        links: [{ path: [], title: "Lecture", url: "https://www.youtube.com/embed/abc", kind: "video" }],
        tools: [{ path: ["Week 1"], title: "Cengage WebAssign" }],
      },
    ],
  };
}

const message = (body: Record<string, unknown>) => ({ protocol: MATERIALS_PROTOCOL, ...body });

const LAUNCH_URL = "https://lms.uconn.edu/webapps/blackboard/execute/blti/launchLink?course_id=_203765_1&content_id=_14380170_1&from_ultra=true";

// --- what is accepted ---------------------------------------------------------------

test("each of the four messages is read when it is exactly right", () => {
  assert.deepEqual(parseMaterialsMessage(message({ kind: "hello" })), { kind: "hello" });
  assert.equal(parseMaterialsMessage(message({ kind: "index", index: index([FILE_URL]), sending: 1 }))?.kind, "index");
  const file = parseMaterialsMessage(message({ kind: "file", key: FILE_URL, name: "a.pdf", type: "application/pdf", blob: new Blob(["x"]) }));
  assert.equal(file?.kind, "file");
  assert.deepEqual(parseMaterialsMessage(message({ kind: "done", complete: true })), { kind: "done", complete: true });
});

test("anything else from another page is dropped whole", () => {
  const bad = [
    { kind: "hello" }, // no protocol
    message({ kind: "unknown" }),
    // A key that is not HuskyCT's file address: the app would store a file under it.
    message({ kind: "file", key: "https://evil.example/x", name: "a.pdf", type: "", blob: new Blob(["x"]) }),
    // Not a file at all.
    message({ kind: "file", key: FILE_URL, name: "a.pdf", type: "", blob: "not a blob" }),
    // A link that would run script when clicked.
    message({
      kind: "index",
      sending: 0,
      index: { ...index([]), courses: [{ ...index([]).courses[0], links: [{ path: [], title: "x", url: "javascript:alert(1)", kind: "link" }] }] },
    }),
    // A title too long to be one.
    message({ kind: "index", sending: 0, index: { ...index([]), courses: [{ ...index([]).courses[0], tools: [{ path: [], title: "x".repeat(5000) }] }] } }),
    message({ kind: "done", complete: "yes" }),
  ];
  for (const data of bad) assert.equal(parseMaterialsMessage(data), null, JSON.stringify(data).slice(0, 80));
});

test("a tool keeps only HuskyCT's launch address; any other address is dropped", () => {
  const withTools = (tools: unknown[]) =>
    parseMaterialsMessage(message({ kind: "index", sending: 0, index: { ...index([]), courses: [{ ...index([]).courses[0], tools }] } }));
  const read = withTools([
    { path: [], title: "Launch", url: LAUNCH_URL },
    { path: [], title: "Elsewhere", url: "https://evil.example/webapps/blackboard/execute/blti/launchLink?course_id=_1_1&content_id=_2_1" },
    { path: [], title: "Script", url: "javascript:alert(1)" },
    { path: [], title: "Other page", url: "https://lms.uconn.edu/ultra/stream" },
    { path: [], title: "None" },
  ]);
  assert.equal(read?.kind, "index");
  const tools = read?.kind === "index" ? read.index.courses[0].tools : [];
  assert.deepEqual(tools, [
    { path: [], title: "Launch", url: LAUNCH_URL },
    { path: [], title: "Elsewhere" },
    { path: [], title: "Script" },
    { path: [], title: "Other page" },
    { path: [], title: "None" },
  ]);
  assert.ok(isToolLaunchUrl(LAUNCH_URL));
  assert.ok(!isToolLaunchUrl(LAUNCH_URL.replace("_14380170_1", "x")));
});

// --- receiving -------------------------------------------------------------------------

function helperWindow() {
  const replies: Array<{ message: Record<string, unknown>; origin: string }> = [];
  return {
    replies,
    source: {
      postMessage(reply: unknown, origin: string) {
        replies.push({ message: reply as Record<string, unknown>, origin });
      },
    },
  };
}

test("only HuskyCT's own pages are answered", async () => {
  const store = memoryMaterialsStore();
  const receive = createMaterialsReceiver({ store });
  const helper = helperWindow();

  await receive({ origin: "https://evil.example", data: message({ kind: "hello" }), source: helper.source });
  await receive({ origin: "https://evil.example", data: message({ kind: "index", index: index([FILE_URL]), sending: 1 }), source: helper.source });

  assert.equal(helper.replies.length, 0);
  assert.equal(await store.getIndex(), null);
});

test("a delivery: hello, the index, each file acknowledged, then done", async () => {
  const store = memoryMaterialsStore();
  const states: string[] = [];
  const receive = createMaterialsReceiver({ store, onChange: (state) => states.push(`${state.phase}:${state.stored}/${state.expected}`) });
  const helper = helperWindow();
  const from = (data: unknown) => receive({ origin: "https://lms.uconn.edu", data, source: helper.source });

  await from(message({ kind: "hello" }));
  assert.deepEqual(helper.replies[0], { message: message({ kind: "ready", have: [] }), origin: "https://lms.uconn.edu" });

  await from(message({ kind: "index", index: index([FILE_URL]), sending: 1 }));
  await from(message({ kind: "file", key: FILE_URL, name: "Section 5.1.pdf", type: "application/pdf", blob: new Blob(["%PDF-1.7"]) }));
  assert.deepEqual(helper.replies[1].message, message({ kind: "stored", key: FILE_URL, ok: true }));
  await from(message({ kind: "done", complete: true }));

  const stored = await store.getFile(FILE_URL);
  assert.equal(stored?.name, "Section 5.1.pdf");
  assert.equal(await stored?.blob.text(), "%PDF-1.7");
  assert.equal((await store.getIndex())?.courses[0].code, "MATH 1070Q");
  assert.deepEqual(states, ["connected:0/0", "receiving:0/1", "receiving:1/1", "done:1/1"]);

  // Next time, the helper is told what is already here.
  await from(message({ kind: "hello" }));
  assert.deepEqual(helper.replies.at(-1)!.message, message({ kind: "ready", have: [FILE_URL] }));
});

test("a complete delivery drops files no course lists any more; a partial one keeps them", async () => {
  const store = memoryMaterialsStore();
  const receive = createMaterialsReceiver({ store });
  const helper = helperWindow();
  const from = (data: unknown) => receive({ origin: "https://lms.uconn.edu", data, source: helper.source });
  const blob = new Blob(["x"]);

  await from(message({ kind: "index", index: index([FILE_URL, OTHER_URL]), sending: 2 }));
  await from(message({ kind: "file", key: FILE_URL, name: "a.pdf", type: "", blob }));
  await from(message({ kind: "file", key: OTHER_URL, name: "b.pdf", type: "", blob }));

  // The instructor removed one. A stopped walk says nothing about what is gone...
  await from(message({ kind: "index", index: index([FILE_URL]), sending: 0 }));
  await from(message({ kind: "done", complete: false }));
  assert.equal((await store.keys()).length, 2);

  // ...a complete one does.
  await from(message({ kind: "done", complete: true }));
  assert.deepEqual(await store.keys(), [FILE_URL]);
});

test("a newer delivery replaces its own courses and keeps the rest", () => {
  const math = index([FILE_URL]);
  const econ = index([OTHER_URL], "ECON 1201", "_198430_1");
  const both = mergeMaterialsIndex(math, econ);
  assert.deepEqual(both.courses.map((course) => course.code), ["ECON 1201", "MATH 1070Q"]);

  const newerMath = index([], "MATH 1070Q", "_203765_1");
  const merged = mergeMaterialsIndex(both, newerMath);
  assert.deepEqual(merged.courses.map((course) => [course.code, course.files.length]), [
    ["ECON 1201", 1],
    ["MATH 1070Q", 0],
  ]);
});

// --- a saved folder ------------------------------------------------------------------------

function dir(name: string, children: Array<DirectoryHandle | FileHandle>): DirectoryHandle {
  return {
    kind: "directory",
    name,
    async *entries() {
      for (const child of children) yield [child.name, child] as [string, DirectoryHandle | FileHandle];
    },
  };
}
function file(name: string, content: string, type = ""): FileHandle {
  return { kind: "file", name, getFile: async () => new Blob([content], { type }) };
}

function parseHtml(html: string) {
  const window = new Window();
  windows.push(window);
  return new window.DOMParser().parseFromString(html, "text/html") as unknown as Document;
}

const LINKS_PAGE =
  `<ul><li data-course="MATH 1070Q" data-course-id="_203765_1" data-kind="video" data-path='["Week 1 - Section 4.1"]'>` +
  `<a href="https://www.youtube.com/embed/mcpGpSSYq8E">Section 4.1 - Lecture</a></li>` +
  `<li data-course="MATH 1070Q" data-course-id="_203765_1" data-kind="tool" data-path="[]"><a href="https://lms.uconn.edu/webapps/blackboard/execute/blti/launchLink?course_id=_203765_1&amp;content_id=_14380170_1&amp;from_ultra=true">Cengage WebAssign</a></li>` +
  // Saved by a helper before 1.2.1: the tool links to its course page.
  `<li data-course="MATH 1070Q" data-course-id="_203765_1" data-kind="tool" data-path="[]"><a href="https://lms.uconn.edu/ultra/courses/_203765_1/outline">Old tool</a></li>` +
  `<li data-course="MATH 1070Q" data-course-id="_203765_1" data-kind="link" data-path="[]"><a href="javascript:alert(1)">Bad</a></li></ul>`;

test("the folder the helper saved into is imported, picked at the level above the term too", async () => {
  const store = memoryMaterialsStore();
  const root = dir("HuskyCT", [
    dir("HuskyCT Fall 2026", [
      file("links and videos.html", LINKS_PAGE),
      dir("MATH 1070Q", [
        file("Syllabus.pdf", "%PDF syllabus", "application/pdf"),
        dir("Week 1 - Section 4.1", [file("Section 4.1 PDF.pdf", "%PDF 4.1")]),
      ]),
      dir("ECON 1201", [file("Micro.Lect.No.1.pptx", "pptx")]),
    ]),
  ]);

  const result = await importMaterialsFolder(root, store, { parseLinks: (html) => parseLinksPage(html, parseHtml) });

  assert.deepEqual(result, { files: 3, courses: 2 });
  const stored = await store.getIndex();
  assert.equal(stored?.term, "Fall 2026");
  const math = stored!.courses.find((course) => course.code === "MATH 1070Q")!;
  assert.deepEqual(math.files.map((f) => [f.path.join("/"), f.title]).sort(), [
    ["", "Syllabus.pdf"],
    ["Week 1 - Section 4.1", "Section 4.1 PDF.pdf"],
  ]);
  // The links page brought the videos and tools, and the course's HuskyCT id.
  assert.deepEqual(math.links.map((link) => link.kind), ["video"], "a javascript: link was imported");
  assert.deepEqual(
    math.tools.map((tool) => [tool.title, tool.url ?? null]),
    [
      ["Cengage WebAssign", LAUNCH_URL],
      ["Old tool", null],
    ],
  );
  assert.equal(huskyctCourseUrl(math), "https://lms.uconn.edu/ultra/courses/_203765_1/outline");

  const pptx = (await store.files()).find((f) => f.name.endsWith(".pptx"))!;
  assert.equal(pptx.type, "application/vnd.openxmlformats-officedocument.presentationml.presentation");

  // A second import of the same folder updates in place.
  await importMaterialsFolder(root, store, { parseLinks: (html) => parseLinksPage(html, parseHtml) });
  assert.equal((await store.keys()).length, 3);
});

// --- showing ----------------------------------------------------------------------------------

test("files are grouped by folder, in the course's own order", () => {
  const groups = groupByFolder([
    { path: ["Week 1"], title: "a" },
    { path: [], title: "b" },
    { path: ["Week 1"], title: "c" },
  ]);
  assert.deepEqual(groups.map((group) => [group.folder.join("/"), group.items.map((item) => item.title)]), [
    ["Week 1", ["a", "c"]],
    ["", ["b"]],
  ]);
});

test("sizes read as people read them", () => {
  assert.equal(formatBytes(900), "900 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1689443), "1.6 MB");
  assert.equal(formatBytes(250 * 1024 * 1024), "250 MB");
});

test("files make a folder tree that names each folder once", () => {
  const tree = folderTree([
    { path: [], title: "Syllabus.pdf" },
    { path: ["Weekly Lectures", "Week 1"], title: "4.1.pdf" },
    { path: ["Weekly Lectures", "Week 1"], title: "4.1 notes.pdf" },
    { path: ["Weekly Lectures", "Week 2"], title: "4.2.pdf" },
    { path: ["Practice Tests"], title: "Ch 4.pdf" },
  ]);

  assert.deepEqual(tree.items.map((item) => item.title), ["Syllabus.pdf"]);
  assert.deepEqual(tree.children.map((child) => [child.name, child.total]), [
    ["Weekly Lectures", 3],
    ["Practice Tests", 1],
  ]);
  assert.deepEqual(tree.children[0].children.map((child) => [child.name, child.items.length]), [
    ["Week 1", 2],
    ["Week 2", 1],
  ]);
  assert.equal(tree.total, 5);
  assert.deepEqual(foldersIn(tree).map((folder) => folder.path.join("/")), [
    "Weekly Lectures",
    "Weekly Lectures/Week 1",
    "Weekly Lectures/Week 2",
    "Practice Tests",
  ]);
});

