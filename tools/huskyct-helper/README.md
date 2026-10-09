# HuskyCT Helper

A userscript that runs inside your own HuskyCT session and does three things,
each in one press:

1. **Collect everything** — your deadlines for the whole term and every course's
   announcements — then **send** the lot to BetterHuskyCT. No file to download,
   and nothing uploaded.
2. **Collect course materials** — every course's files, lecture videos, links and
   tools — then save the files into a folder you pick, sorted by course, and the
   links on one page.
3. **Collect grades** — every course's gradebook, all its pages — then **send**
   them to BetterHuskyCT's Grades page.

> **HuskyCT is Blackboard Ultra at `lms.uconn.edu`.** The script also matches
> `huskyct.uconn.edu` in case that hostname still redirects, but `lms.uconn.edu`
> is the one that matters.

There used to be more buttons: this page's calendar as an `.ics` file, the
calendar events seen so far, one course's Markdown digest. Each worked on the one
page in front of you, and the reader had to work out which page and which
button. The two walks above do each of those jobs for every course at once, so
0.17.0 took the single-page tools out.

## What it does not do

- It never asks for, stores, or transmits your **NetID or password**. It uses the
  session your browser already has, exactly as the page itself does.
- It never sends anything anywhere except `lms.uconn.edu` and, when you save
  course materials, the file store HuskyCT's own file links lead to.
- **It asks HuskyCT for no data directly.** Everything it collects is read off a
  page HuskyCT has rendered. Both walks move the tab through HuskyCT's own pages,
  one at a time, the way its links do — HuskyCT loads each one exactly as if you
  had clicked there. The only requests the script itself makes are for the
  course files you ask it to save, one at a time, with a pause between them.

## Install

**With a userscript manager.**

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox,
   Safari) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the extension's dashboard → **Create a new script**.
3. Delete the template, paste in the whole of `huskyct-helper.user.js`, and save.
4. Open HuskyCT. A small panel appears in the bottom-right corner.

## Why it reads pages rather than asking HuskyCT

HuskyCT's own API refuses scripts. Measured on 2026-09-19: a request the page
itself made to `/learn/api/v1/users/me` returned 200, an identical-looking one
from a script returned 403 with an S3-style `AccessDenied` body, and adding any
header of our own reset the connection. A path that cannot exist returned the
same 403 as a real one, so the edge in front of HuskyCT admits the application's
own calls and refuses everything else regardless of the path. Re-measured on
2026-09-27 with the same result, and HuskyCT's pages refuse to load inside a
frame too.

Forging those calls would mean imitating the application against a system that
is explicitly refusing to be scripted. Reading the rendered page needs no such
thing, and keeps working when the internals change.

Content is found by accessibility label — `PDF, Section 5.1 Problem Solving
Tips.pdf`, `Status for Cengage WebAssign: Started` — rather than by CSS class,
because those class names carry build hashes and change with every release.

## Collect everything, then send

Nothing on HuskyCT shows everything at once. The to-do list is on the Courses
page and only spans a week either side of today; each course's announcements are
on that course's own Announcements tab, and the course outline shows none of
them. So the helper goes and gets them.

Press **Collect everything** and the panel walks HuskyCT in the tab you are in:

1. **The Courses page**, for the to-do list. It only covers a week either side
   of today, and it is the one place overdue work shows.
2. **Every course you are enrolled in.** On a wide screen the Courses page lists
   them all as cards; on a narrow one it shows only the few opened most recently
   (four of six on the account this was measured with) and the rest are behind
   **View All**, which the panel opens. Past terms are skipped — the current term
   comes from the recent courses, or from today's date when there are none.
3. **The calendar's data**, for every deadline from today on. In a quiet week
   the to-do list is empty while the term is full of work — on 2026-09-27 it
   showed nothing, beside 29 due dates running to December 11. The panel asks
   `/learn/api/v1/calendars/calendarItems`, the data the Calendar page itself
   draws from, and keeps the graded items (`GradableItem`); class meetings and
   your own entries are left out. Each carries its course and an exact time, so
   it is right wherever you are. No page is opened for it, and the quick sync
   reads the same data. A deadline on both lists is sent once.
