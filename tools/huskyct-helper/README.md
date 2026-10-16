# HuskyCT Helper

A script that runs inside your own HuskyCT session, reads your deadlines, announcements, grades and
course files from HuskyCT's own data, and hands them to BetterHuskyCT. It runs as
[the browser extension](../extension) (Chrome and Edge), which is how BetterHuskyCT's Helper page
hands it out, or as a userscript in a manager such as Tampermonkey, for a browser the extension
does not cover. This file is the userscript, and the extension runs it unchanged.

> **HuskyCT is Blackboard Ultra at `lms.uconn.edu`.** The script also matches
> `huskyct.uconn.edu` in case that hostname still redirects, but `lms.uconn.edu`
> is the one that matters.

## What it does

One thing: a **sync**. It reads, in order,

1. **The course list**, `/learn/api/v1/users/me/memberships`: every course you can open, with its term
   and the colour HuskyCT gives it. Past terms are left out, by today's date; between terms the
   newest one stands in.
2. **The to-do list**, `/learn/api/v1/calendars/todo/studentItems`: what is due this week or
   overdue and not yet handed in. It spans a week either side of today (HuskyCT refuses more than
   14 days), and it is the one place overdue work shows.
3. **The term's due dates**, `/learn/api/v1/calendars/calendarItems`: every graded item from today on,
   each with its course and an exact time. Class meetings and your own entries are left out. A
   deadline on both lists is sent once.
4. **Each course's announcements**, `/learn/api/v1/courses/<id>/announcements`: up to 100 a course,
   newest first, with the time each was posted. The newest 25 of each are kept and sent.
5. **Each course's gradebook**, `/learn/api/v1/courses/<id>/gradebook/grades`: every row, every
   page. A course whose gradebook does not come whole is marked unread, so a half-read gradebook
   never replaces a whole one BetterHuskyCT already has.
6. **Each course's content**, `/learn/api/v1/courses/<id>/contents/<id>/children`: every file,
   document, video, link and tool, in its folders. Then the files BetterHuskyCT does not have yet,
   one at a time, with a pause between them.

A course whose data cannot be read is skipped and named, and the rest still go. What was read is
sent to BetterHuskyCT with `postMessage`, tab to tab: the deadlines and announcements, then the
gradebooks, then the files. Nothing goes through a server.

It reads **no page**. It opens no page of HuskyCT, moves nothing on the screen, and does not depend
on how HuskyCT draws anything, so a redesign does not break it. It sends the requests HuskyCT's own
pages send, with the session your browser already has.

## When it runs

- **In the background, with the extension**, if you enable background sync in its popup or the Helper page. It checks about every six hours while the browser runs and keeps the results locally until BetterHuskyCT opens. A 401 pauses checks until sign-in is restored. System notifications are a separate opt-in, with per-kind switches; the first reading only establishes a baseline. Background reads update file directories, while the existing Sync button downloads file contents. Userscripts keep the page-based modes below.
- **From BetterHuskyCT's Sync button.** The helper on BetterHuskyCT's page asks for a HuskyCT tab:
  an open one answers, or one is opened behind it and closed after. What is read comes back to the
  tab that asked, so nothing has to be pressed on HuskyCT.
- **From the panel.** A small panel sits in the corner of HuskyCT: **Sync now** reads and sends to
  BetterHuskyCT, which the press opens (a press may open a tab; HuskyCT can go behind it, as nothing
  is read from its pages). Files too big for the route a Sync button's request takes (100 MB) go
  this way, whole.
- **On its own, when HuskyCT opens**, if the switch in the panel is on (it is, by default), the last
  sync was more than six hours ago, and you are signed in. It sends only to a BetterHuskyCT tab this
  tab opened before and that is still there; otherwise what it read waits for the next press.

## What it does not do

- It never asks for, stores, or transmits your **NetID or password**. It uses the session your
  browser already has, exactly as the page itself does.
- It never sends anything anywhere except `lms.uconn.edu` and, for course files, the file store
  HuskyCT's own file links lead to. What it reads reaches BetterHuskyCT inside your browser.
- It does not read pages, and it keeps no copy of anything on a server.

## Install

**As the extension** (Chrome and Edge): see [`../extension`](../extension). This file is its source.

**With a userscript manager**, for a browser the extension does not cover:

1. Install [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Open the manager's dashboard → **Create a new script**.
3. Delete the template, paste in the whole of `huskyct-helper.user.js`, and save.
4. Open HuskyCT. A small panel appears in the bottom-right corner.

Use one or the other, or HuskyCT is read twice.

## Why it asks HuskyCT's data, and how

An early version found HuskyCT's data closed to scripts: a request from a script returned 403 with an
S3-style `AccessDenied` body. The cause was the page's `<base href>`, which points at Blackboard's
file store: a bare path sent from a script went to the store, not to HuskyCT. Asked at HuskyCT's own
address (`https://lms.uconn.edu/...`, with the cookie sent to HuskyCT only), the same requests are
answered, 200 with JSON, as they are to the page.

The helper trusts only what it has seen. A score counts only on a row whose status is `GRADED`; an
attempt counts as handed in only when it is `COMPLETED`, so a value it has not seen leaves the work
open rather than marking it done. Anything unexpected, or fewer rows than HuskyCT says there are,
gives nothing for that course, and it is reported as one that could not be read.

If a sync reads nothing, the panel says which step it stopped at and what HuskyCT answered
(`HTTP 401` is HuskyCT saying you are signed out), so the cause can be told apart from afar.

## Versions

1.0.0 was the first release. It follows the same rules as BetterHuskyCT:

- **Major** (`2.0.0`) — a big change to what it is or how it is used.
- **Minor** (`1.1.0`) — a new capability.
- **Patch** (`1.0.1`) — a fix or a small addition.

**2.0.0** is the one that reads no page. Until 1.18.0 the helper also read what HuskyCT's pages
showed: a **Collect everything** button that walked the Courses page and each course's
Announcements page, a **Send everything** button that put the result in a link, a **Clear basket**
button, and a timer that noted what the pages you opened showed. Every one of those jobs is now a
request to HuskyCT's data, done by the sync; the buttons and the page-reading code are gone, and the
panel is Sync now and a switch.

The panel shows the version it is running. The extension takes its version from `@version`, and a
userscript manager only offers an update when it goes up, so every change that ships raises it.
