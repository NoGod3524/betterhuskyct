import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import {
  COURSES_STORAGE_KEY,
  EMPTY_COURSE_BOOK,
  LEGACY_COURSE_LABEL_KEY,
  MAX_COURSES,
  addCourse,
  assignTaskCourse,
  clearCourseBook,
  clearTaskCourse,
  courseCodeAsTyped,
  defaultCourse,
  isCourseComponent,
  labelForTask,
  normaliseCourseCode,
  parseStoredCourseBook,
  removeCourse,
  restoreCourseBook,
  saveCourseBook,
  setDefaultCourse,
  updateCourse,
  type Course,
  type CourseBook,
} from "../src/lib/courses.ts";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function classMeeting(overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id: "class-1",
    title: "Environmental Science",
    course: null,
    start: "2026-09-11T12:30:00.000Z",
    dateKey: null,
    end: "2026-09-11T13:45:00.000Z",
    allDay: false,
    location: "ARJ 105",
    kind: "class",
    ...overrides,
  };
}

function assignment(overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id: "assignment-1",
    title: "Take-home Quiz 1",
    course: null,
    start: "2026-09-13T23:59:00.000Z",
    dateKey: null,
    end: null,
    allDay: false,
    location: null,
    kind: "assignment",
    ...overrides,
  };
}

function bookOf(...codes: Array<[string, Course["component"]]>): CourseBook {
  return codes.reduce(
    (book, [code, component]) => addCourse(book, code, component),
    EMPTY_COURSE_BOOK,
  );
}

test("normaliseCourseCode trims, collapses spaces and caps the length", () => {
  assert.equal(normaliseCourseCode("  NRE   1000E "), "NRE 1000E");
  assert.equal(normaliseCourseCode("   "), "");
  assert.equal(normaliseCourseCode("A".repeat(40)).length, 24);
});

test("courseCodeAsTyped collapses spaces but keeps the one just typed", () => {
  // The code is saved on every keystroke, so trimming here would turn
  // "NRE 1000E" into "NRE1000E" the moment the space was pressed.
  assert.equal(courseCodeAsTyped("NRE "), "NRE ");
  assert.equal(courseCodeAsTyped("NRE   1000E"), "NRE 1000E");
  assert.equal(courseCodeAsTyped("A".repeat(40)).length, 24);
});

test("isCourseComponent accepts only the four components", () => {
  assert.equal(isCourseComponent("LEC"), true);
  assert.equal(isCourseComponent("DIS"), true);
  assert.equal(isCourseComponent("LAB"), true);
  assert.equal(isCourseComponent("SEM"), true);
  assert.equal(isCourseComponent("PRACTICUM"), false);
  assert.equal(isCourseComponent(null), false);
});

test("the first course added becomes the default", () => {
  const book = bookOf(["NRE 1000E", "LEC"], ["STAT 1000Q", "LEC"]);

  assert.equal(book.courses.length, 2);
  assert.equal(defaultCourse(book)?.code, "NRE 1000E");
  assert.equal(book.courses[1].isDefault, false);
});

test("addCourse refuses a blank code and an exact duplicate", () => {
  const book = bookOf(["NRE 1000E", "LEC"]);

  assert.equal(addCourse(book, "   ", null).courses.length, 1);
  assert.equal(addCourse(book, "nre 1000e", "LEC").courses.length, 1);
  // The same code running a different component is a different course.
  assert.equal(addCourse(book, "NRE 1000E", "DIS").courses.length, 2);
});

test("addCourse stops at the cap", () => {
  let book = EMPTY_COURSE_BOOK;
  for (let index = 0; index < MAX_COURSES + 3; index += 1) {
    book = addCourse(book, `COURSE ${index}`, null);
  }

  assert.equal(book.courses.length, MAX_COURSES);
});

test("updateCourse edits in place and keeps a space that was just typed", () => {
  const book = bookOf(["NRE 1000E", null]);
  const id = book.courses[0].id;

  const typed = updateCourse(book, id, { code: "NRE " });
  assert.equal(typed.courses[0].code, "NRE ");
  // Reading it back later trims it, which is fine once typing has stopped.
  assert.equal(normaliseCourseCode(typed.courses[0].code), "NRE");

  const withComponent = updateCourse(typed, id, { component: "LEC" });
  assert.equal(withComponent.courses[0].component, "LEC");
  assert.equal(withComponent.courses[0].code, "NRE ");
});

test("updateCourse ignores an unknown id and a bad component", () => {
  const book = bookOf(["NRE 1000E", "LEC"]);

  assert.deepEqual(updateCourse(book, "nope", { code: "X" }), book);
  assert.equal(
    updateCourse(book, book.courses[0].id, { component: "LECTURE" as never })
      .courses[0].component,
    null,
  );
});