4. **Each course's Announcements page**, one after another: all the
   announcements it lists, up to 25 per course, with the date each was posted.
5. **Back to the page you started on.**

It moves the way HuskyCT's own links do, without reloading, so the whole walk
took 13–20 seconds for six courses on 2026-09-27, depending on the layout. The button turns into
**Stop** while it runs; stopping keeps what was already read. A course whose page
never loads is skipped and named in the panel.

**Then it is sent on its own.** The moment the walk finishes, the panel looks
for a BetterHuskyCT tab already open under the name the Send buttons use and,
if one is there, hands everything over `postMessage`, the same route course
materials and grades already travel by — no link to paste, and nothing to
confirm on BetterHuskyCT's side, since pressing Collect everything already
said yes once.

A tab only counts if it is already open: a browser only lets a script open a
new one in direct response to a press, and by the time a multi-course walk
finishes that moment has passed. So the first collect in a browsing session,
with no BetterHuskyCT tab open yet, cannot send on its own — the panel says
so and **Send everything to BetterHuskyCT** is still there, one press away,
building the `#sync=` link exactly as it always has. Pressing it also opens
the tab the next collect can find.

The two routes end up in the same place by different means: `postMessage`
applies the moment it arrives, because the panel already asked once by
offering Send; the link still shows a banner to confirm, because a link is
something that could have come from anywhere.

Why walk the pages rather than ask HuskyCT for the data? Because both ways of
asking were measured and are closed: HuskyCT's API refuses scripts (403
`AccessDenied`, re-measured 2026-09-27), and its pages refuse to load inside a
frame, so a hidden frame gets nothing. Reading the pages HuskyCT renders for you,
one at a time, is what is left.

The panel also keeps reading the page you are on while you browse normally, so
opening a course's Announcements tab by hand updates that course too.

A few rules keep the basket honest:

- **A revisit replaces, it does not pile up.** Each Announcements tab lists all of
  that course's announcements, so what it shows now is the truth: one the
  instructor deleted leaves the basket too. A page that has not changed writes
  nothing.
- **An empty to-do list is ignored.** It only spans a week either side of today,
  so an empty one — or one that has not rendered yet — is not evidence that
  nothing is due, and must not wipe deadlines already collected.
- **A page counts only once it is really that course's.** Moving between two
  courses can leave the last one's page on screen for a moment under the new
  address. Its heading has to name the course being read, and none of its rows
  may be left over from the page before.
- **An empty Announcements tab counts only once it stays empty** for a few
  seconds, so a list still loading is not mistaken for a course with nothing to
  say.
- **The link has to fit.** The dashboard refuses links over 32 KB. If a very full
  basket would not fit, announcements are dropped oldest first, taking the same
  number from every course so that none disappears, and the panel says how many
  were left out. Deadlines are never dropped.
- *Clear basket* empties it, for the start of a term or a different account.

The basket never leaves your browser except inside that one link, and the link's
data rides in the fragment, which browsers never send to a server. It goes from
HuskyCT to your own copy of BetterHuskyCT and nowhere else. The dashboard adds
what arrives to what it already has and sets aside announcements it has seen
before, so sending again next week is safe.

The course is named by its **code** — `MATH 1070Q` — rather than its HuskyCT id,
because that is the only handle the dashboard shares; `_203765_1` means nothing
over there.

Each announcement's **posted** line stays exactly as the page wrote it
("9/25/26, 4:00 PM"). The body is read from the paragraph that holds it rather
than the block around it, which also holds the title; the three-line clamp on
the list is only CSS, so the full text is underneath.

It uses the same link format as *Sync this dashboard to another device*, so the
payload is read back by exactly the same code. A test asserts that by running a
generated link through the dashboard's real reader rather than through a
description of it.

Each item is read from the link the application renders for it, because that
link's accessible name carries the whole record:

    Section 4.7 Homework, Homework · MATH-1070Q-SEC100.120-1268 · _203765_1,
    due 9/25/26, 11:59 PM

Title, kind, course and due time all come out of that one string. The task id is
built as `uid + ":" + start` — exactly how the dashboard derives one from a
calendar file — so a deadline that arrived by file and one that arrived by link
are recognised as the same deadline rather than counted twice.

