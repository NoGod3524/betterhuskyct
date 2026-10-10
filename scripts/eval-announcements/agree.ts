/**
 * Compares the two labelling passes. Where they agree the label stands; where they differ the unit
 * is written to <dataDir>/disagreements.json for a person to decide, and the decisions go in
 * <dataDir>/adjudicated.json ({ "<announcementId>": { "<unit>": [events] } }). Writes gold.json.
 *
 *   node --experimental-strip-types scripts/eval-announcements/agree.ts <dataDir>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { eventKey, loadAnnouncements, match, rates, unitsOf, zero, add, type Labels } from "./common.ts";

const [dataDir] = process.argv.slice(2);
if (!dataDir) throw new Error("usage: agree.ts <dataDir>");
const read = <T>(name: string): T => JSON.parse(readFileSync(join(dataDir, name), "utf8")) as T;

const announcements = loadAnnouncements(join(dataDir, "announcements.json"));
const A = read<Record<string, Labels>>("labels-A.json");
const B = read<Record<string, Labels>>("labels-B.json");
const decided = existsSync(join(dataDir, "adjudicated.json")) ? read<Record<string, Labels>>("adjudicated.json") : {};

const gold: Record<string, Labels> = {};
const disagreements: Array<{ announcement: string; unit: number; text: string; A: string[]; B: string[]; decided: boolean }> = [];
let units = 0;
const agreement = zero();

for (const announcement of announcements) {
  gold[announcement.id] = {};
  for (const unit of unitsOf(announcement)) {
    units += 1;
    const a = (A[announcement.id]?.[unit.i] ?? []).map(eventKey).sort();
    const b = (B[announcement.id]?.[unit.i] ?? []).map(eventKey).sort();
    add(agreement, match(a, b));
    if (a.join() === b.join()) {
      if (a.length > 0) gold[announcement.id][unit.i] = A[announcement.id][unit.i];
      continue;
    }
    const ruling = decided[announcement.id]?.[unit.i];
    disagreements.push({ announcement: announcement.id, unit: unit.i, text: unit.text, A: a, B: b, decided: ruling !== undefined });
    if (ruling && ruling.length > 0) gold[announcement.id][unit.i] = ruling;
  }
}

writeFileSync(join(dataDir, "disagreements.json"), JSON.stringify(disagreements, null, 1));
writeFileSync(join(dataDir, "gold.json"), JSON.stringify(gold, null, 1));
const events = Object.values(gold).reduce((n, labels) => n + Object.values(labels).reduce((m, list) => m + list.length, 0), 0);
console.log(JSON.stringify({ announcements: announcements.length, units, goldEvents: events, disagreeingUnits: disagreements.length, undecided: disagreements.filter((d) => !d.decided).length, passAgainstPass: rates(agreement) }, null, 1));
