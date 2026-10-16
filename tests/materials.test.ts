import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Window } from "happy-dom";

import {
  MATERIALS_PROTOCOL,
  canViewInTab,
  createMaterialsReceiver,
  folderTree,
  foldersIn,
  formatBytes,
  huskyctCourseUrl,
  isToolLaunchUrl,
  mergeMaterialsIndex,
  parseMaterialsMessage,
  type MaterialsIndex,
} from "../src/lib/materials.ts";
import { memoryMaterialsStore } from "./support/memory-stores.ts";

/**
 * The app's side of course materials: what it accepts from the helper, how it
 * stores it, and how it shows it.
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

test("a file whose address ends in a plain query is read, in the index and as a file; a hostile query is not", () => {
  const WITH_QUERY = FILE_URL + "?xythos-download=true";
  const read = parseMaterialsMessage(message({ kind: "index", index: index([WITH_QUERY, OTHER_URL]), sending: 2 }));
  assert.equal(read?.kind === "index" ? read.index.courses[0].files.length : 0, 2, "the file with a query was dropped from the index");
  assert.equal(parseMaterialsMessage(message({ kind: "file", key: WITH_QUERY, name: "a.zip", type: "application/zip", blob: new Blob(["x"]) }))?.kind, "file");

  for (const key of [FILE_URL + "?", FILE_URL + "?a=<script>", FILE_URL + "?" + "a".repeat(200), FILE_URL + "?a=1#x", "https://evil.example/bbcswebdav/x?a=1"]) {
    assert.equal(parseMaterialsMessage(message({ kind: "file", key, name: "a.zip", type: "", blob: new Blob(["x"]) })), null, key.slice(0, 60));
  }
});

test("a file the app will not take is refused out loud, so the helper does not wait for it", async () => {
  const store = memoryMaterialsStore();
  const states: string[] = [];
  const receive = createMaterialsReceiver({ store, onChange: (state) => states.push(`${state.phase}:${state.stored}/${state.failed}`) });
  const helper = helperWindow();
  const from = (data: unknown) => receive({ origin: "https://lms.uconn.edu", data, source: helper.source });

  // A name too long to be one.
  await from(message({ kind: "file", key: FILE_URL, name: "x".repeat(400), type: "", blob: new Blob(["x"]) }));
  assert.deepEqual(helper.replies.at(-1)!.message, message({ kind: "stored", key: FILE_URL, ok: false }));
  assert.equal(await store.getFile(FILE_URL), null);
  assert.ok(states.at(-1)!.endsWith("/1"), "the refusal was not counted");

  // Not the app's protocol at all: still silence, and not a reply to just anyone.
  const before = helper.replies.length;
  await from({ kind: "file", key: FILE_URL });
  await receive({ origin: "https://evil.example", data: message({ kind: "file", key: FILE_URL, name: "a" }), source: helper.source });
  assert.equal(helper.replies.length, before);
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
  await from(message({ kind: "done", complete: true }));

  // The instructor removed one. A stopped walk says nothing about what is gone...
  await from(message({ kind: "index", index: index([FILE_URL]), sending: 0 }));
  await from(message({ kind: "done", complete: false }));
  assert.equal((await store.keys()).length, 2);
  assert.deepEqual((await store.getIndex())?.courses[0].files.map((file) => file.key), [FILE_URL, OTHER_URL]);

  // ...a complete one does.
  await from(message({ kind: "index", index: index([FILE_URL]), sending: 0 }));
  await from(message({ kind: "done", complete: true }));
  assert.deepEqual(await store.keys(), [FILE_URL]);
});

test("an interrupted delivery keeps old references while exposing new files, links and tools", async () => {
  const store = memoryMaterialsStore();
  await store.putIndex(index([FILE_URL]));
  const receive = createMaterialsReceiver({ store });
  const helper = helperWindow();
  const incoming = index([OTHER_URL]);
  incoming.courses[0].links = [];
  incoming.courses[0].tools = [];

  await receive({ origin: "https://lms.uconn.edu", data: message({ kind: "index", index: incoming, sending: 1 }), source: helper.source });

  const saved = (await store.getIndex())!.courses[0];
  assert.deepEqual(saved.files.map((file) => file.key), [OTHER_URL, FILE_URL]);
  assert.equal(saved.links.length, 1);
  assert.equal(saved.tools.length, 1);
});

test("an incomplete transfer cannot prune even if the sender calls it complete", async () => {
  const store = memoryMaterialsStore();
  await store.putIndex(index([FILE_URL, OTHER_URL]));
  const receive = createMaterialsReceiver({ store });
  const helper = helperWindow();
  const from = (data: unknown) => receive({ origin: "https://lms.uconn.edu", data, source: helper.source });

  await from(message({ kind: "index", index: index([FILE_URL]), sending: 1 }));
  await from(message({ kind: "done", complete: true }));

  assert.equal((await store.getIndex())!.courses[0].files.length, 2);
});

test("index and done messages are processed in order even when the store is slow", async () => {
  const store = memoryMaterialsStore();
  await store.putIndex(index([FILE_URL, OTHER_URL]));
  const delayed = { ...store, putIndex: async (value: MaterialsIndex) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    await store.putIndex(value);
  } };
  const states: string[] = [];
  const receive = createMaterialsReceiver({ store: delayed, onChange: (state) => states.push(state.phase) });
  const helper = helperWindow();
  const from = (data: unknown) => receive({ origin: "https://lms.uconn.edu", data, source: helper.source });

  await Promise.all([
    from(message({ kind: "index", index: index([FILE_URL]), sending: 0 })),
    from(message({ kind: "done", complete: false })),
  ]);
  assert.equal((await store.getIndex())!.courses[0].files.length, 2);
  assert.equal(states.at(-1), "done");
});

test("a persistent store merges inside its transaction for both partial and completed directories", async () => {
  const base = memoryMaterialsStore();
  const calls: boolean[] = [];
  const store = {
    ...base,
    mergeIndex: async (incoming: MaterialsIndex, replace = true) => {
      calls.push(replace);
      await base.putIndex(mergeMaterialsIndex(await base.getIndex(), incoming, replace));
    },
    putIndex: async () => { throw new Error("the receiver bypassed the atomic merge"); },
  };
  const receive = createMaterialsReceiver({ store });
  const helper = helperWindow();
  await receive({ origin: "https://lms.uconn.edu", source: helper.source, data: message({ kind: "index", index: index([]), sending: 0 }) });
  await receive({ origin: "https://lms.uconn.edu", source: helper.source, data: message({ kind: "done", complete: true }) });
  assert.deepEqual(calls, [false, true]);
});

test("a message that never finishes does not hold up the ones behind it", async () => {
  const store = memoryMaterialsStore();
  let calls = 0;
  // The first look at the store never returns; the next ones do.
  const stuck = { ...store, keys: async () => (++calls === 1 ? new Promise<string[]>(() => undefined) : store.keys()) };
  const states: string[] = [];
  const receive = createMaterialsReceiver({ store: stuck, messageTimeoutMs: 30, onChange: (state) => states.push(state.phase) });
  const helper = helperWindow();
  const from = (data: unknown) => receive({ origin: "https://lms.uconn.edu", data, source: helper.source });

  const first = from(message({ kind: "hello" }));
  const second = from(message({ kind: "hello" }));
  await Promise.all([first, second]);

  assert.deepEqual(helper.replies.map((reply) => reply.message.kind), ["ready"], "the second message was never answered");
  assert.ok(states.includes("done"), "the stuck message was not given up on");
});

test("one helper's complete delivery cannot commit another helper's partial course", async () => {
  const store = memoryMaterialsStore();
  await store.putIndex(mergeMaterialsIndex(index([FILE_URL]), index([OTHER_URL], "ECON 1201", "_2_1")));
  await store.putFile({ key: OTHER_URL, name: "old.pdf", type: "", size: 1, blob: new Blob(["x"]), savedAt: new Date().toISOString() });
  const receive = createMaterialsReceiver({ store });
  const a = helperWindow();
  const b = helperWindow();
  const from = (source: typeof a.source, data: unknown) => receive({ origin: "https://lms.uconn.edu", data: message(data as Record<string, unknown>), source });

  await from(a.source, { kind: "index", index: index([]), sending: 0 });
  await from(b.source, { kind: "index", index: index([], "ECON 1201", "_2_1"), sending: 0 });
  await from(a.source, { kind: "done", complete: true });
  await from(b.source, { kind: "done", complete: false });

  const saved = await store.getIndex();
  assert.equal(saved!.courses.find((course) => course.id === "_203765_1")!.files.length, 0);
  assert.equal(saved!.courses.find((course) => course.id === "_2_1")!.files.length, 1);
  assert.ok(await store.getFile(OTHER_URL), "the other helper's old file was deleted");
});

test("an older helper's completion cannot remove a newer partial course's additions", async () => {
  const store = memoryMaterialsStore();
  const receive = createMaterialsReceiver({ store });
  const a = helperWindow();
  const b = helperWindow();
  const from = (source: typeof a.source, data: unknown) => receive({ origin: "https://lms.uconn.edu", data: message(data as Record<string, unknown>), source });

  await from(a.source, { kind: "index", index: index([]), sending: 0 });
  await from(b.source, { kind: "index", index: index([OTHER_URL]), sending: 1 });
  await from(b.source, { kind: "file", key: OTHER_URL, name: "new.pdf", type: "", blob: new Blob(["x"]) });
  await from(b.source, { kind: "done", complete: false });
  await from(a.source, { kind: "done", complete: true });

  assert.equal((await store.getIndex())!.courses[0].files[0].key, OTHER_URL);
  assert.ok(await store.getFile(OTHER_URL));
  assert.equal(b.replies.at(-1)!.message.ok, true, "the second helper's file was not acknowledged");
});

test("simultaneous helpers count their own files and can both finish", async () => {
  const store = memoryMaterialsStore();
  await store.putIndex(mergeMaterialsIndex(index(["folder:old-a.pdf"]), index(["folder:old-b.pdf"], "ECON 1201", "_2_1")));
  const receive = createMaterialsReceiver({ store });
  const a = helperWindow();
  const b = helperWindow();
  const from = (source: typeof a.source, data: unknown) => receive({ origin: "https://lms.uconn.edu", data: message(data as Record<string, unknown>), source });

  await from(a.source, { kind: "index", index: index([FILE_URL]), sending: 1 });
  await from(b.source, { kind: "index", index: index([OTHER_URL], "ECON 1201", "_2_1"), sending: 1 });
  await from(a.source, { kind: "file", key: FILE_URL, name: "a.pdf", type: "", blob: new Blob(["a"]) });
  await from(b.source, { kind: "file", key: OTHER_URL, name: "b.pdf", type: "", blob: new Blob(["b"]) });
  await from(a.source, { kind: "done", complete: true });
  await from(b.source, { kind: "done", complete: true });

  assert.equal((await store.getIndex())!.courses.length, 2);
  assert.ok((await store.getIndex())!.courses.every((course) => course.files.length === 1), "both completed courses should remove their old entries");
  assert.equal((await store.keys()).length, 2);
  assert.equal(a.replies.at(-1)!.message.ok, true);
  assert.equal(b.replies.at(-1)!.message.ok, true);
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

test("a lecture and a lab sharing a code stay two courses, and a lab alone does not drop the lecture", () => {
  const lecture = index([FILE_URL], "STAT 1000Q", "_111_1");
  const lab = index([OTHER_URL], "STAT 1000Q", "_222_1");
  const both = mergeMaterialsIndex(lecture, lab);
  assert.deepEqual(both.courses.map((course) => course.id).sort(), ["_111_1", "_222_1"]);
  const labAgain = mergeMaterialsIndex(both, index([], "STAT 1000Q", "_222_1"));
  assert.deepEqual(labAgain.courses.map((course) => [course.id, course.files.length]).sort(), [["_111_1", 1], ["_222_1", 0]]);
});

// --- showing ----------------------------------------------------------------------------------

test("a course's outline on HuskyCT is linked only for a real course id", () => {
  const course = (id: string) => ({ id, code: "MATH 1070Q", files: [], links: [], tools: [] });
  assert.equal(huskyctCourseUrl(course("_203765_1")), "https://lms.uconn.edu/ultra/courses/_203765_1/outline");
  assert.equal(huskyctCourseUrl(course("MATH 1070Q")), null);
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

test("only a type that cannot run anything is opened in a tab; HTML, SVG, a blank or an unknown type is not", () => {
  for (const type of ["application/pdf", "image/png", "IMAGE/JPEG", "text/plain; charset=utf-8", "video/mp4"]) assert.equal(canViewInTab(type), true, type);
  for (const type of ["text/html", "text/html; charset=utf-8", "image/svg+xml", "application/xhtml+xml", "application/xml", "text/xml", "application/javascript", "", "application/octet-stream", "pdf"]) {
    assert.equal(canViewInTab(type), false, type);
  }
});
