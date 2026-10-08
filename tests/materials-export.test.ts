import assert from "node:assert/strict";
import { test } from "node:test";

import type { MaterialsIndex, StoredFile } from "../src/lib/materials.ts";

import {
  LINKS_PAGE_NAMES,
  ZipTooBigError,
  buildZip,
  crc32,
  crc32Blob,
  linksPageHtml,
  planExport,
  planPart,
  safeName,
  saveToDirectory,
  type WritableDirectory,
} from "../src/lib/materials-export.ts";

const key = (n: number) => `https://lms.uconn.edu/bbcswebdav/pid-${n}-dt-content-rid-${n}_1/xid-${n}_1`;
const file = (n: number, name: string, content: string, savedAt = "2026-09-27T12:30:10.000Z"): StoredFile => ({
  key: key(n),
  name,
  type: "application/pdf",
  size: content.length,
  blob: new Blob([content]),
  savedAt,
});

const index: MaterialsIndex = {
  version: 1,
  term: "Fall 2026",
  updatedAt: "2026-09-27T12:00:00.000Z",
  courses: [
    {
      id: "_203765_1",
      code: "MATH 1070Q",
      files: [
        { key: key(1), path: ["Week 1 - Section 4.1"], title: "Section 4.1 PDF.pdf" },
        { key: key(2), path: ["Week 1 - Section 4.1"], title: "Section 4.1 PDF.pdf" }, // same name again
        { key: key(3), path: [], title: "Syllabus.pdf" },
        { key: key(9), path: [], title: "Not here yet.pdf" }, // never arrived
      ],
      links: [
        { path: ["Week 1 - Section 4.1"], title: "Section 4.1 - Lecture", url: "https://www.youtube.com/embed/abc", kind: "video" },
        { path: [], title: "Reading <b>", url: "https://example.com/a?x=1&y=2", kind: "link" },
      ],
      tools: [{ path: [], title: "Cengage WebAssign", url: "https://lms.uconn.edu/webapps/blackboard/execute/blti/launchLink?course_id=_203765_1&content_id=_14380170_1&from_ultra=true" }],
    },
    { id: "_198430_1", code: "ECON 1201", files: [{ key: key(4), path: ["Lectures"], title: "Micro.Lect.No.1.pptx" }], links: [], tools: [] },
  ],
};

const stored = new Map([
  [key(1), file(1, "Section 4.1 PDF.pdf", "first")],
  [key(2), file(2, "Section 4.1 PDF.pdf", "second!")],
  [key(3), file(3, "Syllabus.pdf", "syllabus")],
  [key(4), file(4, "Micro.Lect.No.1.pptx", "slides")],
]);

// --- what is planned ---------------------------------------------------------------------

test("each file goes in its course's folder and its own folders, and a repeated name gets a number", () => {
  const plan = planExport(index, stored);

  assert.equal(plan.termFolder, "HuskyCT Fall 2026");
  assert.deepEqual(
    plan.entries.map((e) => [...e.folders, e.name].join("/")),
    [
      "MATH 1070Q/Week 1 - Section 4.1/Section 4.1 PDF.pdf",
      "MATH 1070Q/Week 1 - Section 4.1/Section 4.1 PDF (2).pdf",
      "MATH 1070Q/Syllabus.pdf",
      "ECON 1201/Lectures/Micro.Lect.No.1.pptx",
    ],
  );
  assert.equal(plan.missing, 1, "a file that never arrived was not counted as missing");
  assert.equal(plan.totalBytes, "first".length + "second!".length + "syllabus".length + "slides".length);
});

test("one course is a ZIP of its own, rooted at the course and named for it", () => {
  const plan = planPart(index, stored, "_203765_1");

  assert.equal(plan.termFolder, "MATH 1070Q");
  assert.deepEqual(
    plan.entries.map((e) => [...e.folders, e.name].join("/")),
    ["Week 1 - Section 4.1/Section 4.1 PDF.pdf", "Week 1 - Section 4.1/Section 4.1 PDF (2).pdf", "Syllabus.pdf"],
  );
  assert.equal(plan.missing, 1);
  assert.equal(plan.totalBytes, "first".length + "second!".length + "syllabus".length);
});

test("one folder is a ZIP of its own, with its path in the name and nothing outside it", async () => {
  const plan = planPart(index, stored, "_203765_1", ["Week 1 - Section 4.1"]);

  assert.equal(plan.termFolder, "MATH 1070Q - Week 1 - Section 4.1");
  assert.deepEqual(plan.entries.map((e) => [...e.folders, e.name].join("/")), ["Section 4.1 PDF.pdf", "Section 4.1 PDF (2).pdf"]);
  assert.equal(plan.missing, 0, "a file outside the folder was counted as missing");

  const zip = await buildZip(plan);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes("MATH 1070Q - Week 1 - Section 4.1/Section 4.1 PDF.pdf"));
  assert.ok(!text.includes("Syllabus.pdf"));
});

