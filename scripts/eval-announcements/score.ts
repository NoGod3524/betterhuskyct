/**
 * Runs the rules over the announcements and scores them against gold.json.
 *
 *   node --experimental-strip-types scripts/eval-announcements/score.ts <dataDir> [--errors]
 *
 * Prints precision, recall and F1 at three levels for the tuning half ("dev") and the half kept back
 * ("test"). With --errors it also prints every miss and every false alarm in the tuning half; the
 * kept-back half is never listed, so the rules are not fitted to it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { add, distinct, eventKey, flatten, loadAnnouncements, predict, rates, score, splitOf, zero, type Counts, type Labels, type Level } from "./common.ts";

const [dataDir, flag] = process.argv.slice(2);
if (!dataDir) throw new Error("usage: score.ts <dataDir> [--errors]");

const all = loadAnnouncements(join(dataDir, "announcements.json"));
const announcements = distinct(all);
const gold = JSON.parse(readFileSync(join(dataDir, "gold.json"), "utf8")) as Record<string, Labels>;
const split = splitOf(all);
const LEVELS: Level[] = ["kind", "date", "assisted"];

const fresh = () => Object.fromEntries(LEVELS.map((l) => [l, zero()])) as Record<Level, Counts>;
const totals = { dev: fresh(), test: fresh() };
const size = { dev: { announcements: 0, events: 0 }, test: { announcements: 0, events: 0 } };

for (const announcement of announcements) {
  const part = split.get(announcement.id)!;
  const { events, options } = predict(announcement);
  const g = flatten(gold[announcement.id] ?? {});
  const counts = score(events, options, g);
  for (const level of LEVELS) add(totals[part][level], counts[level]);
  size[part].announcements += 1;
  size[part].events += g.length;

  if (flag === "--errors" && part === "dev") {
    const p = events.map(eventKey).sort();
    const q = g.map(eventKey).sort();
    const missed = q.filter((key) => !p.includes(key));
    const extra = p.filter((key) => !q.includes(key));
    if (missed.length + extra.length > 0) console.log(`[${announcement.id.slice(0, 6)}] ${announcement.title.slice(0, 50)}
    extra: ${extra.join(" ; ") || "-"}
    missed: ${missed.join(" ; ") || "-"}`);
  }
}

const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
for (const part of ["dev", "test"] as const) {
  console.log(`\n${part}: ${size[part].announcements} announcements, ${size[part].events} gold events`);
  for (const level of LEVELS) {
    const r = rates(totals[part][level]);
    console.log(`  ${level.padEnd(9)} precision ${pct(r.precision).padStart(6)}  recall ${pct(r.recall).padStart(6)}  F1 ${pct(r.f1).padStart(6)}   (tp ${r.tp}, fp ${r.fp}, fn ${r.fn})`);
  }
}
