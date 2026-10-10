/**
 * Labels the announcements with DeepSeek, twice, with two differently worded instructions.
 *
 *   node --experimental-strip-types scripts/eval-announcements/label.ts <dataDir> <keyFile>
 *
 * Reads <dataDir>/announcements.json, writes <dataDir>/labels-A.json and labels-B.json. The key is
 * read from the file and sent only to the API; it is never printed. Course text goes to DeepSeek,
 * so the data stays in <dataDir>, outside the repository.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { KINDS, loadAnnouncements, referenceDay, unitsOf, type Event, type Labels } from "./common.ts";

const [dataDir, keyFile] = process.argv.slice(2);
if (!dataDir || !keyFile) throw new Error("usage: label.ts <dataDir> <keyFile>");
// The file may carry a label next to the key, so take the token that looks like one.
const key = /sk-[A-Za-z0-9_-]+/.exec(readFileSync(keyFile, "utf8"))?.[0] ?? "";
if (!key) throw new Error("no key found in the key file");
const URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-flash";

const SCOPE = `An "event" is something a student would put on a to-do list or a calendar. There are four kinds:
- "deadline": work to hand in, submit or finish by a time (homework, assignment, project, paper, lab report, a form, a registration), including when a deadline is moved or extended (the event is the NEW deadline).
- "exam": an exam, midterm, final exam or test.
- "quiz": a quiz.
- "no-class": a class, lecture, lab or section that is cancelled or will not meet.
Not events: office hours, a class that simply meets as usual, reading to do with no deadline, general advice, links, greetings, results and grades, things already in the past.`;

const DATES = `For each event give "date" as YYYY-MM-DD if the text fixes the day, working out words like "tomorrow", "this Friday" or "next Tuesday" from the posting day given below, and taking the year from the posting day when none is written. Give null when no day is fixed ("next class", "soon", "next week" with no weekday). If a sentence names several days for several events, give one event for each.`;

const PROMPTS = {
  A: `You label course announcements for a study. ${SCOPE}\n\n${DATES}\n\nYou get the announcement as numbered pieces: piece 0 is the title and the rest are sentences. Label each piece on its own, using the other pieces only for context. Answer with JSON only: {"units":[{"i":<number>,"events":[{"kind":"deadline|exam|quiz|no-class","date":"YYYY-MM-DD"|null}]}]}, listing only the pieces that hold at least one event.`,
  B: `Read a university course announcement and find every event in it. First decide, piece by piece, whether the piece itself announces an event; a piece that only repeats the topic, or only hints, does not. Definitions:\n${SCOPE}\n\nDay rule: ${DATES}\n\nThe announcement is given as numbered pieces (0 is the title). Return JSON only, in exactly this shape: {"units":[{"i":<piece number>,"events":[{"kind":"deadline|exam|quiz|no-class","date":"YYYY-MM-DD" or null}]}]}. Leave out pieces with no event. If there is no event in the whole announcement, return {"units":[]}.`,
} as const;

async function ask(prompt: string, user: string, temperature: number): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: MODEL, temperature, stream: false, response_format: { type: "json_object" }, messages: [{ role: "system", content: prompt }, { role: "user", content: user }] }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 200).replace(key, "***")}`);
      const body = (await response.json()) as { choices: Array<{ message: { content: string } }> };
      return body.choices[0].message.content;
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
}

function clean(raw: string, unitCount: number): Labels {
  const parsed = JSON.parse(raw) as { units?: Array<{ i: number; events?: Array<{ kind?: string; date?: string | null }> }> };
  const labels: Labels = {};
  for (const unit of parsed.units ?? []) {
    if (!Number.isInteger(unit.i) || unit.i < 0 || unit.i >= unitCount) continue;
    const events: Event[] = [];
    for (const event of unit.events ?? []) {
      if (!(KINDS as readonly string[]).includes(event.kind ?? "")) continue;
      const date = typeof event.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.date) ? event.date : null;
      events.push({ kind: event.kind as Event["kind"], date });
    }
    if (events.length > 0) labels[String(unit.i)] = events;
  }
  return labels;
}

const announcements = loadAnnouncements(join(dataDir, "announcements.json"));
const out: Record<"A" | "B", Record<string, Labels>> = { A: {}, B: {} };
let next = 0;

async function worker() {
  while (next < announcements.length) {
    const announcement = announcements[next++];
    const units = unitsOf(announcement);
    const user = `Posting day: ${referenceDay(announcement)}\nCourse: ${announcement.courseCode ?? "unknown"}\n\n${units.map((unit) => `[${unit.i}] ${unit.text}`).join("\n")}`;
    for (const [name, temperature] of [["A", 0], ["B", 0.3]] as const) {
      out[name][announcement.id] = clean(await ask(PROMPTS[name], user, temperature), units.length);
    }
    process.stdout.write(".");
  }
}

await Promise.all(Array.from({ length: 4 }, worker));
for (const name of ["A", "B"] as const) writeFileSync(join(dataDir, `labels-${name}.json`), JSON.stringify(out[name], null, 1));
console.log(`\nlabelled ${announcements.length} announcements twice`);
