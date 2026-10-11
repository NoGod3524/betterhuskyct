/**
 * Writes what scoring needs, with no text in it: for each distinct announcement, which half it is in,
 * the gold events, and the events the rules suggest (with the days they offered when they left one
 * open). `score.py` reads this, so the numbers can be recomputed without the announcements, and by
 * someone who does not run the app.
 *
 *   node --experimental-strip-types scripts/eval-announcements/export.ts <dataDir> [outFile]
 *
 * Reads <dataDir>/announcements.json and <dataDir>/gold.json; writes <dataDir>/events.json unless
 * told otherwise. Announcements are numbered, not named, and are in a fixed order.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { distinct, flatten, loadAnnouncements, predict, splitOf, type Event, type Labels } from "./common.ts";

const [dataDir, outFile] = process.argv.slice(2);
if (!dataDir) throw new Error("usage: export.ts <dataDir> [outFile]");

const all = loadAnnouncements(join(dataDir, "announcements.json"));
const gold = JSON.parse(readFileSync(join(dataDir, "gold.json"), "utf8")) as Record<string, Labels>;
const split = splitOf(all);

const announcements = distinct(all).map((announcement) => {
  const { events, options } = predict(announcement);
  const predicted = events.map((event: Event) => ({
    kind: event.kind,
    date: event.date,
    // Only an event with no day settled offers choices.
    choices: event.date === null ? [...new Set(options.get(`${event.kind}|null`) ?? [])].sort() : [],
  }));
  return { split: split.get(announcement.id)!, gold: flatten(gold[announcement.id] ?? {}), predicted };
});

writeFileSync(outFile ?? join(dataDir, "events.json"), JSON.stringify({ version: 1, announcements }, null, 1));
console.log(`wrote ${announcements.length} announcements`);
