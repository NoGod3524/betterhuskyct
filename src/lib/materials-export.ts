/**
 * Getting the materials out of the browser and onto the computer.
 *
 * The files live in the browser's own storage, which is not a place a student
 * can open a PDF from in another program, back up, or keep when they clear
 * their browsing data. Two ways out, both producing the same layout the helper
 * saves and the Materials page imports back:
 *
 *     HuskyCT Fall 2026/
 *       MATH 1070Q/
 *         Week 1 - Section 4.1/Section 4.1 PDF.pdf
 *       links and videos.html
 *
 * - **A folder**, on a browser that lets a page write to one (Chrome, Edge):
 *   written one file at a time, skipping any already there with the same size,
 *   so exporting again next week writes only what is new.
 * - **One ZIP**, anywhere else: stored without compression (PDFs and slides do
 *   not shrink), built as a Blob from the stored files' own Blobs, so the browser
 *   does not hold a term's files in memory twice.
 */
import type { MaterialsCourse, MaterialsIndex, StoredFile } from "@/lib/materials";

import { isToolLaunchUrl } from "@/lib/materials";

// --- names ----------------------------------------------------------------------------

/** A name Windows, macOS and Linux will all take for a file or folder. */
export function safeName(name: string, fallback: string): string {
  const cleaned = String(name || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 120);
  if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned)) return fallback;
  return cleaned;
}

/** `Notes.pdf` taken twice in a folder becomes `Notes.pdf` and `Notes (2).pdf`. */
function uniqueIn(used: Map<string, Set<string>>, folderKey: string, name: string): string {
  const taken = used.get(folderKey) ?? new Set<string>();
  used.set(folderKey, taken);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${extension}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

// --- what would be exported -----------------------------------------------------------------

export type ExportEntry = {
  /** Folders below the term folder: the course, then the course's own folders. */
  folders: string[];
  name: string;
  blob: Blob;
  savedAt: string;
};

export type ExportPlan = {
  /** `HuskyCT Fall 2026`, or `HuskyCT` when the term is not known. */
  termFolder: string;
  entries: ExportEntry[];
  /** Files the courses list but that have not arrived in this browser. */
  missing: number;
  totalBytes: number;
};

/** The course's folder name: its code, else its id. */
function courseFolder(course: MaterialsCourse): string {
  return safeName(course.code ?? course.id, "Course");
}

export function termFolderName(index: MaterialsIndex): string {
  return index.term ? safeName(`HuskyCT ${index.term}`, "HuskyCT") : "HuskyCT";
}

/** Every stored file, placed where the course keeps it. */
export function planExport(index: MaterialsIndex, stored: Map<string, StoredFile>): ExportPlan {
  const used = new Map<string, Set<string>>();
  const entries: ExportEntry[] = [];
  let missing = 0;
  let totalBytes = 0;

  for (const course of index.courses) {
    const root = courseFolder(course);
    for (const ref of course.files) {
      const file = stored.get(ref.key);
      if (!file) {
        missing++;
        continue;
      }
      const folders = [root, ...ref.path.map((part) => safeName(part, "Folder"))];
      const name = uniqueIn(used, folders.join("/").toLowerCase(), safeName(file.name || ref.title, "file"));
      entries.push({ folders, name, blob: file.blob, savedAt: file.savedAt });
      totalBytes += file.blob.size;
    }
  }
  return { termFolder: termFolderName(index), entries, missing, totalBytes };
}

// --- the links page -------------------------------------------------------------------------------

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const LINKS_PAGE_NAMES = { en: "links and videos.html", "zh-CN": "链接与视频.html" } as const;

const LINKS_LABELS = {
  en: { title: "Links and videos", videos: "Videos", links: "Links", tools: "Tools" },
  "zh-CN": { title: "链接与视频", videos: "视频", links: "链接", tools: "工具" },
} as const;

/**
 * The courses' videos, links and tools as one page, marked up the way the helper
 * marks its own, so importing the folder back reads them without guessing from
 * headings (which change with the language).
 */
export function linksPageHtml(index: MaterialsIndex, locale: "en" | "zh-CN"): string {
  const label = LINKS_LABELS[locale];
  const sections: string[] = [];
  for (const course of index.courses) {
    const code = course.code ?? course.id;
    const rows: string[] = [];
    const group = (heading: string, items: Array<{ kind: string; path: string[]; title: string; url: string }>) => {
      if (items.length === 0) return;
      rows.push(`<h3>${escapeHtml(heading)}</h3><ul>`);
      for (const item of items) {
        const where = item.path.length ? `<span class="path">${escapeHtml(item.path.join(" / "))}</span> ` : "";
        rows.push(
          `<li data-course="${escapeHtml(code)}" data-course-id="${escapeHtml(course.id)}" data-kind="${item.kind}" data-path="${escapeHtml(JSON.stringify(item.path))}">` +
            `${where}<a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></li>`,
        );
      }
      rows.push("</ul>");
    };
    group(label.videos, course.links.filter((l) => l.kind === "video"));
    group(label.links, course.links.filter((l) => l.kind !== "video"));
    const outline = /^_\d+_\d+$/.test(course.id) ? `https://lms.uconn.edu/ultra/courses/${course.id}/outline` : "";
    group(
      label.tools,
      course.tools.flatMap((tool) => {
        const url = tool.url && isToolLaunchUrl(tool.url) ? tool.url : outline;
        return url ? [{ kind: "tool", path: tool.path, title: tool.title, url }] : [];
      }),
    );
    if (rows.length) sections.push(`<h2>${escapeHtml(code)}</h2>${rows.join("")}`);
  }
  const title = `HuskyCT ${index.term ?? ""} — ${label.title}`.replace(/\s+—/, " —");
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px}h2{margin-top:32px;border-top:1px solid #ccd;padding-top:16px}.path{color:#667;font-size:13px}</style>` +
    `</head><body><h1>${escapeHtml(title)}</h1>${sections.join("") || "<p>—</p>"}</body></html>`
  );
}