test("removeCourse forgets the overrides that pointed at it", () => {
  const book = bookOf(["NRE 1000E", "LEC"], ["STAT 1000Q", "LEC"]);
  const [first, second] = book.courses;

  const assigned = assignTaskCourse(book, "assignment-1", second.id);
  const after = removeCourse(assigned, second.id);

  assert.equal(after.courses.length, 1);
  assert.deepEqual(after.assignments, {});
  assert.equal(defaultCourse(after)?.id, first.id);
});

test("removing the default hands the job to the next course", () => {
  const book = bookOf(["NRE 1000E", null], ["STAT 1000Q", null]);
  const [first, second] = book.courses;

  const after = removeCourse(book, first.id);

  assert.equal(after.courses.length, 1);
  assert.equal(defaultCourse(after)?.id, second.id);
  // Nothing left to promote: the list is simply empty.
  assert.deepEqual(removeCourse(after, second.id).courses, []);
});

test("removing a course that is not the default leaves the default alone", () => {
  const book = bookOf(["NRE 1000E", null], ["STAT 1000Q", null]);
  const [first, second] = book.courses;

  const after = removeCourse(book, second.id);

  assert.equal(defaultCourse(after)?.id, first.id);
});

test("setDefaultCourse moves the default and rejects an unknown id", () => {
  const book = bookOf(["NRE 1000E", null], ["STAT 1000Q", null]);
  const second = book.courses[1];

  assert.equal(defaultCourse(setDefaultCourse(book, second.id))?.id, second.id);
  assert.equal(defaultCourse(setDefaultCourse(book, "nope")), null);
  assert.equal(defaultCourse(setDefaultCourse(book, null)), null);
});

test("labelForTask prefers the pick, then the feed, then the default", () => {
  const book = bookOf(["NRE 1000E", "LEC"], ["STAT 1000Q", "LEC"]);
  const [first, second] = book.courses;

  // No pick yet: the default course answers.
  assert.deepEqual(labelForTask(book, assignment()), {
    code: "NRE 1000E",
    component: null,
  });

  // A pick wins over the default.
  const picked = assignTaskCourse(book, "assignment-1", second.id);
  assert.equal(labelForTask(picked, assignment())?.code, "STAT 1000Q");

  // An explicit "none" beats the default.
  const hidden = assignTaskCourse(book, "assignment-1", null);
  assert.equal(labelForTask(hidden, assignment()), null);

  // With no default at all, a course named by the feed itself still shows.
  const noDefault = setDefaultCourse(book, null);
  assert.equal(
    labelForTask(noDefault, assignment({ course: "SOCI 1501" }))?.code,
    "SOCI 1501",
  );
  assert.equal(labelForTask(noDefault, assignment()), null);
  assert.equal(defaultCourse(noDefault), null);
  // Nothing configured at all: a titled class meeting resolves from UConn's
  // catalogue, and an assignment with a made-up title still resolves to nothing.
  assert.equal(labelForTask(EMPTY_COURSE_BOOK, classMeeting())?.code, "NRE 1000E");
  assert.equal(labelForTask(EMPTY_COURSE_BOOK, assignment()), null);
  assert.equal(first.isDefault, true);
});

test("labelForTask falls back to the course its feed was filed under", () => {
  const book = bookOf(["NRE 1000E", "LEC"], ["STAT 1000Q", "DIS"]);
  const [first, second] = book.courses;

  // The feed's own course beats both its filed course and the default.
  assert.equal(
    labelForTask(book, classMeeting({ course: "Environmental Science" }), second.id)
      ?.code,
    "Environmental Science",
  );

  // With nothing on the event, the feed's course wins over the default.
  assert.deepEqual(labelForTask(book, assignment(), second.id), {
    code: "STAT 1000Q",
    component: null,
  });

  // An explicit pick still outranks the feed it came from.
  const picked = assignTaskCourse(book, "assignment-1", first.id);
  assert.equal(labelForTask(picked, assignment(), second.id)?.code, "NRE 1000E");

  // A feed filed under a course that no longer exists falls back to the default.
  assert.equal(labelForTask(book, assignment(), "deleted-course")?.code, "NRE 1000E");
  assert.equal(labelForTask(book, assignment(), null)?.code, "NRE 1000E");
});

test("labelForTask shows a teaching component on class meetings only", () => {
  const book = bookOf(["NRE 1000E", "LEC"]);

  assert.deepEqual(labelForTask(book, classMeeting()), {
    code: "NRE 1000E",
    component: "LEC",
  });
  assert.deepEqual(labelForTask(book, assignment()), {
    code: "NRE 1000E",
    component: null,
  });
});

