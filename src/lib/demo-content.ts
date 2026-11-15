import type { Announcement } from "./announcements.ts";
import { addDays, startOfLocalDay } from "./date-utils.ts";
import type { GradesSnapshot } from "./grades.ts";
import type { MaterialsIndex } from "./materials.ts";

/**
 * What the Courses pages show before the first sync: announcements, files and grades for the same
 * four courses as the demo deadlines, so a visitor sees what each page is for instead of an empty
 * box. Shown only while nothing real is there, marked as a demo, and never stored or sent anywhere.
 */

const HUSKYCT = "https://lms.uconn.edu/";

/** "Thursday, November 19", in English like the course pages it stands in for. */
function day(base: Date, offset: number): string {
  return addDays(startOfLocalDay(base), offset).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function hoursAgo(base: Date, hours: number): string {
  return new Date(base.getTime() - hours * 3_600_000).toISOString();
}

export function createDemoAnnouncements(now: Date): Announcement[] {
  const entry = (id: string, courseCode: string, title: string, body: string, hours: number): Announcement => ({
    id: "demo-" + id,
    courseId: null,
    courseCode,
    title,
    body,
    posted: hoursAgo(now, hours),
    announced: hoursAgo(now, hours),
  });
  return [
    entry(
      "cse-ps2",
      "CSE 2050",
      "Problem Set 2 is posted",
      `Problem Set 2 is now on HuskyCT. It is due ${day(now, 8)} at 11:59 PM. Office hours this week move to Wednesday, 3–5 PM, in ITE 140.`,
      2,
    ),
    entry(
      "math-exam2",
      "MATH 2110Q",
      "Exam 2: time and room",
      `Exam 2 is on ${day(now, 10)}, 8:00–9:15 PM, in PB 38. It covers sections 14.1 to 15.3. Bring a calculator; no notes.`,
      26,
    ),
    entry(
      "econ-quiz4",
      "ECON 1201",
      "Quiz 4 moved",
      `The Chapter 4 quiz moves to ${day(now, 6)}. The reading stays the same.`,
      74,
    ),
    entry(
      "engl-conferences",
      "ENGL 1007",
      "Sign up for a conference",
      `Please sign up for a 15-minute conference before ${day(now, 4)}, and bring a draft of your essay.`,
      122,
    ),
  ];
}

export function createDemoMaterials(now: Date): MaterialsIndex {
  const file = (course: string, folder: string, title: string) => ({ key: `demo:${course}/${folder}/${title}`, path: [folder], title });
  return {
    version: 1,
    term: null,
    updatedAt: now.toISOString(),
    courses: [
      {
        id: "demo-cse-2050",
        code: "CSE 2050",
        files: [
          file("cse", "Course information", "Syllabus.pdf"),
          file("cse", "Lectures", "Lecture 1 - Introduction.pdf"),
          file("cse", "Lectures", "Lecture 2 - Linked lists.pdf"),
          file("cse", "Assignments", "Problem Set 1.pdf"),
        ],
        links: [{ path: ["Lectures"], title: "Lecture 1 recording", url: HUSKYCT, kind: "video" }],
        tools: [{ path: ["Assignments"], title: "Gradescope", url: HUSKYCT }],
      },
      {
        id: "demo-math-2110q",
        code: "MATH 2110Q",
        files: [file("math", "Course information", "Syllabus.pdf"), file("math", "Exams", "Exam 1 review.pdf")],
        links: [],
        tools: [{ path: ["Homework"], title: "WebAssign", url: HUSKYCT }],
      },
      {
        id: "demo-econ-1201",
        code: "ECON 1201",
        files: [file("econ", "Slides", "Chapter 3 - Elasticity.pdf")],
        links: [{ path: ["Readings"], title: "Reading list", url: HUSKYCT, kind: "link" }],
        tools: [],
      },
      {
        id: "demo-engl-1007",
        code: "ENGL 1007",
        files: [file("engl", "Essays", "Essay 2 prompt.docx")],
        links: [],
        tools: [],
      },
    ],
  };
}

export function createDemoGrades(now: Date): GradesSnapshot {
  const item = (id: string, title: string, earned: number | null, possible: number | null, status: string | null = null) => ({
    id: "demo-" + id,
    title,
    status,
    earned,
    possible,
    label: null,
  });
  return {
    version: 1,
    term: null,
    takenAt: now.toISOString(),
    courses: [
      {
        id: "demo-cse-2050",
        code: "CSE 2050",
        items: [
          item("cse-ps0", "Problem Set 0", 9, 10),
          item("cse-lab0", "Lab 0", 20, 20),
          item("cse-quiz1", "Quiz 1", 8.5, 10),
          item("cse-ps1", "Problem Set 1", null, 10, "1 attempt submitted"),
        ],
      },
      {
        id: "demo-math-2110q",
        code: "MATH 2110Q",
        items: [item("math-wa21", "WebAssign 2.1", 10, 10), item("math-wa22", "WebAssign 2.2", 9, 10), item("math-exam1", "Exam 1", 82, 100)],
      },
      {
        id: "demo-econ-1201",
        code: "ECON 1201",
        items: [item("econ-q1", "Quiz 1", 9, 10), item("econ-q2", "Quiz 2", 7, 10), item("econ-q3", "Chapter 3 quiz", null, 10)],
      },
      {
        id: "demo-engl-1007",
        code: "ENGL 1007",
        items: [item("engl-r1", "Reading response 1", 5, 5), item("engl-e1", "Essay 1", 88, 100)],
      },
    ],
  };
}
