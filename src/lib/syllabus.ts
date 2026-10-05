import type { MaterialFileRef, MaterialsCourse } from "./materials.ts";

/**
 * Finding a course's syllabus among the files the helper brought, and reading
 * its text in this browser.
 *
 * Nothing here knows which file is the syllabus for certain: HuskyCT has no
 * such field. Names are what there is, and in practice they say so —
 * "Syllabus", "MATH1070 Syllabus Fall26.pdf", "Course Schedule". A course
 * whose syllabus is a page rather than a file has none to find.
 */

/** What can be read here. A slide deck or a scan is left alone. */
export type ReadableFormat = "pdf" | "docx" | "text" | "html";

export function formatOf(name: string, type: string): ReadableFormat | null {
  const lower = name.toLowerCase();
  if (type === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || lower.endsWith(".docx")) {
    return "docx";
  }
  if (type === "text/html" || /\.html?$/.test(lower)) return "html";
  if (type === "text/plain" || /\.(txt|md)$/.test(lower)) return "text";
  return null;
}

/**
 * How much a file's name and folder say it is the syllabus (2) or the course's
 * schedule (1), or 0 for neither. A schedule is worth reading too: it is where
 * the exam dates often are when the syllabus only has the policies.
 */
export function syllabusScore(file: Pick<MaterialFileRef, "path" | "title">, name: string): number {
  const own = `${file.title} ${name}`;
  if (/\b(template|sample|example|rubric)\b/i.test(own)) return 0;
  if (/syllab|course\s*(outline|information|info)\b|课程大纲|教学大纲/i.test(own)) return 2;
  if (/\b(schedule|calendar|course\s*plan|timeline)\b|日程|安排/i.test(own)) return 1;
  // A file in a folder called "Syllabus" counts as one, a little less surely.
  if (file.path.some((part) => /syllab/i.test(part))) return 1;
  return 0;
}

export type SyllabusCandidate = { key: string; name: string; score: number };

/**
 * The files to read for one course, best first: the syllabus, and a separate
 * schedule if there is one.
 */
export function pickSyllabusFiles(
  course: Pick<MaterialsCourse, "files">,
  stored: ReadonlyMap<string, { name: string; type: string }>,
): SyllabusCandidate[] {
  const found: SyllabusCandidate[] = [];
  for (const file of course.files) {
    const saved = stored.get(file.key);
    if (!saved || !formatOf(saved.name, saved.type)) continue;
    const score = syllabusScore(file, saved.name);
    if (score > 0) found.push({ key: file.key, name: saved.name, score });
  }
  // Best score first; between equals, the order HuskyCT lists them in, which puts this term's copy first.
  found.sort((left, right) => right.score - left.score);
  const syllabus = found.find((candidate) => candidate.score === 2);
  const schedule = found.find((candidate) => candidate.score === 1);
  // A second file named "syllabus" is not read: it is usually an older term's, with last year's dates.
  return [syllabus, schedule].filter((candidate): candidate is SyllabusCandidate => !!candidate);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Lines kept, runs of spaces and blank lines squeezed, so the text costs what it says. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A Word document's text, from its `word/document.xml`: one line per
 * paragraph, and a table's cells kept apart, since a schedule is usually a table.
 */
export function docxXmlToText(xml: string): string {
  const marked = xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:(br|cr)\/>/g, "\n")
    .replace(/<\/w:tc>/g, " | ")
    .replace(/<\/w:(p|tr)>/g, "\n");
  return tidyText(decodeEntities(marked.replace(/<[^>]+>/g, "")));
}

export function htmlToText(html: string): string {
  const marked = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");
  return tidyText(decodeEntities(marked.replace(/<[^>]+>/g, "")));
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * A file's text, or null when it cannot be read: not a format read here, a
 * damaged file, or a scan with no text in it. The PDF and zip readers are
 * loaded only when a file needs them.
 */
export async function readFileText(file: { name: string; type: string; blob: Blob }): Promise<string | null> {
  const format = formatOf(file.name, file.type);
  try {
    if (format === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(await bytesOf(file.blob));
      const { text } = await extractText(pdf, { mergePages: true });
      return tidyText(text) || null;
    }
    if (format === "docx") {
      const { unzipSync, strFromU8 } = await import("fflate");
      const entries = unzipSync(await bytesOf(file.blob), { filter: (entry) => entry.name === "word/document.xml" });
      const xml = entries["word/document.xml"];
      return xml ? docxXmlToText(strFromU8(xml)) || null : null;
    }
    if (format === "html") return htmlToText(await file.blob.text()) || null;
    if (format === "text") return tidyText(await file.blob.text()) || null;
  } catch {
    return null;
  }
  return null;
}