test("a course that is not in the index gives an empty plan rather than a crash", () => {
  const plan = planPart(index, stored, "_nope_1");
  assert.deepEqual(plan.entries, []);
  assert.equal(plan.missing, 0);
});

test("names are made safe for every desktop, and a missing term is just 'HuskyCT'", () => {
  assert.equal(safeName('Week 1: "Intro"/Notes?.pdf', "x"), "Week 1_ _Intro__Notes_.pdf");
  assert.equal(safeName("Notes. ", "x"), "Notes");
  assert.equal(safeName("CON", "fallback"), "fallback");
  assert.equal(safeName("", "fallback"), "fallback");
  assert.equal(planExport({ ...index, term: null }, stored).termFolder, "HuskyCT");
});

test("a folder name that is unsafe on Windows does not reach the disk as it is", () => {
  const odd: MaterialsIndex = {
    ...index,
    courses: [{ id: "_1_1", code: "A/B: C", files: [{ key: key(1), path: ["a?b", "CON"], title: "x.pdf" }], links: [], tools: [] }],
  };
  const [entry] = planExport(odd, stored).entries;
  assert.deepEqual(entry.folders, ["A_B_ C", "a_b", "Folder"]);
});

// --- a folder -------------------------------------------------------------------------------------------

class MemoryDirectory {
  readonly kind = "directory" as const;
  readonly dirs = new Map<string, MemoryDirectory>();
  readonly files = new Map<string, string>();
  readonly name: string;
  constructor(name = "root") {
    this.name = name;
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    if (!this.dirs.has(name)) {
      if (!options?.create) throw new Error("NotFoundError");
      this.dirs.set(name, new MemoryDirectory(name));
    }
    return this.dirs.get(name)!;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) throw new Error("NotFoundError");
    const files = this.files;
    return {
      kind: "file" as const,
      async getFile() {
        const text = files.get(name) ?? "";
        return { size: text.length };
      },
      async createWritable() {
        let written: Blob | string = "";
        return {
          async write(data: Blob | string) {
            written = data;
          },
          async close() {
            files.set(name, typeof written === "string" ? written : await written.text());
          },
        };
      },
    };
  }
  list(prefix = ""): string[] {
    const out = [...this.files.keys()].map((n) => prefix + n);
    for (const [n, dir] of this.dirs) out.push(...dir.list(prefix + n + "/"));
    return out.sort();
  }
}

test("a folder gets the files by course and folder, with the links page beside them", async () => {
  const root = new MemoryDirectory();
  const plan = planExport(index, stored);

  const result = await saveToDirectory(root as unknown as WritableDirectory, plan, {
    linksPage: { name: LINKS_PAGE_NAMES.en, html: linksPageHtml(index, "en") },
  });

  assert.deepEqual(result, { saved: 4, skipped: 0, failed: 0, stopped: false, folder: "HuskyCT Fall 2026" });
  assert.deepEqual(root.list(), [
    "HuskyCT Fall 2026/ECON 1201/Lectures/Micro.Lect.No.1.pptx",
    "HuskyCT Fall 2026/MATH 1070Q/Syllabus.pdf",
    "HuskyCT Fall 2026/MATH 1070Q/Week 1 - Section 4.1/Section 4.1 PDF (2).pdf",
    "HuskyCT Fall 2026/MATH 1070Q/Week 1 - Section 4.1/Section 4.1 PDF.pdf",
    "HuskyCT Fall 2026/links and videos.html",
  ]);
  const math = (await root.getDirectoryHandle("HuskyCT Fall 2026")).dirs.get("MATH 1070Q")!;
  assert.equal(math.files.get("Syllabus.pdf"), "syllabus");
});

test("exporting again writes only what is new", async () => {
  const root = new MemoryDirectory();
  await saveToDirectory(root as unknown as WritableDirectory, planExport(index, stored));

  const again = await saveToDirectory(root as unknown as WritableDirectory, planExport(index, stored));

  assert.deepEqual(again, { saved: 0, skipped: 4, failed: 0, stopped: false, folder: "HuskyCT Fall 2026" });

  // A file whose size changed is written again.
  const changed = new Map(stored).set(key(3), file(3, "Syllabus.pdf", "syllabus, revised"));
  const third = await saveToDirectory(root as unknown as WritableDirectory, planExport(index, changed));
  assert.equal(third.saved, 1);
  assert.equal(third.skipped, 3);
});

