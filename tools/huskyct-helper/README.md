# HuskyCT Helper

A userscript that runs inside your own HuskyCT session and does three things:

1. **Merges your course calendars into one `.ics`.** HuskyCT hands out one
   calendar feed per course, so a semester is a dozen links and HuskyPilot can
   only take one at a time. This collects every feed the page already exposes and
   writes a single file you can drop straight into the app.
2. **Collects a course** — its announcements, its outline, and the files it links
   to — as a Markdown digest.
3. **Collects your deadlines** from the to-do list as a calendar file.

> **HuskyCT is Blackboard Ultra at `lms.uconn.edu`.** The script also matches
> `huskyct.uconn.edu` in case that hostname still redirects, but `lms.uconn.edu`
> is the one that matters.

## What it does not do

- It never asks for, stores, or transmits your **NetID or password**. It uses the
  session your browser already has, exactly as the page itself does.
- It never sends anything anywhere except `lms.uconn.edu`.
- **It asks HuskyCT for nothing.** Everything it collects is read off the page
  already on screen. The only requests it ever makes are for the calendar feeds
  that page itself links to — one at a time, with a pause between them.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox,
   Safari) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the extension's dashboard → **Create a new script**.
3. Delete the template, paste in the whole of `huskyct-helper.user.js`, and save.
4. Open HuskyCT. A small panel appears in the bottom-right corner.

## Use

**To get one calendar file:** open a HuskyCT page that lists your calendars —
the Calendar page, or a course's calendar settings — and press
*Merge .ics links on this page*. The merged file lands in your downloads. Drop it
into [HuskyPilot](https://huskypilot.vercel.app/).

If it says it found no `.ics` links, that page does not expose any on its own;
try the Calendar page instead.

## Collecting a course

*Collect this course: announcements + content* reads the page you are looking at
— the Announcements list, the course outline, or both — and saves a Markdown
digest: the course's name, every announcement with its full text, the outline
items, and the **files the course links to**, as links.

It reads announcements from either place they appear — the Announcements page
and the course page's own announcement dialog — because those are two different
renderings of the same records, and reading only one of them makes the other
look empty.

It sends **no request at all**. Everything it writes is already on screen.

That is a deliberate choice, and it comes from a measurement rather than a
preference. HuskyCT's own API refuses scripts. Measured on 2026-09-19: a request
the page itself made to `/learn/api/v1/users/me` returned 200, an
identical-looking one from a script returned 403 with an S3-style `AccessDenied`
body, and adding any header of our own reset the connection. A path that cannot
exist returned the same 403 as a real one, so the edge in front of HuskyCT
admits the application's own calls and refuses everything else regardless of the
path.

Forging those calls would mean imitating the application against a system that
is explicitly refusing to be scripted. Reading the rendered page needs no such
thing, produces no traffic that could look like scraping, and keeps working when
the internals change.

Titles are read from each item's accessibility label — `Status for Cengage
WebAssign: Started` — rather than from a CSS class, because those class names
carry build hashes and change with every release.

## Collecting deadlines

*Collect deadlines from this page (.ics)* reads the to-do list — which lives on
the HuskyCT home, the Courses page — and writes `huskyct-deadlines.ics`. Drop
that into HuskyPilot like any other calendar.

Each item is read from the link the application renders for it, because that
link's accessible name carries the whole record:

    Section 4.7 Homework, Homework · MATH-1070Q-SEC100.120-1268 · _203765_1,
    due 9/25/26, 11:59 PM

Title, kind, course, due time and the application's own item id all come out of
that one string. Using its id as the calendar UID means collecting twice does
not put the same deadline into HuskyPilot twice.

Times are read as the reader's own local time. The page shows wall-clock time
with no zone on it, so that is the only reading the page offers — and it is the
right one for someone sitting in the same timezone as their classes.

## Status

Early, and deliberately small. Every reader here was written against markup
observed on a live signed-in page rather than guessed at. The diagnostic buttons
used to observe it have been removed: they had done their job, and a script other
people install should not ship its author's scaffolding.
