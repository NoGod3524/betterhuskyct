# Changelog

Every notable change to BetterHuskyCT, newest first. Each entry corresponds to a
merged pull request, and each version tag marks the state of `main` right after
that merge.

The scheme is deliberately simple:

- **Patch** (`0.1.x`, `0.2.x`, `1.0.x`) — a fix, a cleanup, documentation, or a small addition.
- **Minor** (`0.2.0`, `0.3.0`, `1.1.0`) — a new capability, or a change to the architecture.

## [1.6.8](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.6.8) — Tested where it broke

*Patch: nothing you can see. The file where 1.6.7's app bugs lived can now be tested, and the conventions the code keeps are enforced.*

### Changed

- **The provider's logic moved into `src/lib`, with tests.** `calendar-provider.tsx`
  was the one file `npm test` could not reach — Node's type stripping does not
  transform JSX — and both app-side bugs fixed in 1.6.7 were in it. The clock
  (`watchClock`), the import request (`requestCalendarImport`), what accepting a
  sync link does to the ticks (`planSyncApply`) and the tick filter it repeated
  four times (`ticksForTasks`) are now plain modules, each tested. Nothing
  behaves differently, and the context the pages read is unchanged. ([#50])
- **The real provider is rendered in tests.** A small loader transpiles `.tsx`
  with the `typescript` package the repo already had, and `happy-dom` supplies a
  window, so `node:test` stays the runner. Five tests drive the provider through
  the context its pages read; `npm test` goes from about 2 to about 5 seconds. ([#52])
- **The code's habits are lint errors now**: no `any`, no `==`, no `var`, no
  `let` that is never reassigned, and no `console` in code that runs in someone's
  browser. Each had zero violations when added. Server routes may still log
  errors, and the command-line scripts may print. ([#51])
- **The source-reading provider check is gone**, replaced by the rendering tests
  above. ([#53])
- The helper drops three unused `catch` bindings. It stays at **0.14.2**:
  nothing changed for anyone using it, so installed copies are not asked to
  update. ([#49])

### Fixed

- **Every release link in this changelog from 1.1.1 on led nowhere.** The tags
  they point at had never been made. They now exist, each on the commit that
  ends its version, so every link here opens. 1.6.2 has a tag too, though still
  no entry of its own.

### Notes

- **The rendering tests were checked against the bugs they are for.** Run against
  the provider from before 1.6.7, all five fail with the original symptoms:
  nothing kept `now` moving, focus was ignored, `demo-cse-problem-set` was saved
  as a real tick, and a 504 page read as `Unexpected token '<'`. Before the
  source check was removed, the current provider was broken three ways on
  purpose: the rendering tests caught all three, and the source check missed the
  one where the right function was called with the wrong ticks.
- **Why the context is not memoised.** The idea was to stop every page
  re-rendering once a minute. Measured with 150 deadlines, that re-render costs
  about 19 ms on the dashboard and about 3 ms per keystroke in the link box. It
  also would not have helped: `now` is part of the context value, so memoising
  the value cannot skip the minute tick. What it would have added is
  `useCallback` everywhere, and with it the stale-closure bugs this code has
  already had.
- **`noUncheckedIndexedAccess` is not on.** Turning it on raises 157 errors, 136 of
  them in tests; enabling it for `src` alone would need a second tsconfig.

## [1.6.7](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.6.7) — Sending twice works

*Patch: the helper's Send deadlines only worked the first time, and a review of 1.6.6 turned up the rest of this list. PRs #44, #45, #46 and #47.*

### Fixed

- **A second Send deadlines lost every new deadline.** The helper re-sends one
  "HuskyCT to-do" feed holding everything outstanding, and the merge skipped a
  feed whole if *any* of its events was already on the device. So the second
  send always matched something, and anything new or rescheduled was dropped
  without a word. Feeds now merge into the calendar they continue, item by item.
- **A rescheduled deadline showed up twice** — at the old time, where it later
  sat in the plan as overdue, and at the new one. A task's id carries its start
  time, so a moved deadline arrived with a new id. Calendars are now matched by
  each item's source UID, which survives a move, and for every UID a link
  mentions its copy replaces the one here. A deadline the helper stops listing
  is still kept.
- **Unrelated courses could be merged into one.** Blackboard names every course
  feed "University of Connecticut", and the first version of the merge fell back
  to matching by name, filing one course's deadlines under another's label.
  Names are no longer used to match.
- **Every successful send said the browser had blocked the new tab.**
  `window.open` called with `"noopener"` returns `null` even when it succeeds,
  so 1.6.6's new blocked-popup check was true every time. The panel now opens
  the tab, checks the reference, and clears `opener` itself. The helper moves to
  **0.14.2**.
- **The date never changed while the app stayed open.** `now` was read once on
  load, so an installed app left open overnight kept yesterday's "today", and
  the due-soon reminder never fired for a task that came within 24 hours after
  the page was opened — the case reminders exist for. It now moves every minute,
  and at once when you come back to the tab.
- **One recurring event could fail a whole import.** An `RRULE:FREQ=MINUTELY`
  entry makes the calendar parser give up, and that failed the import with every
  real deadline in it. Each recurring event is now expanded on its own, and one
  the parser refuses is skipped. Each is also capped at 150 occurrences, so an
  hourly event can no longer use up the 500-event budget and cut off everything
  after its first three weeks.
- **Offline, every page opened as the last one visited.** The service worker
  stored every page under `/`, and stored error pages too, so a 500 could become
  the offline app. Pages are now cached under their own path, only when they
  loaded properly. The cache moves to v2, so installed copies drop the old one on
  their next update.
- **Accepting a sync link during the demo saved the demo's ticks** into your real
  ones. The merge now starts from your saved ticks, whichever view is showing.
- **A dropped connection read as "Failed to fetch"**, and a platform error page
  as "Unexpected token '<'". Both now say, in English and Chinese, that the
  import service could not be reached.

### Changed

- **The sync message counts what actually changed**: calendars added, then items
  new and items updated. It used to call an existing calendar "added" whenever
  it gained one item.

### Security

- **The calendar download has a total time limit.** Its 8-second timeout only
  fired after 8 seconds of *silence*, so a server sending a byte every few
  seconds could hold the function open indefinitely, and name lookup had no limit
  at all. The whole fetch — lookup, every redirect, the body — now has 15
  seconds, after which the connection is closed.
- **A sync link is capped after unpacking, not only before.** 32 KB of link could
  expand to tens of megabytes, parsed on the main thread of whoever opened it.
  Unpacking now stops at 2 MB; a real worst case is under 1 MB.
- **The import rate limit trusts the platform's address headers** over
  `x-forwarded-for`, whose first entry a caller can write — a made-up address per
  request used to mean a fresh allowance per request.

### Notes

- **Both halves of the send bug were in tested code.** The first merge fix (#44)
  came with a test for a moved deadline, and it passed while moved deadlines were
  still doubling: the test's ids did not carry a start time, and real ones do.
  The tests now build every id the way the parser and the helper do. Every new
  test in this release was also run against the code before its fix, and fails
  there.
- **The offline fix is tested by running the real `sw.js`.** The in-app browser
  used during development refuses to register a service worker, so a new test
  loads the worker in Node with an in-memory cache and a switchable network and
  checks what each page returns offline.
- **Two behaviours to know about.** A rescheduled deadline arrives under a new
  id, so a tick on its old time does not carry over. And syncing a recurring
  class from another device replaces its occurrences with that device's set, so
  past meetings only this device held can drop away; deadlines are not affected.

## [1.6.6](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.6.6) — The panel comes back

*Patch: the Send deadlines button could not be found, and then 0.14.0 shipped with the panel unable to mount at all.*

### Fixed

- **The panel did not appear.** 0.14.0's first render call sat above the
  declaration of the element it renders into, so `mountPanel` threw
  `Cannot access 'langButton' before initialization` and stopped there. Since the
  helper updates itself from `@updateURL`, every installed copy would have picked
  that up. The helper moves to **0.14.1**.
- **Closing the panel used to delete it.** The × called `host.remove()`, which
  took every button out of the page for the rest of the session — including Send
  deadlines — with nothing to say how to get them back, because there was no way.
  Closing now collapses to an always-mounted chip that reopens it.
- **A blocked popup was reported as success.** `window.open` returns `null` when
  the browser blocks it, silently, and the old code said "Opened BetterHuskyCT"
  either way: the reader was told it worked and saw nothing happen. It now checks,
  and shows the link itself when the tab is blocked.
- **The guidance was the last element in the panel**, under six buttons, so the
  line saying which button this page wants was the last thing anyone read. It is
  first now, and Send deadlines leads as the only primary button.
- **Mounting was not idempotent** — injecting twice stacked two panels, the upper
  one invisibly covering the lower. Mounting clears any existing panel first.

### Added

- **The panel speaks both languages the dashboard does**, with a switch in its
  header. The two run on different origins, so neither can read the other's
  `localStorage`; they agree instead — same key name, same two values, same
  browser-derived default — and every user-visible string, status lines included,
  is built from one dictionary. The browser's own language decides the default,
  so a Chinese browser gets a Chinese panel without being asked.

### Notes

- **The to-do parsing was never broken.** Worth recording, because it was the
  first guess: the panel keys off an `aria-label` containing `", due "`, and
  injecting the shipped script into the real signed-in Courses page showed the
  live label uses exactly that shape and parses correctly, timezone and all. The
  data path was fine; every failure was in the DOM wiring.
- **How the regression got out.** The fix commit came *after* the merge: PR #42
  was merged at the commit before it, so the tip that shipped was the one not yet
  checked on a real page. The bug was found only by injecting the shipped script
  into the signed-in HuskyCT page — no unit test here runs `mountPanel`, so 262
  tests were green while the panel could not mount at all. There is now a test
  that fails if the ordering is moved back, and it was checked against the broken
  ordering as well as the fixed one, since a guard that cannot fail is not a
  guard.

## [1.6.5](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.6.5) — One calendar button

*Patch: the helper's panel had two ways to get a calendar file and no way to tell them apart.*

### Changed

- **The helper's "Merge .ics links" and "Export .ics" are now one button.**
  Both produced a `.ics` you then dropped into the same place, so the reader had
  to work out which to press — when the answer depended on whether the page
  happened to expose feed links, which is the script's business and not theirs.
  There is now **Get this page's calendar**, which prefers feed links and says
  which source it will use before you press it. The helper moves to **0.12.0**.
- Exporting the events collected so far is still there, relabelled as the
  fallback for a page that exposes no feeds.

### Notes

- **The two paths are not equivalent, and that is what decides the order.** A
  merged feed file can be pasted into the dashboard as a *link*, and only a link
  can refresh itself later. The app has no way to turn a file back into a feed
  URL, so harvested events can only ever be a one-time file. Feeds win;
  harvesting is what happens when there are no feeds to win with.
- **Fixed a blank calendar name.** With a single feed the merge path passed a
  bare `""` as the calendar's name, writing a bare `X-WR-CALNAME:` into the file.
  The dashboard reads that key as the name and got `""` rather than `null`, so it
  showed a blank name where it would otherwise have said "Unnamed calendar".
- **A panel-consistency test**, added after nearly shipping a button labelled
  "Send deadlines to BetterHuskyCT" whose handler compared against `"todos"`. The
  labels are written twice — once in the markup, once in `acquireLabelFor` — so a
  mismatch is invisible: no test builds the panel, and a selector matching
  nothing is a null dereference on every page load rather than a failing
  assertion. Every `data-act` must now have a handler, and a separate merge
  button must not come back.

## [1.6.4](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.6.4) — Announcements arrive

*Patch: a new capability — the app can finally hold what the helper has been able to read all along.*

### Added

- **Announcements are a first-class thing the app holds.** The browser helper
  could already read a course's announcements, but it could only write them to a
  Markdown file, because the app had nowhere to put them: it knew about
  deadlines and nothing else. There is now a `/announcements` route, grouped by
  course and newest first, with a per-course filter and a **Clear announcements**
  button.
- **The helper brings them along.** *Send deadlines to BetterHuskyCT* on a course
  page now carries that course's announcements in the same link, so it is one
  press rather than two. The helper moves to **0.11.0**. Its *Collect this course*
  Markdown digest is unchanged.
- **They travel between your own devices too**, on the sync link, because they
  ride the same payload the calendar and the ticks do.

### Notes

- **`SYNC_VERSION` deliberately stays at 1.** An `announcements` key is optional
  on input and always written on output. Bumping the version would have made
  every link from an already-installed helper fail outright — the same class of
  breakage the two domain flips in 1.6.2 and 1.6.3 cost. There is a test that
  pins this: a link from a helper written before announcements existed still
  reads, and its missing field means "nothing to add".
- **An announcement's id is derived, not given.** Blackboard hands out no id for
  one, and the only timestamp on it is the page's own words — *"7 hours ago, at
  5:31 PM"* — which the helper refuses to convert, because a relative time is
  only true at the moment it is read. The id is therefore a hash of the course
  code, title and posted text, which makes re-collecting the same course update
  a row in place instead of duplicating it, and makes the same announcement
  arriving by sync on a second device converge on one row.
- **The posted line stays prose.** It is shown as the page wrote it. What is
  sorted on and aged is when the page was actually read.
- **The writer is lenient where the link reader is strict.** A malformed row is
  skipped rather than failing the whole link: an announcement is decoration next
  to the deadlines, and a term should not be lost to one thin row.
- **An ambiguous course code resolves to nothing.** If a course code matches two
  local courses — the same code with two different components is a real thing
  here — the row shows the code instead of a coin-flip pick.
- Caps: 400 announcements, 1,200 characters per body. Measured at the cap — 120
  deadlines, 5 courses, 400 full bodies — the packed link is 8,968 characters,
  well inside the dashboard's 32 KB fragment guard. A realistic term (120
  deadlines, 40 announcements) is about 3,074, of which the announcements are
  864. A test asserts the guard holds.

## [1.6.3](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.6.3) — The domain, for real

*Patch: the address the helper hands out was, briefly, the one that had stopped answering.*

### Fixed

- The helper points at **`betterhuskyct.vercel.app`**, which is now the live
  address, and moves to 0.10.6. ([#39])

### Notes

- 1.6.2 (which shipped as a version bump without an entry of its own) put the
  helper back on `huskypilot.vercel.app`, because at that moment it was the
  address that answered and the new one returned `DEPLOYMENT_NOT_FOUND`.
  Attaching the domain in Vercel swapped the two over, leaving the helper
  pointing at the dead one. Both directions of that mistake were live breakage,
  and both were caught by measuring the addresses rather than assuming the move
  had landed. ([#38], [#39])
- The self-test used to hardcode the app's address, which is why it reported the
  old domain as "the app" and mentioned the new one only as a note. It now reads
  the address out of the helper, so a helper pointing somewhere dead fails the
  check instead of hiding behind a stale literal. ([#39])

## [1.6.1](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.6.1) — The rename, finished

*Patch: the parts of the rename that needed the repository and the domain to move first.*

### Changed

- Everything that pointed at `github.com/NoGod3524/huskypilot` now points at
  `betterhuskyct` — the helper's update URL, its download URL, the constants in
  `src/lib/helper.ts` that the install page hands out, the README badges, and
  the changelog's own links. ([#37])
- The helper points at **`betterhuskyct.vercel.app`**, and moves to 0.10.4 so
  installed copies pick the new address up. ([#37])

### Notes

- The repository rename was measured before it was relied on: an installed copy
  of the helper has the *old* raw update URL baked into its Tampermonkey
  metadata, so if `raw.githubusercontent.com` had stopped resolving the old path
  those copies could never have updated themselves again. It does follow the
  rename — `raw.githubusercontent.com/NoGod3524/huskypilot/...` still answers
  200 with the current file. ([#37])
- Vercel binds a `.vercel.app` domain at deploy time, so the renamed project
  answered `DEPLOYMENT_NOT_FOUND` until the first production deploy after the
  rename. That is what this commit is. ([#37])

## [1.6.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.6.0) — BetterHuskyCT

*Minor bump: the project has a name that says what it is.*

### Changed

- Every user-facing string now reads **BetterHuskyCT**. The npm package is
  `betterhuskyct`. ([#36])

### Notes

- The stored keys are still `huskypilot.*`, and so are the deployed domain and
  the repository path. Changing those would discard every saved calendar and
  break the update URL on copies of the helper people already have installed, so
  they are deliberately untouched: a name is a label, a storage key is data, and
  the two do not have to match. ([#36])
- The helper moves to 0.10.3 so installed copies pick the new wording up. Its
  panel names the dashboard, and Tampermonkey only notices a change when
  `@version` increases.

## [1.5.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.5.0) — A door for the helper

*Minor bump: a page that installs the browser helper, so nobody has to find a raw URL.*

### Added

- **A Helper page**, reachable from the sidebar, that installs the browser
  helper in two store clicks. It asks for the Tampermonkey listing belonging to
  the browser doing the asking — Edge is checked first, because Edge's user
  agent says "Chrome" too and the Chrome Web Store refuses to install into it —
  and falls back to Tampermonkey's own page for anything it does not recognise.
  ([#35])
- It says what the helper does, and at more length what it will not: no NetID,
  no password, no request of its own, nothing uploaded.

### Notes

- Which listing to offer is decided in `src/lib/helper.ts` and tested there,
  because a wrong store link fails at the exact moment someone has decided to
  trust the thing. All four listings were fetched and each named Tampermonkey.

## [1.4.1](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.4.1) — A date is not an instant

*Patch: all-day entries landed a day early for anyone east of UTC.*

### Fixed

- An all-day entry — `DTSTART;VALUE=DATE:20260901` — is a calendar date with no
  time and no zone. It is parsed into local midnight and was then read back in
  **UTC**, which returns the previous day for any runtime east of UTC: local
  midnight in London is 23:00Z the day before. Deployments in UTC were
  unaffected, which is why nothing had noticed. ([#34])
- `dateKey` is consumed as a local date — `date-utils` turns it back into local
  midnight — so the local reading is the one the rest of the app already
  expected. The two halves now agree.

### Notes

- CI ran the suite only in UTC, where the old behaviour is correct, so it could
  not have caught this. It now runs a second time with `TZ=Pacific/Auckland`.

## [1.4.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.4.0) — HuskyCT hands over your deadlines

*Minor bump: a browser extension that puts HuskyCT's own data into the dashboard.*

### Added

- **HuskyCT Helper**, a userscript that runs inside the session your browser
  already has. It reads the to-do list, a course's announcements and its
  outline, and it opens BetterHuskyCT with the deadlines already in the link —
  no file to download, nothing to import, and nothing uploaded. ([#31])
- It **reads rather than asks**. HuskyCT's own API refuses scripts: a request
  the page itself makes gets a 200 where an identical one from a script gets an
  `AccessDenied`, and a path that cannot exist is refused the same way. So the
  helper reads what is already on screen, which makes no request at all. The
  one exception is merging calendar feeds, and those are links the page shows.
- Content is found by **accessibility label** — `Status for Cengage WebAssign:
  Started` — rather than by CSS class, because those class names carry build
  hashes and change with every release.

### Changed

- `blackboardKind` recognises the helper's `huskyct-todo-` uids, so deadlines
  that arrive this way are graded work rather than falling through to the
  unknown kind.

### Notes

- The link carries the same payload as *Sync to another device*, and the app
  reads it back with the same reader. A deadline that arrived by file and one
  that arrived by link are therefore recognised as the same deadline instead of
  being counted twice.
- BetterHuskyCT still **asks before applying**, and the helper cannot skip that: a
  flag meaning "this link is safe" could be set by anyone who can write a link.

## [1.3.1](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.3.1) — Where did the delete button go

*Patch: the collapsed card had no way in to remove a calendar.*

### Fixed

- The card collapses once a calendar is in, and its only door was labelled
  **Add another calendar** — but the remove button lives behind that door too.
  Nobody would look for "delete" under "add", which is exactly the complaint
  that came back. That button now reads **Manage calendars**, and the line
  under it says so. ([#30])

## [1.3.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.3.0) — The same dashboard, on your phone

*Minor bump: a second device no longer starts empty.*

### Added

- **Sync to another device, with no server and no account.** *Sync* in the
  import card packs everything this device knows — the calendars, your ticks,
  your courses, the effort marks — into one link about 1,800 characters long.
  Open it on your phone and the whole dashboard is there. No re-import, nothing
  to set up again. ([#29])
- The payload rides in the URL **fragment**, which a browser never sends to a
  server, so nothing is uploaded and nothing can expire. The link works just as
  well pasted into a browser that already has the app open.
- The receiving device is **asked first**: it reports what arrived — calendars,
  deadlines, ticks, courses — and writes nothing until you accept.

### Notes

- The feed URL is deliberately **not** in the payload. It is a password, and a
  link destined for a chat client is no place for one. The events travel
  instead, which is what lets the second device skip the import entirely.
- Ticks are only ever **added**, never removed: having ticked something on the
  other device is never a reason to untick it here. Courses and effort marks
  take the incoming value, because importing a link is a deliberate act.
- A calendar already on this device is left as it is, and incoming course ids
  are remapped by code and component, so the same course named on both devices
  stays one course.

## [1.2.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.2.0) — The calendar names its own courses

*Minor bump: the app no longer has to ask which course a class meeting is.*

### Added

- **Course codes, filled in automatically.** A Blackboard feed titles a class
  meeting `Environmental Science` and never says which course that is, so the
  app used to ask the user to type it. It now reads UConn's public class search
  and resolves the title itself — the real export labels all of its lectures
  with **zero setup**: no course list, no picker, nothing typed. ([#28])
- `npm run course-map`, which regenerates that snapshot from
  `classes.uconn.edu/api/?page=fose`. The endpoint is public: no login, no
  token, and one request returns a whole term. The snapshot here covers three
  terms and 5,321 courses.

### Notes

- A title belonging to more than one course is **never guessed**. Cross-listed
  courses share titles all the time — `Asian Theatre and Performance` is both
  AAAS 2136 and DRAM 2136 — so those rows are left blank instead. The user's own
  label always outranks anything found here.
- Assignments still carry no course in the feed, so those rows fall through to
  the course their feed was filed under, or the default course, exactly as
  before. The catalogue only fills in what it can prove.
- The snapshot is 255 KB of JSON, about **65 KB gzipped**, added to the client
  bundle and cached by the service worker after the first load.

## [1.1.1](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.1.1) — A lecture is not a deadline

*Patch: the Plan route was treating class meetings as work you owe.*

### Fixed

- **`Plan` no longer lists class meetings.** Blackboard puts lectures and graded
  items in the same calendar, so the plan was showing "Environmental Science,
  ARJ 105" beside a quiz and judging the lecture "at risk" — it read your day as
  work you had not started. Lectures stay in the Today / Tomorrow / This week
  list, where seeing your day is the whole point. ([#27])
- The **due-soon banner**, the desktop notification, and the "N due in the next
  7 days" headline count deadlines only, so a lecture can no longer inflate them.
- **Workload insights** count deadlines only: a lecture is not work you complete,
  so including one dragged the completion rate down and inflated its course.

"Is this something I owe, or somewhere I have to be?" is now a named rule,
`isDeadline()`, because several parts of the app needed to ask it. Feeds that are
not Blackboard leave the marker unset, and those entries still count as
deadlines.

## [1.1.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.1.0) — Any calendar, several of them

*Minor bump: 1.0.1 assumed a calendar feed belongs to one course. HuskyCT issues
one feed per course, so a semester is several links — and the graded items inside
a feed never say which course they came from. Finding those links at all was the
real barrier, so 1.1.0 removes it.*

### Added

- **Import a downloaded `.ics` file** — drop it anywhere on the page, or choose
  it from disk, several at once. This is where the HuskyCT path ends, and it is
  the same gesture for Canvas, Moodle, Google Classroom and anything else that
  exports a calendar. ([#22])
- The import card walks the path a HuskyCT student actually takes, in seven
  numbered steps and in the words on their screen: *Calendar → gear (**setting**)
  → ⋯ → **share calendar** → **copy** → paste into the address bar → drag the
  downloaded file in*. Pasting the copied link straight into the app is offered
  as the shortcut it is — two steps shorter, and one click away.
- Once a calendar is in, the card **folds itself down to a single line** — the
  count, and a button to add another — because from then on there is nothing to
  do there. It comes back in full on one click.
- A **course list** on the import page. Add each course once — a code plus
  LEC / DIS / LAB / SEM — and mark one as the default. ([#22])
- A **per-task course picker** on the Plan and Tasks rows, for the rows the
  default gets wrong. An explicit "show no course" is available too. ([#22])
- **Several calendars at once.** Adding a second course used to replace the
  first; feeds are now a list you can add to, up to eight. ([#22])
- Every imported calendar is **filed under a course**, so its rows are labelled
  without any per-row work, and can be **refreshed or removed on its own**.
- Rows named by the feed itself still win over the default, so a feed that does
  carry a course name is never overridden by a guess.
- A file import is named after **the file**, not the feed: five Blackboard
  exports all call themselves "University of Connecticut".

### Changed

- The README now says where to get a feed on Blackboard, Canvas, Moodle, Google
  Classroom and Google Calendar, and the app no longer presents HuskyCT as the
  only way in.
- The 1.0.x single saved import and its remembered URL are upgraded into one
  entry in the calendar list, and the 1.0.1 single course label into a one-course
  list, so nobody loses what they had already set.
- Deleting the default course hands the default to the next course in the list,
  rather than blanking every row that relied on it.
- Remembering a link is now a preference that applies to the links you add next,
  rather than a property of the one calendar the app used to hold.

### Fixed

- Tasks are de-duplicated by their ICS UID, so overlapping feeds — or a feed that
  is simply refreshed — no longer double their rows.

## [1.0.1](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.0.1) — Rows you can actually recognise

*Patch: the Plan route used to print `CALENDAR — Take-home Quiz 1` and nothing
else. It now says which course the row belongs to, what kind of entry it is, and
exactly when and where it happens.*

### Added

- A **course label** on the import page: name the feed once — a code plus
  LEC / DIS / LAB / SEM — and every imported row carries it. A Blackboard export
  contains no course name at all, so the only person who can supply one is the
  person who subscribed to the feed. ([#21])
- A **kind badge** on Plan and Tasks rows, *Class* or *Assignment*, read from the
  Blackboard UID — the only field in the feed that distinguishes the two. ([#21])
- Plan rows now show the **exact due moment** (`Fri, Sep 11, 12:30 PM`) and the
  **room**, so a row is no longer just a relative "in 3 days".

### Fixed

- Typing a space into the course code no longer swallows it. The label is saved
  on every keystroke, so `NRE 1000E` used to collapse into `NRE1000E`.

### Removed

- The `CALENDAR` placeholder that appeared on every task with no course of its
  own. A row now shows nothing rather than something untrue.

## [1.0.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.0.0) — Plan

*First stable release. BetterHuskyCT stops only showing what is due and starts
saying what to work on next.*

### Added

- A **Plan** route (`/plan`) that compares how much work each deadline needs with
  the days remaining. ([#20])
- **Effort estimates** per task — quick (15 min), medium (45), long (90) — set
  with one click and kept in the browser.
- **At-risk detection**: a task is flagged when the sittings it still needs
  exceed the days available, so "start now" becomes visible before it is too
  late. One sitting is 30 focused minutes.
- **Overdue surfacing**: deadlines that already passed and are still unticked now
  have a home, instead of quietly dropping out of the week view.
- A suggested focus total for today, counting the overdue and at-risk work.

### Changed

- `dueTimestamp` moved from `reminders` into `date-utils`, beside the other date
  helpers.

## [0.3.1](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.3.1) — Version footer and settled history

### Added

- A version footer on every route, read from `package.json` so the version has a
  single source of truth. ([#18])
- This changelog, plus annotated git tags marking every earlier release. ([#17])

## [0.3.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.3.0) — Real routes

*Minor bump: architecture.*

### Changed

- Replaced the single 1024-line dashboard component with a shared state provider,
  a persistent app shell, and five focused section components.
- Calendar state now lives in the root layout, so moving between routes keeps the
  imported tasks, completion state, language, and reminder settings — with no
  flash of demo data and no repeated auto-refresh request.

### Added

- Real routes, each with its own title: `/` (overview), `/tasks`, `/calendar`, and
  `/insights`. ([#16])
- Sidebar navigation uses `next/link` and marks the active route with
  `aria-current="page"`.

## [0.2.3](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.2.3) — Auto-refresh and CSV export

### Added

- Opt-in auto-refresh from a remembered calendar URL. It is off by default, the
  URL is kept in this browser only, and it is removed by unticking the box or
  pressing **Clear saved data**. ([#14])
- CSV export of everything currently on screen, with a UTF-8 byte-order mark so
  Excel reads Chinese text correctly. ([#15])

### Changed

- The privacy wording now says the ICS URL is not stored *unless you explicitly
  ask for it*.

## [0.2.2](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.2.2) — Documentation refresh

### Changed

- Both READMEs now document the PWA, reminders, insights, and the optional
  auto-refresh, and the project structure and roadmap are up to date. ([#13])

## [0.2.1](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.2.1) — Due-soon reminders

### Added

- A due-soon banner for anything due in the next 24 hours. ([#12])
- Opt-in browser notifications while the app is open, de-duplicated by a task
  fingerprint so the same reminder is never repeated.
- A service worker `notificationclick` handler that brings the open app forward.

## [0.2.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.2.0) — Installable and offline

*Minor bump: new capability.*

### Added

- A web app manifest, PWA icons, and a theme colour, so BetterHuskyCT can be added
  to a phone's home screen and opened full screen. ([#11])
- A service worker that caches the app shell: navigations are network-first (so a
  new deploy lands immediately), hashed assets are cache-first, and the import API
  is never cached.
- Safe-area padding so the layout clears the home indicator when installed.

## [0.1.10](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.1.10) — Import help

### Added

- An expandable "Where do I find my ICS link?" section on the import card. ([#10])

## [0.1.9](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.1.9) — Repository cleanup

### Added

- A secrets audit of the working tree and the full git history before the
  repository was made public.

### Removed

- The assistant prompt file and editor/assistant scaffolding, so the repository
  root only contains project files. ([#9])

## [0.1.8](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.1.8) — Continuous integration

### Added

- GitHub Actions running `test`, `lint`, and `build` on every pull request and
  every push to `main`, with least-privilege permissions and concurrency
  cancellation. ([#8])

## [0.1.7](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.1.7) — Insights panel

### Added

- A workload analytics section: completion rate, tasks per course, the next 7
  days, and the next 4 weeks. ([#7])

## [0.1.6](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.1.6) — Portfolio README

### Added

- A bilingual README (English and Simplified Chinese) with an architecture
  diagram, the SSRF control table, and the design decisions. ([#6])

## [0.1.5](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.1.5) — Obsolete panel removed

### Removed

- The outdated "Private by design" panel. ([#5])

## [0.1.4](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.1.4) — Dead navigation removed

### Removed

- Sidebar links that pointed at nothing ("Courses" and "Privacy"). ([#4])

## [0.1.3](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.1.3) — English / 简体中文

### Added

- A language toggle for the whole interface, including date formatting, remembered
  across visits. ([#3])

## [0.1.2](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.1.2) — Task completion

### Added

- A checkbox on every task card, a struck-through title when done, and state that
  survives a refresh and a re-import. ([#2])

## [0.1.1](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.1.1) — Local persistence

### Added

- Imported events and their metadata are saved in the browser and restored on
  load, using versioned payloads that recover safely from corrupt data. ([#1])

## [0.1.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v0.1.0) — BetterHuskyCT V0

### Added

- The first working version: paste a HuskyCT / Blackboard ICS link and get the
  next 7 days grouped into Today / Tomorrow / This week.
- An SSRF-hardened server-side download (`safe-fetch.ts`), ICS parsing with
  `node-ical`, and course-name extraction from event titles.
- A `node:test` suite covering parsing, grouping, and URL rejection.

[#1]: https://github.com/NoGod3524/betterhuskyct/pull/1
[#2]: https://github.com/NoGod3524/betterhuskyct/pull/2
[#3]: https://github.com/NoGod3524/betterhuskyct/pull/3
[#4]: https://github.com/NoGod3524/betterhuskyct/pull/4
[#5]: https://github.com/NoGod3524/betterhuskyct/pull/5
[#6]: https://github.com/NoGod3524/betterhuskyct/pull/6
[#7]: https://github.com/NoGod3524/betterhuskyct/pull/7
[#8]: https://github.com/NoGod3524/betterhuskyct/pull/8
[#9]: https://github.com/NoGod3524/betterhuskyct/pull/9
[#10]: https://github.com/NoGod3524/betterhuskyct/pull/10
[#11]: https://github.com/NoGod3524/betterhuskyct/pull/11
[#12]: https://github.com/NoGod3524/betterhuskyct/pull/12
[#13]: https://github.com/NoGod3524/betterhuskyct/pull/13
[#14]: https://github.com/NoGod3524/betterhuskyct/pull/14
[#15]: https://github.com/NoGod3524/betterhuskyct/pull/15
[#16]: https://github.com/NoGod3524/betterhuskyct/pull/16
[#17]: https://github.com/NoGod3524/betterhuskyct/pull/17
[#18]: https://github.com/NoGod3524/betterhuskyct/pull/18
[#19]: https://github.com/NoGod3524/betterhuskyct/pull/19
[#20]: https://github.com/NoGod3524/betterhuskyct/pull/20
[#21]: https://github.com/NoGod3524/betterhuskyct/pull/21
[#22]: https://github.com/NoGod3524/betterhuskyct/pull/22
[#27]: https://github.com/NoGod3524/betterhuskyct/pull/27
[#28]: https://github.com/NoGod3524/betterhuskyct/pull/28
[#29]: https://github.com/NoGod3524/betterhuskyct/pull/29
[#30]: https://github.com/NoGod3524/betterhuskyct/pull/30
[#31]: https://github.com/NoGod3524/betterhuskyct/pull/31
[#34]: https://github.com/NoGod3524/betterhuskyct/pull/34
[#35]: https://github.com/NoGod3524/betterhuskyct/pull/35
[#36]: https://github.com/NoGod3524/betterhuskyct/pull/36
[#37]: https://github.com/NoGod3524/betterhuskyct/pull/37
[#38]: https://github.com/NoGod3524/betterhuskyct/pull/38
[#39]: https://github.com/NoGod3524/betterhuskyct/pull/39
[#49]: https://github.com/NoGod3524/betterhuskyct/pull/49
[#50]: https://github.com/NoGod3524/betterhuskyct/pull/50
[#51]: https://github.com/NoGod3524/betterhuskyct/pull/51
[#52]: https://github.com/NoGod3524/betterhuskyct/pull/52
[#53]: https://github.com/NoGod3524/betterhuskyct/pull/53