test("one file the disk refuses is counted and the rest still go", async () => {
  const root = new MemoryDirectory();
  const original = MemoryDirectory.prototype.getFileHandle;
  MemoryDirectory.prototype.getFileHandle = async function (this: MemoryDirectory, name: string, options?: { create?: boolean }) {
    if (name === "Syllabus.pdf" && options?.create) throw new Error("NoModificationAllowedError");
    return original.call(this, name, options);
  };
  try {
    const result = await saveToDirectory(root as unknown as WritableDirectory, planExport(index, stored));
    assert.equal(result.failed, 1);
    assert.equal(result.saved, 3);
  } finally {
    MemoryDirectory.prototype.getFileHandle = original;
  }
});

test("stopping leaves the rest alone", async () => {
  const root = new MemoryDirectory();
  let calls = 0;
  const result = await saveToDirectory(root as unknown as WritableDirectory, planExport(index, stored), { shouldStop: () => calls++ >= 2 });
  assert.equal(result.stopped, true);
  assert.equal(result.saved, 2);
});

test("the links page escapes what it prints, and is named for the language", () => {
  const html = linksPageHtml(index, "en");
  assert.ok(html.includes("Reading &lt;b&gt;"), "a title was not escaped");
  assert.ok(!html.includes("<b>"));
  assert.ok(html.includes("a?x=1&amp;y=2"));
  assert.equal(LINKS_PAGE_NAMES["zh-CN"], "链接与视频.html");
  assert.ok(linksPageHtml(index, "zh-CN").includes("视频"));
});

// --- a ZIP -----------------------------------------------------------------------------------------------------

test("CRC-32 is the standard one, whole or in pieces", async () => {
  assert.equal(crc32(new TextEncoder().encode("hello")), 0x3610a686);
  assert.equal(crc32(new Uint8Array()), 0);
  assert.equal(await crc32Blob(new Blob(["hello"])), 0x3610a686);
});

/** Reads a ZIP back the way an unzipper does: from the end-of-directory record. */
async function readZip(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, "no end-of-directory record");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const out: Array<{ name: string; text: string; crcOk: boolean; utf8: boolean }> = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.slice(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50, "the central entry points at no local header");
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.slice(dataStart, dataStart + size);
    out.push({ name, text: decoder.decode(data), crcOk: crc32(data) === crc, utf8: (flags & 0x0800) !== 0 });
    at += 46 + nameLength;
  }
  return out;
}

test("a ZIP holds every file at its path, whole, with a correct checksum and UTF-8 names", async () => {
  const zh: MaterialsIndex = {
    ...index,
    courses: [{ id: "_1_1", code: "MATH 1070Q", files: [{ key: key(1), path: ["第一周"], title: "讲义.pdf" }], links: [], tools: [] }],
  };
  const zhStored = new Map([[key(1), file(1, "讲义.pdf", "内容 content")]]);

  const blob = await buildZip(planExport(zh, zhStored), { linksPage: { name: LINKS_PAGE_NAMES["zh-CN"], html: linksPageHtml(zh, "zh-CN") } });
  const entries = await readZip(blob);

  assert.equal(blob.type, "application/zip");
  assert.deepEqual(entries.map((e) => e.name), ["HuskyCT Fall 2026/MATH 1070Q/第一周/讲义.pdf", "HuskyCT Fall 2026/链接与视频.html"]);
  assert.equal(entries[0].text, "内容 content");
  assert.ok(entries.every((e) => e.crcOk && e.utf8), "a checksum or the UTF-8 flag is wrong");
});

test("a bigger set is a correct ZIP too, and reports its progress", async () => {
  const many = new Map<string, StoredFile>();
  const files = Array.from({ length: 50 }, (_, i) => ({ key: key(100 + i), path: [`Week ${i % 5}`], title: `File ${i}.txt` }));
  files.forEach((f, i) => many.set(f.key, file(100 + i, `File ${i}.txt`, `body ${i} `.repeat(i + 1))));
  const big: MaterialsIndex = { ...index, courses: [{ id: "_1_1", code: "STAT 1000Q", files, links: [], tools: [] }] };
  const seen: number[] = [];

  const entries = await readZip(await buildZip(planExport(big, many), { onProgress: (done) => seen.push(done) }));

  assert.equal(entries.length, 50);
  assert.ok(entries.every((e) => e.crcOk));
  assert.equal(entries[7].text, "body 7 ".repeat(8));
  assert.deepEqual(seen.slice(0, 3).concat(seen.at(-1)!), [1, 2, 3, 50]);
});

test("more than a plain ZIP can hold is refused with a reason, not written wrong", async () => {
  const plan = planExport(index, stored);
  await assert.rejects(buildZip({ ...plan, totalBytes: 0xffffffff }), (error) => error instanceof ZipTooBigError);
  const crowd = { ...plan, entries: Array.from({ length: 70_000 }, () => plan.entries[0]) };
  await assert.rejects(buildZip(crowd), (error) => error instanceof ZipTooBigError);
});
