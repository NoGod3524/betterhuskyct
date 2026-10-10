import assert from "node:assert/strict";
import test from "node:test";

import {
  dismiss,
  EMPTY_DECISIONS,
  isUnreviewed,
  linkNotices,
  markAdded,
  markLinkChecked,
  markLinkMoved,
  markReviewed,
  parseDecisions,
  undismiss,
  type Added,
} from "../src/lib/announcement-decisions.ts";
import { diffText, isNotable, latestChange, parseVersions, recordVersions, type VersionStore } from "../src/lib/announcement-versions.ts";
import type { Announcement } from "../src/lib/announcements.ts";

const POSTED = "10/5/26, 4:00 PM";
const T1 = new Date("2026-10-05T21:00:00Z");
const T2 = new Date("2026-10-06T21:00:00Z");
const T3 = new Date("2026-10-07T21:00:00Z");

const ann = (body: string, title = "Quiz 3"): Announcement => ({ id: "a1", courseId: null, courseCode: "STAT 1000Q", title, body, posted: POSTED, announced: T1.toISOString() });

// --- versions ---------------------------------------------------------------------------------------

test("the first reading is the first version, reading the same text again records nothing, and a changed text is a new version", () => {
  const first = recordVersions({}, [ann("Quiz 3 is due October 9.")], T1);
  assert.deepEqual(first.a1.map((v) => v.at), [T1.toISOString()]);
  assert.equal(recordVersions(first, [ann("Quiz 3 is due October 9.")], T2), first, "a repeated sync changed the store");
  const second = recordVersions(first, [ann("Quiz 3 is due October 12.")], T2);
  assert.equal(second.a1.length, 2);
  assert.equal(first.a1.length, 1, "the earlier store was changed in place");
});

test("only the last few versions are kept, and what is stored is read back only when it is in shape", () => {
  let store: VersionStore = {};
  for (let i = 0; i < 9; i += 1) store = recordVersions(store, [ann(`Version ${i}`)], new Date(T1.valueOf() + i * 1000));
  assert.equal(store.a1.length, 6);
  assert.equal(store.a1[5].body, "Version 8");
  assert.deepEqual(parseVersions(JSON.stringify(store)), store);
  assert.deepEqual(parseVersions("{"), {});
  assert.deepEqual(parseVersions(JSON.stringify({ a1: [{ at: "nope", title: "x", body: "y" }, 5], a2: "x" })), {});
});

// --- comparing --------------------------------------------------------------------------------------

test("a word-by-word comparison keeps what stayed and marks what was added and what was taken out", () => {
  const segments = diffText("Quiz 3 is due October 9.", "Quiz 3 is now due October 12.");
  assert.deepEqual(segments.map((s) => [s.kind, s.text]), [["same", "Quiz 3 is "], ["added", "now "], ["same", "due October "], ["removed", "9."], ["added", "12."]]);
  assert.equal(segments.filter((s) => s.kind !== "added").map((s) => s.text).join(""), "Quiz 3 is due October 9.");
  assert.equal(segments.filter((s) => s.kind !== "removed").map((s) => s.text).join(""), "Quiz 3 is now due October 12.");
});

test("a change names the days that went and the days that came, and notes a cancellation that was not there before", () => {
  const moved = recordVersions(recordVersions({}, [ann("Quiz 3 is due October 9.")], T1), [ann("Quiz 3 is due October 12.")], T2);
  const change = latestChange("a1", moved.a1, POSTED)!;
  assert.deepEqual([change.datesRemoved, change.datesAdded, change.cancelled], [["2026-10-09"], ["2026-10-12"], false]);
  assert.ok(isNotable(change));

  const cancelled = recordVersions(recordVersions({}, [ann("Class meets October 12.", "Class")], T1), [ann("Class on October 12 is cancelled.", "Class")], T2);
  assert.equal(latestChange("a1", cancelled.a1, POSTED)!.cancelled, true);

  const typo = recordVersions(recordVersions({}, [ann("Quiz 3 is due October 9. Bring a pencill.")], T1), [ann("Quiz 3 is due October 9. Bring a pencil.")], T2);
  assert.equal(isNotable(latestChange("a1", typo.a1, POSTED)!), false, "a fixed typo is not a notable change");
});

test("with one version, or two that read the same, there is no change to show", () => {
  const one = recordVersions({}, [ann("Quiz 3 is due October 9.")], T1);
  assert.equal(latestChange("a1", one.a1, POSTED), null);
  assert.equal(latestChange("a1", undefined, POSTED), null);
});

// --- the student's decisions ------------------------------------------------------------------------

const ADDED: Added = { taskId: "custom-1", taskKind: "event", announcementId: "a1", sentence: "Quiz 3 is due October 9.", day: "2026-10-09", title: "Quiz 3", addedAt: T1.toISOString(), versionAt: T1.toISOString() };

