import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { add, KINDS, rates, score, zero, type Event, type Level } from "../scripts/eval-announcements/common.ts";

/**
 * score.cpp is a second implementation of the scoring in common.ts, there so that the numbers can be
 * recomputed without the app and so that they carry intervals. The two must agree exactly, so this
 * scores a made-up set with both and compares the counts. Skipped where there is no C++ compiler.
 */
const compiler = ["g++", "c++", "clang++"].find((name) => spawnSync(name, ["--version"]).status === 0);
const work = mkdtempSync(join(tmpdir(), "eval-cpp-"));
const binary = join(work, process.platform === "win32" ? "score.exe" : "score");

if (compiler) {
  const built = spawnSync(compiler, ["-O2", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-o", binary, "scripts/eval-announcements/score.cpp"], { encoding: "utf8" });
  assert.equal(built.status, 0, `score.cpp does not compile: ${built.stderr}`);
}

type Row = { split: "dev" | "test"; gold: Event[]; predicted: Array<Event & { choices: string[] }> };

/** A small seeded generator, so the made-up set is the same every run. */
function generator(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function madeUp(count: number, seed = 7): Row[] {
  const next = generator(seed);
  const days = ["2026-10-05", "2026-10-09", "2026-10-12", "2026-10-16", null];
  const pick = <T,>(list: readonly T[]) => list[Math.floor(next() * list.length)];
  return Array.from({ length: count }, (_, index) => {
    const gold = Array.from({ length: Math.floor(next() * 4) }, () => ({ kind: pick(KINDS), date: pick(days) }));
    const predicted = Array.from({ length: Math.floor(next() * 4) }, () => {
      // Half of what the rules suggest is taken from the gold, the rest is invented.
      const event = gold.length > 0 && next() < 0.5 ? pick(gold) : { kind: pick(KINDS), date: pick(days) };
      // An open day offers choices, sometimes including the right one.
      const choices = event.date === null ? [pick(days.filter((d): d is string => d !== null)), pick(days.filter((d): d is string => d !== null))] : [];
      return { ...event, choices };
    });
    // One entry per (kind, day), as the real export has.
    const seen = new Set<string>();
    const unique = (list: Event[]) => list.filter((e) => (seen.has(`${e.kind}|${e.date}`) ? false : (seen.add(`${e.kind}|${e.date}`), true)));
    const goldSet = unique(gold);
    seen.clear();
    return { split: index % 2 === 0 ? "dev" : "test", gold: goldSet, predicted: unique(predicted) as Row["predicted"] };
  });
}

/** The cases the random set rarely reaches: a day left open whose right day is also suggested on its own. */
const EDGES: Row[] = [
  { split: "test", gold: [{ kind: "quiz", date: "2026-10-09" }], predicted: [{ kind: "quiz", date: null, choices: ["2026-10-09"] }, { kind: "quiz", date: "2026-10-09", choices: [] }] },
  { split: "test", gold: [{ kind: "exam", date: "2026-10-12" }], predicted: [{ kind: "exam", date: null, choices: ["2026-10-12", "2026-10-19"] }] },
  { split: "dev", gold: [{ kind: "deadline", date: null }], predicted: [{ kind: "deadline", date: null, choices: ["2026-10-12"] }] },
  { split: "dev", gold: [], predicted: [] },
];

/** The text format export.ts writes. */
function write(rows: Row[], name: string): string {
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(`A ${row.split}`);
    for (const e of row.gold) lines.push(`G ${e.kind} ${e.date ?? "-"}`);
    for (const e of row.predicted) lines.push(`P ${e.kind} ${e.date ?? "-"} ${e.choices.length > 0 ? e.choices.join(",") : "-"}`);
  }
  const path = join(work, name);
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

function run(args: string[]) {
  const done = spawnSync(binary, [...args, "--resamples", "300"], { encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
  return done;
}

test("score.cpp counts exactly what the TypeScript scoring counts", { skip: !compiler }, () => {
  const rows = [...madeUp(60), ...EDGES];
  const result = JSON.parse(run([write(rows, "events.txt"), "--json"]).stdout);

  for (const part of ["dev", "test"] as const) {
    const totals: Record<Level, ReturnType<typeof zero>> = { kind: zero(), date: zero(), assisted: zero() };
    for (const row of rows.filter((r) => r.split === part)) {
      const options = new Map(row.predicted.filter((e) => e.date === null).map((e) => [`${e.kind}|null`, e.choices]));
      const counts = score(row.predicted.map(({ kind, date }) => ({ kind, date })), options, row.gold);
      for (const level of Object.keys(totals) as Level[]) add(totals[level], counts[level]);
    }
    for (const level of Object.keys(totals) as Level[]) {
      const { tp, fp, fn, precision, recall, f1 } = result[part].levels[level];
      assert.deepEqual({ tp, fp, fn }, totals[level], `${part} ${level}`);
      const expected = rates(totals[level]);
      for (const [name, value] of [["precision", precision], ["recall", recall], ["f1", f1]] as const) {
        assert.ok(Math.abs((value ?? -1) - (expected[name] ?? -1)) < 1e-12, `${part} ${level} ${name}`);
      }
    }
  }
});

test("the interval is repeatable, holds the point estimate, and an unchanged version shows no change", { skip: !compiler }, () => {
  const file = write(madeUp(60), "events.txt");
  const first = run([file, "--json"]).stdout;
  assert.equal(run([file, "--json"]).stdout, first, "the same seed gave a different interval");
  assert.notEqual(run([file, "--json", "--seed", "1"]).stdout, first, "the seed changes nothing");

  const date = JSON.parse(first).test.levels.date;
  assert.ok(date.ci95.f1[0] <= date.f1 && date.f1 <= date.ci95.f1[1], "the F1 is outside its own interval");

  const same = JSON.parse(run([file, "--compare", file, "--json"]).stdout);
  for (const level of ["kind", "date", "assisted"]) assert.equal(same.test.vsBefore[level].change, 0, level);
});

test("a change in the rules shows as a change, and files of different announcements are refused", { skip: !compiler }, () => {
  const rows = madeUp(60);
  // The "after" rules suggest exactly the gold events; the "before" rules suggested one thing that
  // was never there and found at most one of the real ones.
  const gold = (row: Row) => row.gold.map((event) => ({ ...event, choices: [] }));
  const afterRows = rows.map((row) => ({ ...row, predicted: gold(row) }));
  const before = rows.map((row) => ({ ...row, predicted: [{ kind: "quiz" as const, date: "2099-01-01", choices: [] }, ...gold(row).slice(0, 1)] }));
  const result = JSON.parse(run([write(afterRows, "after.txt"), "--compare", write(before, "before.txt"), "--json"]).stdout);
  assert.ok(result.test.vsBefore.date.change > 0, "suggesting the right things did not improve on suggesting one wrong thing");

  const other = spawnSync(binary, [write(rows, "a.txt"), "--compare", write(madeUp(30, 99), "b.txt")], { encoding: "utf8" });
  assert.notEqual(other.status, 0);
  assert.match(other.stderr, /not the same announcements/);
});