// --- a folder -----------------------------------------------------------------------------------------

/** The parts of the File System Access API this writes with; declared so tests can fake them. */
export type WritableFile = {
  kind: "file";
  getFile(): Promise<{ size: number }>;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
};
export type WritableDirectory = {
  kind: "directory";
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<WritableDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<WritableFile>;
};

export type SaveResult = { saved: number; skipped: number; failed: number; stopped: boolean; folder: string };

/**
 * Writes the plan into a folder the student picked: a `HuskyCT <term>` folder
 * inside it, then the courses. A file that is already there with the same size
 * is left alone, so a second export writes only what is new. One file failing
 * (a name the disk refuses, a full disk) is counted and the rest go on.
 */
export async function saveToDirectory(
  root: WritableDirectory,
  plan: ExportPlan,
  options: {
    linksPage?: { name: string; html: string };
    onProgress?: (done: number, total: number) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<SaveResult> {
  const result: SaveResult = { saved: 0, skipped: 0, failed: 0, stopped: false, folder: plan.termFolder };
  const top = await root.getDirectoryHandle(plan.termFolder, { create: true });

  for (const [index, entry] of plan.entries.entries()) {
    if (options.shouldStop?.()) {
      result.stopped = true;
      break;
    }
    options.onProgress?.(index + 1, plan.entries.length);
    try {
      let dir = top;
      for (const folder of entry.folders) dir = await dir.getDirectoryHandle(folder, { create: true });
      const existing = await dir.getFileHandle(entry.name).then(
        (handle) => handle.getFile(),
        () => null,
      );
      if (existing && existing.size === entry.blob.size) {
        result.skipped++;
        continue;
      }
      const writable = await (await dir.getFileHandle(entry.name, { create: true })).createWritable();
      await writable.write(entry.blob);
      await writable.close();
      result.saved++;
    } catch {
      result.failed++;
    }
  }

  if (options.linksPage && !result.stopped) {
    try {
      const writable = await (await top.getFileHandle(options.linksPage.name, { create: true })).createWritable();
      await writable.write(options.linksPage.html);
      await writable.close();
    } catch {
      /* the files are what matter; the links are in the app too */
    }
  }
  return result;
}

// --- a ZIP ------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Feeds `bytes` into a running CRC-32 (start from 0xffffffff, finish with `^ 0xffffffff`). */
export function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

export function crc32(bytes: Uint8Array): number {
  return (crc32Update(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

/** A Blob's CRC-32, read in pieces so a big file is never in memory whole. */
export async function crc32Blob(blob: Blob): Promise<number> {
  const reader = blob.stream().getReader();
  let crc = 0xffffffff;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc = crc32Update(crc, value);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** The limits of a plain ZIP; past them a ZIP64 would be needed, which this does not write. */
export const ZIP_MAX_ENTRIES = 65_535;
export const ZIP_MAX_BYTES = 0xffffffff - 1_000_000;

export class ZipTooBigError extends Error {
  constructor() {
    super("zip-too-big");
    this.name = "ZipTooBigError";
  }
}

function dosDateTime(iso: string): { time: number; date: number } {
  const d = new Date(iso);
  const valid = !Number.isNaN(d.getTime()) && d.getFullYear() >= 1980;
  const year = valid ? d.getFullYear() : 1980;
  return {
    time: valid ? (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1) : 0,
    date: ((year - 1980) << 9) | ((valid ? d.getMonth() + 1 : 1) << 5) | (valid ? d.getDate() : 1),
  };
}

function header(size: number, fill: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer));
  return bytes;
}

/**
 * A ZIP of the plan, files stored uncompressed, as one Blob.
 *
 * Names are UTF-8 (flag bit 11), so a Chinese file name survives. The Blob is
 * assembled from the files' own Blobs, and only the headers are built in memory.
 */
export async function buildZip(
  plan: ExportPlan,
  options: { linksPage?: { name: string; html: string }; onProgress?: (done: number, total: number) => void } = {},
): Promise<Blob> {
  const encoder = new TextEncoder();
  type Item = { path: string; blob: Blob; savedAt: string };
  const items: Item[] = plan.entries.map((entry) => ({
    path: [plan.termFolder, ...entry.folders, entry.name].join("/"),
    blob: entry.blob,
    savedAt: entry.savedAt,
  }));
  if (options.linksPage) {
    items.push({
      path: `${plan.termFolder}/${options.linksPage.name}`,
      blob: new Blob([options.linksPage.html], { type: "text/html" }),
      savedAt: new Date().toISOString(),
    });
  }
  if (items.length > ZIP_MAX_ENTRIES || plan.totalBytes > ZIP_MAX_BYTES) throw new ZipTooBigError();

  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [index, item] of items.entries()) {
    options.onProgress?.(index + 1, items.length);
    const name = encoder.encode(item.path);
    const size = item.blob.size;
    const crc = await crc32Blob(item.blob);
    const { time, date } = dosDateTime(item.savedAt);

    const local = header(30 + name.length, (v) => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true); // version needed
      v.setUint16(6, 0x0800, true); // UTF-8 names
      v.setUint16(8, 0, true); // stored
      v.setUint16(10, time, true);
      v.setUint16(12, date, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, size, true);
      v.setUint32(22, size, true);
      v.setUint16(26, name.length, true);
      v.setUint16(28, 0, true);
    });
    local.set(name, 30);
    parts.push(local as BlobPart, item.blob);

    const entry = header(46 + name.length, (v) => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true); // version made by
      v.setUint16(6, 20, true); // version needed
      v.setUint16(8, 0x0800, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, time, true);
      v.setUint16(14, date, true);
      v.setUint32(16, crc, true);
      v.setUint32(20, size, true);
      v.setUint32(24, size, true);
      v.setUint16(28, name.length, true);
      v.setUint32(42, offset, true); // where its local header starts
    });
    entry.set(name, 46);
    central.push(entry);
    offset += local.length + size;
    if (offset > ZIP_MAX_BYTES) throw new ZipTooBigError();
  }

  const centralSize = central.reduce((total, entry) => total + entry.length, 0);
  const end = header(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, items.length, true);
    v.setUint16(10, items.length, true);
    v.setUint32(12, centralSize, true);
    v.setUint32(16, offset, true);
  });
  return new Blob([...parts, ...(central as BlobPart[]), end as BlobPart], { type: "application/zip" });
}

/** `HuskyCT Fall 2026.zip` */
export function zipFileName(plan: ExportPlan): string {
  return `${plan.termFolder}.zip`;
}
