"""Scores the announcement rules against gold labels, and says how sure the numbers are.

    python scripts/eval-announcements/score.py events.json [--compare before.json] [--resamples 5000] [--seed 2026] [--json]

`events.json` is written by `export.ts` and holds, per announcement, its half ("dev" or "test"), the gold
events and the events the rules suggested. No announcement text is in it. Standard library only.

An event is (kind, day); the day may be None when the text names none. Per announcement the events are
a set, so one said twice counts once. Three levels, each stricter than the one before:

    kind      which kinds of event the announcement holds, whatever the day
    date      which events, each with its day, the rules settled on
    assisted  the same, where a day the rules left open counts as right when the right day was among the
              choices they offered

Precision, recall and F1 are pooled over the announcements of a half. The 95% interval comes from a
bootstrap over announcements, not sentences or events: the unit that was sampled when the half was
chosen is the announcement, and the events in one announcement are not independent of each other.

With `--compare before.json` (the same announcements scored with an earlier version of the rules) it also
gives the change in F1 with its own interval. The two versions are resampled together, announcement by
announcement, so the interval is for the difference, not two overlapping intervals read by eye.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter

LEVELS = ("kind", "date", "assisted")


def key(event: dict) -> str:
    return f"{event['kind']}|{event['date']}"


def match(predicted: list[str], gold: list[str]) -> tuple[int, int, int]:
    """Multiset match: (true positives, false positives, false negatives)."""
    left = Counter(gold)
    tp = 0
    for item in predicted:
        if left[item] > 0:
            tp += 1
            left[item] -= 1
    return tp, len(predicted) - tp, len(gold) - tp


def score_one(announcement: dict) -> dict[str, tuple[int, int, int]]:
    predicted = announcement["predicted"]
    gold = announcement["gold"]
    predicted_keys = [key(e) for e in predicted]
    gold_keys = [key(e) for e in gold]

    # A day left open counts as right when the right day is among the choices offered, and is not
    # already suggested as an event of its own.
    assisted = []
    for event in predicted:
        if event["date"] is not None:
            assisted.append(key(event))
            continue
        hit = next(
            (
                g
                for g in gold
                if g["kind"] == event["kind"]
                and g["date"] is not None
                and g["date"] in event.get("choices", [])
                and key(g) not in predicted_keys
            ),
            None,
        )
        assisted.append(key(hit) if hit else key(event))

    return {
        "kind": match(sorted({e["kind"] for e in predicted}), sorted({e["kind"] for e in gold})),
        "date": match(predicted_keys, gold_keys),
        "assisted": match(assisted, gold_keys),
    }


def rates(tp: int, fp: int, fn: int) -> dict[str, float | None]:
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision is not None and recall is not None and precision + recall else None
    return {"precision": precision, "recall": recall, "f1": f1}


def pooled(rows: list[dict[str, tuple[int, int, int]]], level: str) -> tuple[int, int, int]:
    return (
        sum(r[level][0] for r in rows),
        sum(r[level][1] for r in rows),
        sum(r[level][2] for r in rows),
    )


def percentile(sorted_values: list[float], q: float) -> float:
    """Linear-interpolated percentile of an already sorted list."""
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = q * (len(sorted_values) - 1)
    lower = int(position)
    upper = min(lower + 1, len(sorted_values) - 1)
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * (position - lower)


def bootstrap(rows: list[dict[str, tuple[int, int, int]]], level: str, resamples: int, rng: random.Random) -> dict[str, tuple[float, float] | None]:
    """95% percentile interval for precision, recall and F1, resampling announcements with replacement."""
    draws: dict[str, list[float]] = {"precision": [], "recall": [], "f1": []}
    for _ in range(resamples):
        sample = [rows[rng.randrange(len(rows))] for _ in rows]
        r = rates(*pooled(sample, level))
        for name, value in r.items():
            if value is not None:
                draws[name].append(value)
    out: dict[str, tuple[float, float] | None] = {}
    for name, values in draws.items():
        values.sort()
        # An interval over fewer than half the resamples says too little to be worth printing.
        out[name] = (percentile(values, 0.025), percentile(values, 0.975)) if len(values) >= resamples / 2 else None
    return out


def paired_change(after: list[dict], before: list[dict], level: str, resamples: int, rng: random.Random) -> dict:
    """Change in pooled F1, after minus before, with a 95% interval from resampling announcements together."""
    f1_after = rates(*pooled(after, level))["f1"]
    f1_before = rates(*pooled(before, level))["f1"]
    changes = []
    for _ in range(resamples):
        picks = [rng.randrange(len(after)) for _ in after]
        a = rates(*pooled([after[i] for i in picks], level))["f1"]
        b = rates(*pooled([before[i] for i in picks], level))["f1"]
        if a is not None and b is not None:
            changes.append(a - b)
    changes.sort()
    return {
        "before": f1_before,
        "after": f1_after,
        "change": None if f1_after is None or f1_before is None else f1_after - f1_before,
        "ci95": (percentile(changes, 0.025), percentile(changes, 0.975)) if len(changes) >= resamples / 2 else None,
        "shareBetter": sum(1 for c in changes if c > 0) / len(changes) if changes else None,
    }


def evaluate(data: dict, resamples: int, seed: int, before: dict | None = None) -> dict:
    result: dict = {}
    for part in ("dev", "test"):
        rows = [score_one(a) for a in data["announcements"] if a["split"] == part]
        events = sum(len(a["gold"]) for a in data["announcements"] if a["split"] == part)
        entry: dict = {"announcements": len(rows), "goldEvents": events, "levels": {}}
        if before is not None:
            if len(before["announcements"]) != len(data["announcements"]) or any(
                b["split"] != a["split"] or b["gold"] != a["gold"] for a, b in zip(data["announcements"], before["announcements"])
            ):
                raise SystemExit("--compare: the two files are not the same announcements with the same gold labels")
            prior = [score_one(a) for a in before["announcements"] if a["split"] == part]
            entry["vsBefore"] = {level: paired_change(rows, prior, level, resamples, random.Random(f"{seed}:{part}:{level}:paired")) for level in LEVELS} if rows else {}
        if rows:
            for level in LEVELS:
                tp, fp, fn = pooled(rows, level)
                # One generator per half and level, so a half's interval does not depend on the others.
                rng = random.Random(f"{seed}:{part}:{level}")
                entry["levels"][level] = {"tp": tp, "fp": fp, "fn": fn, **rates(tp, fp, fn), "ci95": bootstrap(rows, level, resamples, rng)}
        result[part] = entry
    return result


def pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def interval(ci: tuple[float, float] | None) -> str:
    return "" if ci is None else f" [{ci[0] * 100:.1f}, {ci[1] * 100:.1f}]"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("events", help="events.json from export.ts")
    parser.add_argument("--compare", metavar="BEFORE", help="events.json made with an earlier version of the rules")
    parser.add_argument("--resamples", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--json", action="store_true", help="print the numbers as JSON")
    args = parser.parse_args()

    with open(args.events, encoding="utf8") as handle:
        data = json.load(handle)
    before = None
    if args.compare:
        with open(args.compare, encoding="utf8") as handle:
            before = json.load(handle)
    result = evaluate(data, args.resamples, args.seed, before)

    if args.json:
        json.dump(result, sys.stdout, indent=1)
        print()
        return 0

    for part, entry in result.items():
        print(f"\n{part}: {entry['announcements']} announcements, {entry['goldEvents']} gold events")
        for level, row in entry["levels"].items():
            ci = row["ci95"]
            print(
                f"  {level:<9} precision {pct(row['precision'])}{interval(ci['precision'])}"
                f"   recall {pct(row['recall'])}{interval(ci['recall'])}"
                f"   F1 {pct(row['f1'])}{interval(ci['f1'])}"
                f"   (tp {row['tp']}, fp {row['fp']}, fn {row['fn']})"
            )
        for level, change in entry.get("vsBefore", {}).items():
            if change["change"] is None:
                continue
            low_high = "" if change["ci95"] is None else f" [{change['ci95'][0] * 100:+.1f}, {change['ci95'][1] * 100:+.1f}]"
            print(
                f"  {level:<9} F1 {pct(change['before'])} -> {pct(change['after'])}"
                f"   change {change['change'] * 100:+.1f} points{low_high}"
                f"   better in {change['shareBetter'] * 100:.1f}% of resamples"
            )
    print(f"\n95% intervals: percentile bootstrap over announcements, {args.resamples} resamples, seed {args.seed}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
