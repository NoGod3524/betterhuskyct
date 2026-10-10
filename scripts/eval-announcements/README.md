# How well do the announcement rules find dates and to-dos?

The rules in `src/lib/announcement-actions.ts` and `announcement-dates.ts` read an announcement and
suggest the deadlines, exams, quizzes and cancelled classes in it. This folder measures how right they
are, against labels made by a language model and checked by hand. Nothing here runs in the app.

The announcements themselves are real course text, so they stay outside the repository; only the
scripts and the totals below are committed.

## What is counted

- **Event.** Something a student would put on a to-do list or a calendar, of one of four kinds:
  `deadline` (work to hand in or finish, including a deadline that was moved), `exam`, `quiz`,
  `no-class`. Office hours, readings with no deadline, advice and things already past are not events.
- **Unit.** One sentence, cut by the app's own cutter, with the title as unit 0. Labels are made per
  unit, so a person can check each against its sentence.
- **Per announcement.** The rules' events and the gold events are each a set of `(kind, day)` for the
  announcement, so an event said twice, or in the title and again in the text, counts once. Two
  different things of one kind due on the same day (two homeworks on 9/13) count once as well.
- **Copies.** The same text posted to several sections is one announcement (the 88 synced ones are 85).

Three levels, each stricter than the one before:

| Level | A suggestion is right when |
| --- | --- |
| `kind` | the announcement does hold an event of that kind, whatever the day |
| `date` | the kind and the day (YYYY-MM-DD) both agree; an event with no day agrees with an event with no day |
| `assisted` | as `date`, and a day the rules left to the student also counts when the right day is among the choices offered |

Precision is the share of what the rules suggested that was right. Recall is the share of the real
events that the rules suggested. F1 is the two together.

## How the labels were made

1. `label.ts` gives `deepseek-flash` each announcement, cut into numbered units, with the posting day
   to work "Friday" or "tomorrow" out from, and asks for the events in each unit as JSON. It does this
   twice, with two differently worded instructions (`A` at temperature 0, `B` at 0.3).
2. `agree.ts` compares the passes unit by unit. Where they agree the label stands. Of 800 units, 17
   differed (97.9% agree); each of those was read against the whole announcement and decided by hand,
   by Claude, which also wrote the instructions to the model; the student whose courses they are has
   not checked them.
3. The labels are therefore a careful model's reading, not an independent human one. Some are
   arguable: a reading assignment "for today" was labelled a deadline by both passes, and the kind of
   an event in a weekly schedule ("Quiz 2 (on Chapter 2)") is a judgement call. Nothing was changed
   after the rules were scored.

## The split

Half of the announcements (by course, alternating, fixed by id) are `dev`, which the rules were
tuned on, and half are `test`, which `score.ts --errors` never lists, so no change was made by
looking at a miss in it. Its totals were printed along the way, so it is a held-back half, not a
sealed one.

## Results

Rules before this change, and after, on 88 announcements (85 distinct texts, 45 dev and 40 test).
`test` holds 28 events, so a figure there is good to about ±15 points either way.

| | | precision | recall | F1 |
| --- | --- | --- | --- | --- |
| dev | kind, before → after | 75.0 → 100.0 | 92.3 → 87.2 | 82.8 → 93.2 |
| dev | date, before → after | 45.5 → 92.9 | 74.5 → 83.0 | 56.5 → 87.6 |
| dev | assisted, before → after | 53.2 → 92.9 | 87.2 → 83.0 | 66.1 → 87.6 |
| **test** | kind, before → after | 68.0 → 69.6 | 73.9 → 69.6 | 70.8 → 69.6 |
| **test** | date, before → after | 44.4 → 66.7 | 71.4 → 71.4 | 54.8 → 69.0 |
| **test** | assisted, before → after | 46.7 → 66.7 | 75.0 → 71.4 | 57.5 → 69.0 |

What the numbers say:

- In the tuning half, most of the false alarms were sentences that only mention an exam or a quiz ("study as you would
  for an exam", "the final exam includes material from six chapters", office hours) and sentences
  that give several days, where the rules took them all.
- On the held-back half the day-level F1 rose from 54.8 to 69.0, mostly through precision. The gain
  on the tuning half is larger (56.5 to 87.6) because the rules were shaped by it; the held-back
  figure is the one to quote.
- The kind-level figure did not move on the held-back half. In the tuning half what is still missed
  is mostly an event in a sentence with no keyword, an event with no day in a weekly schedule, and
  labels that are arguable; the held-back misses were not read.

## What changed in the rules

- A bare, "this" or "next" weekday is now worked out (the next such day after the posting; "next"
  is the one in the week after), still marked to be checked. A slash date that reads two ways is
  taken when only one reading is within 14 days before to 120 days after the posting, or fits the
  weekday written beside it ("Sunday 10/11"); both readings are still offered.
- Of several days in a sentence, the one after "due", "by" or "until" is taken, else the one nearest
  the exam or quiz named once; "today" is dropped when the sentence names another day; the first end
  of "from A till B" is dropped.
- An exam or quiz sentence with no day is offered only if it says it is to happen; "office hours" and
  past "uploaded" or "submitted" are not deadlines; an undated title is dropped when the text gives
  a dated one of the same kind.

## Running it

```
node --experimental-strip-types --import ./tests/support/register-tsx.mjs scripts/eval-announcements/label.ts <dataDir> <keyFile>
node --experimental-strip-types --import ./tests/support/register-tsx.mjs scripts/eval-announcements/agree.ts <dataDir>
node --experimental-strip-types --import ./tests/support/register-tsx.mjs scripts/eval-announcements/score.ts <dataDir> [--errors]
```

`<dataDir>` holds `announcements.json`, the value of `huskypilot.announcements.v1` from the browser.
`<keyFile>` is a text file with a DeepSeek key in it; the key is read, sent to the API, and never
printed or written.
