# HuskyCT Helper

A userscript that runs inside your own HuskyCT session and does two things:

1. **Merges your course calendars into one `.ics`.** HuskyCT hands out one
   calendar feed per course, so a semester is a dozen links and HuskyPilot can
   only take one at a time. This collects every feed the page already exposes and
   writes a single file you can drop straight into the app.
2. **Reports what a page contains**, so the selectors in this script can be
   written against the real thing instead of guessed.

## What it does not do

- It never asks for, stores, or transmits your **NetID or password**. It uses the
  session your browser already has, exactly as the page itself does.
- It never sends anything anywhere except `huskyct.uconn.edu`.
- The report buttons **strip query strings and fragments**, because a calendar
  feed URL carries a token. A report is meant to be pasted into a chat window, so
  nothing that is a secret goes into it.
- It reads at most one page per press, with a pause between requests, so it does
  not put load on UConn's systems.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox,
   Safari) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the extension's dashboard → **Create a new script**.
3. Delete the template, paste in the whole of `huskyct-helper.user.js`, and save.
4. Open HuskyCT. A small panel appears in the bottom-right corner.

## Use

**To get one calendar file:** open a HuskyCT page that lists your calendars —
the Calendar page, or a course's calendar settings — and press
*Merge this page's calendars into one .ics*. The merged file lands in your
downloads. Drop it into [HuskyPilot](https://huskypilot.vercel.app/).

If it says it found no `.ics` links, that page does not expose any on its own.
Press *Report: links on this page* and send that back, and the finder can be
taught where to look.

## Sending a report back

Press one of the two report buttons, then copy the text out of the box. Both are
safe to share:

- the structure report lists element names, ids, classes and short **UI labels**
  (button text, headings) — not page content;
- the link report lists **paths only**, with every query string and fragment
  removed, so no token is in it.

Still, give it a skim before sending. If anything in it looks like it should not
leave your machine, cut that line out.

## Status

Early. The merge works off links that are already on the page; the reporting
buttons exist so the parts that depend on HuskyCT's markup can be written from
evidence rather than assumption.
