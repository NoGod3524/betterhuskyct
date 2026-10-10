import assert from "node:assert/strict";
import test from "node:test";

import { dateFormatter, formatDate, ymd, ymdParts } from "../src/lib/format-date.ts";

const friday = new Date(2026, 9, 9, 23, 59);

test("a day is yyyy/mm/dd with the month and day padded, from a moment or from its parts", () => {
  assert.equal(ymd(new Date(2026, 0, 5)), "2026/01/05");
  assert.equal(ymdParts({ year: 2026, month: 10, day: 9 }), "2026/10/09");
});

test("the weekday and the time follow the day, in the reader's language", () => {
  assert.equal(formatDate(friday, "en"), "2026/10/09");
  assert.equal(formatDate(friday, "en", { weekday: "short" }), "2026/10/09 Fri");
  assert.equal(formatDate(friday, "en", { weekday: "long" }), "2026/10/09 Friday");
  assert.equal(formatDate(friday, "en", { time: true }), "2026/10/09 11:59 PM");
  assert.equal(formatDate(friday, "zh-CN", { weekday: "short" }), "2026/10/09 周五");
  assert.equal(dateFormatter("en", { weekday: "short" }).format(friday), "2026/10/09 Fri");
});