Times are read as the reader's own local time. The page shows wall-clock time
with no zone on it, so that is the only reading it offers, and the right one for
someone sitting in the same timezone as their classes.

**Why it still asks once.** BetterHuskyCT confirms before applying a link, on
purpose: a sync link is untrusted input. The helper could set a flag meaning
"this one is safe", but anyone could set that flag too, so it does not.

## Course materials

**Collect course materials** walks every current course's content — every
folder and learning module opened, every "Load more" pressed, every document
opened — and lists what it found: *"Found 57 files, 29 videos, 22 links and 30
tools in 6 courses."* Nothing is downloaded until you choose.

Then:

- **Send to BetterHuskyCT** — the main one. It opens BetterHuskyCT's
  **Materials** page and hands the files over tab to tab, with `postMessage`;
  they are kept in that browser's own storage, and the page shows them by course
  and folder, opens PDFs in place, and lists the videos, links and tools. The
  app first says which files it already has, so pressing it next week sends only
  what is new. Nothing goes through a server: the files are read here, because
  only this page has HuskyCT's session, and stored there.
- **Save N files to a folder…** — a copy on disk as well, or the way in when the
  two tabs cannot reach each other; BetterHuskyCT's Materials page can import
  the saved folder. asks once where to put them and writes the
  term's files by course and by the course's own folders. The picker opens on
  the Desktop, but Edge and Chrome refuse the Desktop itself ("contains system
  files"), so make a folder there — **New folder**, e.g. `HuskyCT` — and pick
  that; the panel says so before the picker opens:

      HuskyCT Fall 2026/
        MATH 1070Q/
          Weekly Lectures, Problem-Solving Tips and HW Links/
            Week 1 - Section 4.1/Section 4.1 PDF.pdf
          Problem-Solving Tips Blank Notes/Section 5.1 Problem Solving Tips.pdf
        ECON 1201/…
        links and videos.html

  One file at a time, with a pause between them. A file already there is
  skipped without being fetched again, so pressing it next week saves only
  what is new. This needs Edge or Chrome; elsewhere the button offers **one ZIP**
  with the same folders instead.
- The folder also gets a **links and videos** page — every video, link and tool
  by course and folder — marked up so the Materials page can read it back. An
  LTI tool (WebAssign, MyLab, Kaltura…) links straight to its launch, so it
  opens without going through the course page; you only need to be signed in
  to HuskyCT. A Kaltura video posted as an LTI link is listed with the videos.
Assignments, quizzes, tests and discussions are work rather than material; they
are counted and left alone.

**A second walk within a week is quick.** Opening documents is most of the
time — MATH 1070Q alone has 40, at a second or two each — and a document rarely
changes once posted. What each one held is kept for a week, so the next walk
opens only the documents that are new; after a week every document is read
afresh. The panel says how many came from the last reading. A document is read
the moment its page holds still, rather than after a fixed second: measured on
2026-09-27, attachments and videos were there as soon as the page appeared.

What was measured on 2026-09-27, and what it decided:

- **What an item is comes from where it links**, not from its label. The label
  is the file's kind — a CSV reads "Text Document" — while the address says
  `/file/`, `/document/`, `/assessment/`, `/discussion/`, `#` for a tool, or a
  link out.
- **A tool's launch address can be built from the page** (measured
  2026-09-28). An LTI link's anchor is `href="#"`, but its row carries the
  item's id as `data-content-id`, and pressing it opens
  `/webapps/blackboard/execute/blti/launchLink?course_id=…&content_id=…&from_ultra=true`
  in a new window. Opened on its own later, that address went straight to
  WebAssign, MyLab and Kaltura. The anchor's `data-launch-handle` names the
  tool; "KalturaBSE" is a Kaltura video, so those go with the videos.
- **A file's real address is already on the page.** Its row carries a hidden
  anchor with `/bbcswebdav/...`, keyed by the item's id, so no file has to be
  opened to be found.
- **Reading the file works — sent the right way.** That address redirects to
  Blackboard's file store, which answers any origin but refuses a request that
  carries credentials. An ordinary request sends HuskyCT's cookie to HuskyCT and
  nothing to the store, whose signed address is the permission: a 1.7 MB lecture
  PDF came back whole in 0.3 s, named as the course names it.
