/**
 * Writes what scoring needs, with no text in it: for each distinct announcement, which half it is in,
 * the gold events, and the events the rules suggest (with the days they offered when they left one
 * open). `score.cpp` reads this, so the numbers can be recomputed without the announcements, and by
 * someone who does not run the app.
 *
 *   node --experimental-strip-types scripts/eval-announcements/export.ts <dataDir> [outFile]
 *
 * Reads <dataDir>/announcements.json and <dataDir>/gold.json; writes <dataDir>/events.txt unless
 * told otherwise. Announcements are in a fixed order and are not named. One line each:
 *
 *   A <dev|test>                              an announcement
 *   G <kind> <day|->                          a gold event ("-" when the text names no day)
 *   P <kind> <day|-> <choice,choice,...|->    an event the rules suggest, with the days offered when open
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { distinct, flatten, loadAnnouncements, predict, splitOf, type Event, type Labels } from "./common.ts";

const [dataDir, outFile] = process.argv.slice(2);
if (!dataDir) throw new Error("usage: export.ts <dataDir> [outFile]");

const all = loadAnnouncements(join(dataDir, "announcements.json"));
const gold = JSON.parse(readFileSync(join(dataDir, "gold.json"), "utf8")) as Record<string, Labels>;
const split = splitOf(all);

const lines: string[] = [];
for (const announcement of distinct(all)) {
  const { events, options } = predict(announcement);
  lines.push(`A ${split.get(announcement.id)!}`);
  for (const event of flatten(gold[announcement.id] ?? {})) lines.push(`G ${event.kind} ${event.date ?? "-"}`);
  for (const event of events as Event[]) {
    // Only an event with no day settled offers choices.
    const choices = event.date === null ? [...new Set(options.get(`${event.kind}|null`) ?? [])].sort() : [];
    lines.push(`P ${event.kind} ${event.date ?? "-"} ${choices.length > 0 ? choices.join(",") : "-"}`);
  }
}

writeFileSync(outFile ?? join(dataDir, "events.txt"), lines.join("\n") + "\n");
console.log(`wrote ${lines.filter((line) => line.startsWith("A ")).length} announcements`);
