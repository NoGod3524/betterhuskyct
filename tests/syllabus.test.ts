import assert from "node:assert/strict";
import test from "node:test";

import { strToU8, zipSync } from "fflate";

import { makePdf } from "./support/pdf.ts";
import { docxXmlToText, htmlToText, pickSyllabusFiles, readFileText, syllabusScore } from "../src/lib/syllabus.ts";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function makeDocx(xml: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(xml) }));
}

const file = (title: string, path: string[] = []) => ({ key: `https://lms.uconn.edu/f/${title}`, title, path });

test("a file named as the syllabus outranks a schedule, and a template or rubric is neither", () => {
  assert.equal(syllabusScore(file("MATH1070 Syllabus Fall26"), "MATH1070 Syllabus Fall26.pdf"), 2);
  assert.equal(syllabusScore(file("Course Outline"), "outline.docx"), 2);
  assert.equal(syllabusScore(file("Course Schedule"), "schedule.pdf"), 1);
  assert.equal(syllabusScore(file("Week 1 notes", ["Syllabus"]), "notes.pdf"), 1, "a file in a Syllabus folder");
  assert.equal(syllabusScore(file("Syllabus template"), "template.docx"), 0);
  assert.equal(syllabusScore(file("Essay rubric"), "rubric.pdf"), 0);
  assert.equal(syllabusScore(file("Lecture 3"), "lecture3.pdf"), 0);
});

test("the syllabus and a separate schedule are read, a second syllabus and an unreadable format are not", () => {
  const files = [
    file("Lecture 1"),
    file("Course Schedule"),
    file("Syllabus Fall 2026"),
    file("Syllabus Fall 2025"),
    file("Syllabus slides"),
  ];
  const stored = new Map([
    [files[0].key, { name: "lecture1.pdf", type: PDF }],
    [files[1].key, { name: "schedule.docx", type: DOCX }],
    [files[2].key, { name: "syllabus-f26.pdf", type: PDF }],
    [files[3].key, { name: "syllabus-f25.pdf", type: PDF }],
    [files[4].key, { name: "syllabus.pptx", type: "application/vnd.ms-powerpoint" }],
  ]);

  const picked = pickSyllabusFiles({ files }, stored);

  assert.deepEqual(
    picked.map((candidate) => candidate.name),
    ["syllabus-f26.pdf", "schedule.docx"],
  );
});

test("a file the helper has not brought yet is not picked", () => {
  assert.deepEqual(pickSyllabusFiles({ files: [file("Syllabus")] }, new Map()), []);
});

test("a Word document's paragraphs become lines and a table's cells stay apart", () => {
  const xml =
    '<w:document><w:body><w:p><w:r><w:t>Exam &amp; quiz dates</w:t></w:r></w:p>' +
    "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Oct 14</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Midterm 1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
    "</w:body></w:document>";

  const text = docxXmlToText(xml);

  assert.ok(text.startsWith("Exam & quiz dates\n"), text);
  assert.match(text, /Oct 14\s*\|\s*Midterm 1/);
});

test("a page's text keeps its rows and drops its scripts", () => {
  const text = htmlToText("<h1>Schedule</h1><script>alert(1)</script><table><tr><td>Oct 14</td><td>Midterm&nbsp;1</td></tr></table>");
  assert.ok(!text.includes("alert"));
  assert.match(text, /Schedule\nOct 14 \| Midterm 1/);
});

test("the text of a real PDF and a real Word file is read", async () => {
  const pdf = await readFileText({ name: "syllabus.pdf", type: PDF, blob: new Blob([makePdf(["Midterm 1: Tuesday, October 13", "Final exam: Dec 10"])]) });
  assert.ok(pdf?.includes("Midterm 1: Tuesday, October 13") && pdf.includes("Final exam: Dec 10"), String(pdf));

  const docx = await readFileText({
    name: "schedule.docx",
    type: DOCX,
    blob: new Blob([makeDocx("<w:document><w:body><w:p><w:r><w:t>Project due Nov 20</w:t></w:r></w:p></w:body></w:document>")]),
  });
  assert.equal(docx, "Project due Nov 20");
});

test("a damaged file, or one with no text, is no text rather than an error", async () => {
  assert.equal(await readFileText({ name: "syllabus.pdf", type: PDF, blob: new Blob(["not a pdf"]) }), null);
  assert.equal(await readFileText({ name: "syllabus.docx", type: DOCX, blob: new Blob(["not a zip"]) }), null);
  assert.equal(await readFileText({ name: "syllabus.pptx", type: "", blob: new Blob(["x"]) }), null);
});