- **Documents are opened one by one**, about 1.5 s each, because their
  attachments and embedded videos only render on their own page. An attachment's
  id starts with its document's, so a page still showing the previous document
  is never mistaken for the next. MATH 1070Q's 40 documents gave 36 attachments
  and 29 lecture videos; the whole course took about 65 s.
- **Links pasted from a UConn mailbox arrive wrapped** in Outlook's safe-links,
  whose query carries the student's email address. The list unwraps them, so the
  address never lands in a file on the desktop.
- Course materials are for your own use. Keep them that way.

## Grades

**Collect grades** opens each current course's gradebook, turns every page of
it, and lists what it found: *"Found 47 gradebook items, 19 with a score, in 4
courses."* Then **Send grades to BetterHuskyCT** opens the Grades page and hands
them over tab to tab, the way materials go: kept in that browser, never through
a server. Each item is its title, the line under it ("1 attempt submitted (1
Late)"), and a score out of some points — or what HuskyCT shows instead, such
as "Not graded".

A course whose gradebook did not open, or did not open to its last page, is left
out of the send and named in the self-check, so a half-read gradebook never
replaces a whole one BetterHuskyCT already has.

What was measured on 2026-09-28 across four courses, and what it decided:

- **A row is `[data-grade-id]`.** It holds the item's link, an optional line
  under it (`[data-testid="item-description"]`), and either a score — `105/100`,
  in three spans beside a spoken "Final Grade: …" — or the words "Not graded".
  The spoken text is in the page's language, so the score is read from the three
  spans.
- **Twenty-five rows to a page**, with Previous and Next buttons. A fresh route
  lands on page 1, where Previous is disabled; on the last page Next is. The
  walk clicks Next until it is disabled, waiting each time for rows it has not
  seen. Ids are unique across courses, so a page still on screen under the new
  address is never read as the next course.
- **A course with no work shows a picture, not rows.** It sits inside a wrapper
  that exists only once the grades have loaded, so an empty course can be told
  from a page still loading without reading any English.
- **The last page is told by the pager's label, not by Next being disabled.**
  Next is disabled while the pager is still loading as well as on the last
  page, so reading only that made a slow pager look like a one-page gradebook:
  a course silently lost its other pages and was reported complete. The pager's
  "Page 1 of 2" label (read for its first and last number, so any language
  works) now says where the walk is and when it is done, and the walk waits for
  Next to switch on before pressing it, and presses it twice if the first press
  is lost.
- **A course that falls short is tried once more**, with twice the patience,
  and named with where it stopped ("MATH 1070Q (page 2/3)"). If HuskyCT sends
  the tab to its sign-in page the walk stops there and says so, instead of
  timing out on every course left.
- **Some courses show no overall grade.** None is read; BetterHuskyCT adds up
  the graded rows and says that is not the course grade.

## When something does not work: the self-check

The walks depend on how HuskyCT draws its pages, and Blackboard changes that
with its releases. A step that finds nothing where there should be something is
named on the panel, in a line starting **Self-check:** —

- the Courses page did not show its course list;
- no current-term course was found;
- HuskyCT's calendar data gave no due dates (only this week's to-do list was
  read);
- a course's content, or some of its documents, did not open;
- files were listed with no download address;
- no course showed any content at all;
- a course's gradebook did not open, or not to its last page.

Most of these mean HuskyCT changed. The line is written to be passed on as it
is, with the version the panel shows.

## Versions

1.0.0 is the helper's first release. From there it follows the same rules as
BetterHuskyCT:

- **Major** (`2.0.0`) — a big change to what it is or how it is used.
- **Minor** (`1.1.0`) — a new capability.
- **Patch** (`1.0.1`) — a fix or a small addition.

The panel shows the version it is running. Tampermonkey only offers an update
when `@version` goes up, so every change that ships raises it.

## Status

Early, and deliberately small. Every reader here was written against markup
observed on a live signed-in page rather than guessed at. The diagnostic buttons
used to observe it have been removed: they had done their job, and a script other
people install should not ship its author's scaffolding.