test("a decision is kept, taken back, and read back only when it is in shape", () => {
  let decisions = dismiss(EMPTY_DECISIONS, "c1");
  assert.equal(decisions.dismissed.c1, true);
  assert.equal(undismiss(decisions, "c1").dismissed.c1, undefined);
  decisions = markAdded(decisions, "c2", ADDED);
  decisions = markReviewed(decisions, "a1", T2.toISOString());
  assert.deepEqual(parseDecisions(JSON.stringify(decisions)), decisions);
  assert.deepEqual(parseDecisions("{"), EMPTY_DECISIONS);
  assert.deepEqual(parseDecisions(JSON.stringify({ version: 2 })), EMPTY_DECISIONS);
  assert.deepEqual(parseDecisions(JSON.stringify({ version: 1, added: { x: { taskId: "" } } })).added, {});
});

test("a change is unreviewed until the student has looked at that version", () => {
  const store = recordVersions(recordVersions({}, [ann("Quiz 3 is due October 9.")], T1), [ann("Quiz 3 is due October 12.")], T2);
  const change = latestChange("a1", store.a1, POSTED);
  assert.equal(isUnreviewed(change, EMPTY_DECISIONS), true);
  assert.equal(isUnreviewed(change, markReviewed(EMPTY_DECISIONS, "a1", T2.toISOString())), false);
  assert.equal(isUnreviewed(null, EMPTY_DECISIONS), false);
});

test("a task made from an announcement that moves its day raises a notice, with the new day to offer, and is quiet once looked at", () => {
  const decisions = markAdded(EMPTY_DECISIONS, "c1", ADDED);
  let store = recordVersions({}, [ann("Quiz 3 is due October 9.")], T1);
  assert.deepEqual(linkNotices(decisions, [ann("Quiz 3 is due October 9.")], store), [], "nothing has changed yet");

  store = recordVersions(store, [ann("Quiz 3 is due October 12.")], T2);
  const notices = linkNotices(decisions, [ann("Quiz 3 is due October 12.")], store);
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].reasons, ["date-changed", "sentence-changed"]);
  assert.deepEqual(notices[0].newDays, ["2026-10-12"]);

  const looked = markLinkChecked(decisions, "c1", T2.toISOString());
  assert.deepEqual(linkNotices(looked, [ann("Quiz 3 is due October 12.")], store), []);
});

test("a cancellation, or the sentence going, raises a notice for a task with no day; an unrelated edit does not", () => {
  const undated = markAdded(EMPTY_DECISIONS, "c1", { ...ADDED, taskKind: "undated", day: null, sentence: "Homework 5 is due next class." });
  const base = ann("Homework 5 is due next class. Bring the form.");
  let store = recordVersions({}, [base], T1);
  store = recordVersions(store, [ann("Homework 5 is due next class. Bring the signed form.")], T2);
  assert.deepEqual(linkNotices(undated, [ann("Homework 5 is due next class. Bring the signed form.")], store), [], "an unrelated edit raised a notice");

  store = recordVersions(store, [ann("Homework 5 is cancelled.")], T3);
  const notices = linkNotices(undated, [ann("Homework 5 is cancelled.")], store);
  assert.deepEqual(notices[0].reasons, ["cancelled", "sentence-changed"]);
});

test("a notice is not raised for an announcement that is no longer held", () => {
  const decisions = markAdded(EMPTY_DECISIONS, "c1", ADDED);
  const store = recordVersions(recordVersions({}, [ann("Quiz 3 is due October 9.")], T1), [ann("Quiz 3 is due October 12.")], T2);
  assert.deepEqual(linkNotices(decisions, [], store), []);
});

test("moving a task makes the link follow it, so the next change is compared with the new day and sentence", () => {
  let decisions = markAdded(EMPTY_DECISIONS, "c1", ADDED);
  let store = recordVersions(recordVersions({}, [ann("Quiz 3 is due October 9.")], T1), [ann("Quiz 3 is due October 12.")], T2);
  decisions = markLinkMoved(decisions, "c1", { day: "2026-10-12", sentence: "Quiz 3 is due October 12.", versionAt: T2.toISOString() });
  assert.deepEqual(linkNotices(decisions, [ann("Quiz 3 is due October 12.")], store), [], "it asked again about the change it had just followed");
  store = recordVersions(store, [ann("Quiz 3 is due October 14.")], T3);
  const notices = linkNotices(decisions, [ann("Quiz 3 is due October 14.")], store);
  assert.deepEqual(notices[0].reasons, ["date-changed", "sentence-changed"]);
  assert.deepEqual(notices[0].newDays, ["2026-10-14"]);
  assert.equal(markLinkMoved(EMPTY_DECISIONS, "none", { day: "x", sentence: "y", versionAt: "z" }), EMPTY_DECISIONS);
});