test("clearTaskCourse hands the row back to the default", () => {
  const book = bookOf(["NRE 1000E", null], ["STAT 1000Q", null]);
  const picked = assignTaskCourse(book, "assignment-1", book.courses[1].id);

  const cleared = clearTaskCourse(picked, "assignment-1");

  assert.deepEqual(cleared.assignments, {});
  assert.equal(labelForTask(cleared, assignment())?.code, "NRE 1000E");
});

test("assignTaskCourse ignores a course that does not exist", () => {
  const book = bookOf(["NRE 1000E", null]);

  assert.deepEqual(assignTaskCourse(book, "assignment-1", "nope").assignments, {});
});

test("saveCourseBook round-trips through restoreCourseBook", () => {
  const storage = new MemoryStorage();
  const book = bookOf(["NRE 1000E", "LEC"], ["STAT 1000Q", "DIS"]);
  const withPick = assignTaskCourse(book, "assignment-1", book.courses[1].id);
  const withHidden = assignTaskCourse(withPick, "assignment-2", null);

  saveCourseBook(storage, withHidden);

  assert.deepEqual(restoreCourseBook(storage), withHidden);
});

test("restoreCourseBook upgrades the 1.0.1 single label", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    LEGACY_COURSE_LABEL_KEY,
    JSON.stringify({ version: 1, code: "NRE 1000E", component: "LEC" }),
  );

  const book = restoreCourseBook(storage);

  assert.equal(book.courses.length, 1);
  assert.equal(book.courses[0].code, "NRE 1000E");
  assert.equal(book.courses[0].component, "LEC");
  assert.equal(book.courses[0].isDefault, true);
  // Migrating is a one-way door: the old key must not come back.
  assert.equal(storage.getItem(LEGACY_COURSE_LABEL_KEY), null);
  assert.equal(restoreCourseBook(storage).courses.length, 1);
});

test("restoreCourseBook ignores an unreadable legacy label", () => {
  const storage = new MemoryStorage();
  storage.setItem(LEGACY_COURSE_LABEL_KEY, "{not-json");

  assert.deepEqual(restoreCourseBook(storage), EMPTY_COURSE_BOOK);
});

test("restoreCourseBook returns an empty book when nothing is stored", () => {
  assert.deepEqual(restoreCourseBook(new MemoryStorage()), EMPTY_COURSE_BOOK);
});

test("restoreCourseBook clears corrupt data instead of throwing", () => {
  const storage = new MemoryStorage();
  storage.setItem(COURSES_STORAGE_KEY, "{not-json");

  assert.deepEqual(restoreCourseBook(storage), EMPTY_COURSE_BOOK);
  assert.equal(storage.getItem(COURSES_STORAGE_KEY), null);
});

test("parseStoredCourseBook rejects other versions and bad shapes", () => {
  assert.equal(
    parseStoredCourseBook(JSON.stringify({ version: 2, courses: [] })),
    null,
  );
  assert.equal(parseStoredCourseBook(JSON.stringify({ version: 1 })), null);
  assert.equal(parseStoredCourseBook(JSON.stringify(["nope"])), null);
});

test("parseStoredCourseBook drops bad rows and keeps the good ones", () => {
  const book = parseStoredCourseBook(
    JSON.stringify({
      version: 1,
      courses: [
        { id: "a", code: "NRE 1000E", component: "LEC", isDefault: true },
        { id: "b", code: "   " },
        { id: "", code: "NOPE" },
        { id: "c", code: "STAT 1000Q", component: "LECTURE" },
        "not-a-course",
      ],
      assignments: {
        "task-1": "a",
        "task-2": "does-not-exist",
        "task-3": null,
        "": "a",
      },
    }),
  );

  assert.deepEqual(
    book?.courses.map((course) => [course.id, course.code, course.component]),
    [
      ["a", "NRE 1000E", "LEC"],
      ["c", "STAT 1000Q", null],
    ],
  );
  assert.deepEqual(book?.assignments, { "task-1": "a", "task-3": null });
});

test("parseStoredCourseBook allows only one default", () => {
  const book = parseStoredCourseBook(
    JSON.stringify({
      version: 1,
      courses: [
        { id: "a", code: "NRE 1000E", isDefault: true },
        { id: "b", code: "STAT 1000Q", isDefault: true },
      ],
    }),
  );

  assert.deepEqual(
    book?.courses.map((course) => course.isDefault),
    [true, false],
  );
});

test("clearCourseBook removes both the book and the legacy key", () => {
  const storage = new MemoryStorage();
  saveCourseBook(storage, bookOf(["NRE 1000E", "LEC"]));
  storage.setItem(LEGACY_COURSE_LABEL_KEY, "{}");

  clearCourseBook(storage);

  assert.equal(storage.getItem(COURSES_STORAGE_KEY), null);
  assert.equal(storage.getItem(LEGACY_COURSE_LABEL_KEY), null);
});
