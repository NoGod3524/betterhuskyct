# Changelog

Every notable change to BetterHuskyCT, newest first. Each entry corresponds to a
merged pull request, and each version tag marks the state of `main` right after
that merge.

The scheme is deliberately simple:

- **Major** (`1.0.0`, `2.0.0`) — a big change: a rebuilt product, or one that changes how it is used.
- **Minor** (`0.2.0`, `0.3.0`, `1.1.0`) — a new capability, or a change to the architecture.
- **Patch** (`0.1.x`, `0.2.x`, `1.0.x`) — a fix, a cleanup, documentation, or a small addition.

HuskyCT Helper, the userscript in `tools/huskyct-helper`, keeps its own version
by the same rules, from its 1.0.0 in BetterHuskyCT 1.9.0. Its entries here say
which helper version they ship.

## [1.18.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.18.0) — Sync from BetterHuskyCT, and the helper reads HuskyCT's own data

*Minor: BetterHuskyCT gets a Sync button that has the helper read HuskyCT in the background, and the helper reads announcements, grades and the course list from the data HuskyCT's own pages use instead of walking those pages. HuskyCT Helper goes from 1.5.3 to 1.10.0.*

### Added

- **A Sync button in BetterHuskyCT**, big under the overview's heading and compact in
  the header, sharing one sync. A press opens (or finds) a HuskyCT tab named
  `huskyct` and asks the helper in it for a sync, repeating the request for up to 90
  seconds so a sign-in has time. The helper reads in the background and sends what
  it read back; the button shows its progress and result. It needs helper 1.10.0 or
  newer, and says so when the helper does not answer. The first press takes you to
  the new HuskyCT tab; keep that tab open. Desktop only, as the helper is. ([#109])
- **A Sync button in the helper's own panel, and a sync that starts on its own** when
  HuskyCT is opened (switchable, on by default, at most once in six hours). It reads
  no page and sends only to a BetterHuskyCT tab the HuskyCT tab opened before and
  that is still there, since a tab opened without a press is a popup the browser
  blocks; otherwise the reading waits for a press. A course it cannot read this way
  is skipped and named, never read from its page. A sync that arrives only in part
  is not called sent. HuskyCT Helper 1.9.0. ([#108])
- **A diagnostic in the helper's panel that records the structure of the page's data
  requests**: paths with ids made generic, and every value replaced by its type or
  length, so no score, title or name leaves the page. It is how the readers below
  were written, and is removed once the last of them is in. HuskyCT Helper 1.5.4.
  ([#104])

### Changed

- **Announcements are read from HuskyCT's own data.** One request a page of results
  instead of opening each course's Announcements page, so it is quick and does not
  move the tab. A course whose answer is refused is read from its page, as before.
  The posted time is written as the page writes it, so an announcement is not stored
  twice. HuskyCT Helper 1.6.0. ([#105])
- **Gradebooks are read from HuskyCT's own data.** No page to open and no Next to
  press, and no longer dependent on the table's markup. Only what was seen is
  trusted: a score counts only on a GRADED row and an attempt counts as handed in
  only when COMPLETED, so a value never seen leaves work open. A gradebook that
  stops short of the count HuskyCT gives is read from its page. HuskyCT Helper 1.7.0.
  ([#106])
- **The course list is read from HuskyCT's own data**, so the grades and course
  files walks no longer open the Courses page, and Collect everything no longer opens
  and scrolls "View All". An empty or short list is read from the page instead.
  HuskyCT Helper 1.8.0. ([#107])

### Fixed

- **The page title in a gradebook's self-check kept no letter s.** ([#105])

### Notes

- The to-do list and the course files are still read from their pages, by Collect
  everything. The due dates reach BetterHuskyCT through the calendar link.
- Reading HuskyCT's data was written from one recording of one course. If a course
  or a grade ever looks different from HuskyCT, the helper's page reading is still
  the fallback, and Collect everything uses it.

## [1.17.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.17.0) — The Plan page is gone

*Minor: a page is removed. HuskyCT Helper is unchanged at 1.5.3.*

### Removed

- **The Plan page.** The to-do list says what is overdue and what is due, with
  done work folded away, and the calendar says when, so the Plan page repeated
  both. Its sidebar and bottom-bar entry, its route and its strings are gone; the
  bottom bar's four slots are now Dashboard, To-do, Calendar and Announcements,
  with Materials, Grades and Helper behind More. A bookmark of `/plan` no longer
  opens anything. ([#102])

### Notes

- **Effort marks are kept, but nothing sets them.** They were only ever set on the
  Plan page. They are still stored and carried through a sync, so a link or a
  saved set-up from before reads and writes back as it was.

## [1.16.2](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.16.2) — Grades are read from HuskyCT's new gradebook table

*Patch: HuskyCT redrew the gradebook, and the helper found no grades in it. HuskyCT Helper goes from 1.5.1 to 1.5.3.*

### Fixed

- **Grades are read from the new gradebook table.** HuskyCT now draws the gradebook
  as a table, one row per item, without the marker the helper looked for, so every
  course was reported as not opened. A row is read from either layout. Its id is
  the one on its name, the same id as before, so grades already in BetterHuskyCT
  still line up. The score, or the words standing in for it, are read from the
  grade cell only, so a status such as "Submitted" is never taken for a grade.
  HuskyCT Helper 1.5.3. ([#100])
- **The to-do list counts the table's own status words.** "Submitted" and "Graded"
  in the status column mark work as handed in and graded; "Not submitted" does
  not. ([#100])

### Changed

- **A gradebook that does not open says why.** The self-check now adds, for the
  first course that failed, what the page looked like then: its address, how many
  gradebook rows, empty pictures and pagers it had, whether the tab was in the
  back, and whether it was a sign-in page. HuskyCT Helper 1.5.2. ([#99])

## [1.16.1](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.16.1) — Collect everything reads the gradebooks again

*Patch: a fix to Collect everything. HuskyCT Helper goes from 1.5.0 to 1.5.1.*

### Fixed

- **Collect everything could not open any gradebook.** It opened the BetterHuskyCT
  tab the moment you pressed it, so HuskyCT went to the back for the whole walk,
  and a tab in the back does not draw its pages. The tab is now looked for after
  the walk, by its name. When none is open, the Send buttons open it on a press,
  and the next collect finds it. A walk that falls short in a tab in the back now
  says so. HuskyCT Helper 1.5.1. ([#97])

## [1.16.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.16.0) — Sync by QR code, and a collection that brings everything

*Minor: the sync link can be scanned from the computer's screen, and it carries what HuskyCT says is done. Collect everything reads the gradebooks and files, and sends them on its own. The Insights page is folded into To-do. HuskyCT Helper goes from 1.4.0 to 1.5.0.*

### Added

- **A QR code for the sync link.** On the computer, the code sits under the copy
  button; the phone's camera opens the same link, which still asks before anything
  is added. The code is drawn in the browser and is never sent anywhere. A set-up
  too large for a code says so and points to the copy button. ([#95])
- **HuskyCT's done states go with a sync.** A phone has no gradebook, so work
  handed in on the computer used to show as open on the phone. A link now carries
  HuskyCT's reading and the tasks you reopened; the phone keeps them beside its
  own, and a sync only ever adds to them. Links made before this still read. ([#95])

### Changed

- **The Insights page is gone.** Its completion rate, and the done/total count for
  each course, are on the To-do page, over the whole term. ([#92])

### Fixed

- **Collect everything reads the gradebooks and the course files too**, not only
  the announcements, with the same walks their own buttons make. ([#94])
- **Collect everything sends on its own.** The BetterHuskyCT tab is opened on the
  press, so the results no longer wait for a manual Send, and gradebooks and files
  land whichever page you are on. HuskyCT Helper 1.5.0. ([#94])
- **The calendar on a phone** shows one dot per event, and tapping a day opens its
  list, instead of seven narrow columns of cut-off titles. ([#93])

## [1.15.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.15.0) — A calendar you can edit, and a to-do list that knows what you handed in

*Minor: the calendar is a month view you can change; To-do ticks off work HuskyCT shows as submitted or graded; materials can be saved to your computer; and Collect everything sends its results to BetterHuskyCT on its own when a BetterHuskyCT tab is open. HuskyCT Helper goes from 1.3.0 to 1.4.0.*

### Added

- **A month calendar** at `/calendar`, with Previous, Next and Today. Every
  imported and added event shows on its day, and the import card sits at the top
  of the same page. Add your own event (title, course, date, all-day or a time
  range, location, a note), or tap any event to edit or delete it. A day's number
  opens its full list. ([#90])
- **Corrections to imported events are kept apart from the feed.** An edit or
  deletion of a HuskyCT event lives in an overlay, so the next collection does not
  wipe it. **Undo every change on this calendar** clears the overlay in one press;
  events you added yourself are not affected. ([#90])
- **Save materials to your computer.** **Save to a folder…** (Chrome, Edge) writes
  one folder per course, skips files already there with the same size, and leaves
  a links page beside them. **Download as ZIP** works in any browser. A folder
  export can be imported back. ([#87])
- **Collect everything sends to BetterHuskyCT on its own.** When a BetterHuskyCT
  tab is already open, the helper hands the deadlines and announcements over
  without a link to paste and without a confirmation banner. If no such tab is
  open, **Send everything to BetterHuskyCT** is still there. HuskyCT Helper 1.4.0.
  ([#89])

### Changed

- **The Tasks page is a to-do list**, and the sidebar calls it **To-do**. It lists
  every deadline still to hand in, grouped by how soon it is due, with a filter by
  course. Work HuskyCT shows as submitted or graded is folded away, labelled
  **Submitted** or **Graded**. ([#88])
- **Matching errs towards leaving a task open.** A task needs its course and its
  whole title to match the gradebook. A started attempt does not count as
  submitted, and ticking a task HuskyCT marked done reopens it. ([#88])

### Fixed

- **A gradebook can no longer lose rows silently.** A slow pager made a course
  look like a single page, so a 35-row course could come back with 25 and still be
  reported complete. The helper now reads each page's own number, waits for Next to
  switch on, retries a lost press, retries an incomplete course once with more
  patience, and says where a course stopped. HuskyCT Helper 1.3.1. ([#86])

## [1.14.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.14.0) — Choose which model writes your summaries

*Minor: a reader can pin announcement summaries to one model. HuskyCT Helper is unchanged at 1.3.0.*

### Added

- **A Model menu beside the Summarize button**: **Automatic** (Z.ai's GLM first,
  Google Gemini if it is busy — what always happened, and still the default),
  **Z.ai only**, or **Gemini only**. A chosen model is the only one the
  announcements are sent to: if it is busy the reader gets an error, not a quiet
  fallback to the other. A line under the button says what the choice means — for
  Gemini, that Google may use the text to improve its models — and the choice is
  kept in this browser only. ([#84])

### Security

- **A chosen model is enforced on the server, not just in the menu.** A request
  for Gemini only from a reader in the EEA, Switzerland or the UK is refused
  before anything is sent, since Gemini's free terms exclude them; a chosen
  model the server has no key for is reported as unavailable rather than
  swapped for the other; and an unknown choice is refused. ([#84])
- **Summaries are kept apart by model.** A chosen model's summaries are cached
  under their own key, so someone who chose Z.ai only is never handed a summary
  Gemini wrote, and the reverse. An Automatic request hashes exactly as it
  always did, so nothing already cached is lost. ([#84])

### Notes

- **The route from HuskyCT to the deployed site was checked end to end in a real
  browser.** A headless Edge with a clean temporary profile, a stand-in HuskyCT
  page at the real `lms.uconn.edu` origin loading the real helper 1.3.0, real
  mouse clicks, and the real deployed site: the pop-up was allowed, the site
  answered that it had stored the grades and worked out the right total, and a
  300,000-byte file arrived whole as a Blob with its name and size intact. The
  data was synthetic, and nothing reached the real HuskyCT.

## [1.13.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.13.0) — What changed in your grades, and a shared summary cache

*Minor: the Grades page says what moved since you last looked; announcement summaries can be shared between server instances; and the summary button says who Z.ai is. HuskyCT Helper is unchanged at 1.3.0.*

### Added

- **The Grades page tells you what changed.** Each reading is compared with the
  one the app already holds, and the difference is badged — **Newly graded**,
  **New**, **Was 80 / 100** — under a banner that counts them and has a
  **Mark as seen** button. Changed rows come first in their course. A score
  appearing, changing, or a scored item that was not there counts; an
  assignment that merely appears with no score, a score going away, and a 0/0
  practice test do not, and the first reading of a course is the baseline, so a
  term of "new" never arrives at once. A change stays until it is marked seen,
  across as many readings as it takes, and "was" is what you last saw: 80, then
  90, then 95 before you look reads "was 80". The changes are worked out in the
  app and stored beside the grades; the helper cannot send any, and a message
  that carries them has them dropped. ([#80])
- **Summaries can be shared across servers.** The summary cache lived in each
  server instance's memory, so the same announcements, served by a new
  instance, were summarized again. An optional Upstash Redis cache now lets
  instances reuse a summary for up to six hours. It is off until
  `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set on the server,
  and without them the bounded per-instance cache works exactly as before. It
  adds no dependency. ([#81])

### Changed

- **The summary button says who Z.ai is.** It said GLM runs "from Singapore",
  which leaves out that Z.ai is the brand of Zhipu AI, a Chinese company that
  the U.S. Commerce Department added to its Entity List in January 2025 (checked
  against the Federal Register rule, document 2025-00704). The note beside the
  button and both READMEs now say so, in both languages, along with what the
  listing is — export licensing, not a rule about what you may use — so the
  choice of provider is yours. ([#82])

### Security

- **The shared cache holds as little as it can.** An entry is a SHA-256 hash of
  the request, the summary, the provider and the time it was written: no
  announcements, no IP addresses, no request details, no credentials. Whether
  Gemini may serve a reader is checked on every hit, local or remote, so a cached
  Gemini summary is never handed to a reader Gemini is not allowed for. Redis
  requests time out after a second, writes finish before the response is sent,
  an entry that does not parse is ignored, and a failure leaves summaries
  working. ([#81])

### Notes

- **The shared cache has not yet been tried against a real Upstash database.**
  Its tests simulate Redis, including separate instances, expiry without
  renewal, malformed entries, read and write failures and timeouts. To turn it
  on, create a database and set the two variables on the server.
- **Limits that remain:** two instances that miss at the same moment may each
  generate a summary, and the rate limit is still per instance. ([#81])

## [1.12.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.12.0) — Phone navigation, lighter, smoother

*Minor: the site can be navigated on a phone; and a lighter first load, some motion, and controls a finger can hit. HuskyCT Helper is unchanged at 1.3.0.*

### Fixed

- **On a phone there was no navigation.** Below 1024 px the sidebar is hidden,
  and it was the only navigation the site had: every link in it measured 0×0 and
  the dashboard showed no link to any other page, so a phone could not reach
  Plan, Tasks, Calendar, Announcements, Materials, Grades, Insights or Helper.
  A bar along the bottom now holds the four pages opened most and a **More**
  that opens a sheet with the other five. The sheet is modal — focus moves into
  it, Tab stays inside, Escape or a tap outside closes it, the page behind does
  not scroll — and it closes itself when the page changes. It respects the
  home indicator, and a test fails if a page is added that the navigation does
  not list. ([#78])
- **The phone's header overflowed**: "简体中文" wrapped to one character per
  line. A phone now gets one language button in place of the pair, and the
  name and avatar give way to the controls. ([#78])

### Changed

- **Controls are finger-sized on a touch screen.** The completion checkbox was
  16 px, buttons 28 to 38, text links 16 to 20; 82 controls across the nine
  pages were under 44 px. On a coarse pointer every button and field is now at
  least 44 px, icon buttons are 44 px squares, and the checkbox keeps its small
  box inside a 44 px area that takes no more room than the box. All 129 controls
  measured are 44 px or more. A mouse sees none of it — the desktop measures
  exactly as before. ([#78])
- **One keyboard focus ring** in the theme's link colour on every button and
  link, where only the text fields had one; and a pressed button shrinks a
  little, so a tap is seen to land (not for anyone who asked for less motion).
  ([#78])
- **A lighter first load.** UConn's course-title catalogue was 62 KB compressed
  inside the code of every page, though only an imported Blackboard calendar
  can use it. It is now a separate file, fetched when a task with no course of
  its own needs it. The main code file goes from 87.2 KB to 23.8 KB compressed,
  and the JavaScript the home page loads from 274.6 KB to 209.3 KB. ([#76])
- **Pages move a little.** A page fades in when the route changes; what a
  folded section reveals arrives with a small lift; and the Materials and
  Grades pages show grey placeholders while they read their saved data, in
  place of an empty state that flashed for a frame and was then replaced. Only
  opacity and position are animated, and all of it is off for anyone who asked
  their device for less motion. ([#77])

### Notes

- **Measured, and left alone.** With 900 events the once-a-minute refresh costs
  about 5 ms at worst; with 600 files and 240 links open on the Materials page,
  opening everything blocks the page for 15–74 ms in slices of 16 ms or less.
  Neither is worth splitting the shared state or windowing the list for.

## [1.11.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.11.0) — Grades

*Minor: a new capability — each course's gradebook in the app, delivered by HuskyCT Helper 1.3.0.*

### Added

- **A Grades page.** Each course's gradebook rows and the points so far, kept in
  this browser: what each item scored out of how many, the line HuskyCT shows
  under it ("1 attempt submitted (1 Late)"), and a total for the graded work
  with its percent. Rows without a score ("Not graded", "Grade is complete",
  `0/0` practice work) are folded away; a course with nothing in it says so.
  Nothing is uploaded. ([#73])
- **The helper delivers them.** **Collect grades** opens each course's
  gradebook on HuskyCT, turns every page, and reads each row; **Send grades to
  BetterHuskyCT** opens the Grades page and hands them over tab to tab — never
  through a server — and waits to hear they were kept. Six courses, 57 rows, took
  15 seconds. A course whose gradebook did not open, or not to its last page, is
  named in the self-check and left out of the send, so a half-read gradebook
  never replaces a whole one. ([#74])

### Changed

- **HuskyCT Helper 1.3.0.** Two new buttons on the panel. The term label the
  materials walk worked out inline is now shared by both walks. ([#74])
- **The helper page** in the app describes the new button. ([#74])

### Security

- **The Grades page hears only HuskyCT.** As with materials, messages are
  accepted from `lms.uconn.edu` and `huskyct.uconn.edu` alone, and each is
  checked whole — its shape, its sizes, that every score is a finite number and
  every row id HuskyCT's own — before anything is stored. Replies go back to the
  exact origin that asked. ([#73])

### Notes

- **The total is not your course grade.** HuskyCT's gradebook shows no category
  weights, dropped scores or extra-credit rules, and some courses show no
  overall grade at all, so the page adds up the graded rows and says so wherever
  it shows the total. ([#73])
- **Two courses can share a code.** A lecture and its lab both read
  `STAT 1000Q`, so grades are told apart by HuskyCT's course id: reading one
  never replaces the other. Found by running the helper on the live gradebook.
  ([#74])
- **Update the helper to get the button.** Tampermonkey offers 1.3.0 from the
  raw `main` link; press **Collect grades**, then **Send**.

## [1.10.1](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.10.1) — Tools open directly

*Patch: HuskyCT Helper 1.2.2 — tools open straight away, and Kaltura videos are listed as videos.*

### Changed

- **A tool opens itself, not its course.** WebAssign, MyLab and the other LTI
  tools linked to their course's content page, where they had to be found
  again. HuskyCT gives such a link no address, but its row carries the item's
  id, and Blackboard launches the tool from an address built on it — the one
  HuskyCT opens when the link is pressed. The helper sends that address, and
  the Materials page and the saved links page both use it; you only need to be
  signed in to HuskyCT. The group is now called **Tools**. ([#70])
- **Kaltura videos are videos.** A Kaltura video posted as an LTI link — MATH
  1070Q's "Problem Solving Tips" — was listed as a tool; the link names the
  tool it launches, so these now go with the videos, and open in Kaltura's
  player. ([#71])

### Security

- **A tool can link only to its launch.** The Materials page keeps a tool's
  address only when it is Blackboard's launch address on `lms.uconn.edu` or
  `huskyct.uconn.edu`, with well-formed ids; any other address is dropped and
  the tool links to its course, as it did before. ([#70])

### Notes

- **Send again to pick it up.** Tools already in the app, or in a folder saved
  by an older helper, keep linking to their course until "Collect course
  materials" and **Send to BetterHuskyCT** are pressed again.

## [1.10.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.10.0) — Course materials, and dark

*Minor: new capabilities — every course's files, videos and links in the app, delivered by HuskyCT Helper 1.2.0; and a dark theme.*

### Added

- **A Materials page.** Every course's files, lecture videos, links and tools,
  kept in this browser: browsed by course and folder, PDFs opened in place,
  everything else downloaded, tools linking back to their course on HuskyCT.
  It shows how much of the browser's storage the files use, and asks the
  browser to keep them. ([#66])
- **The helper delivers them.** After "Collect course materials" on HuskyCT,
  **Send to BetterHuskyCT** opens the Materials page and hands the files over
  tab to tab — never through a server. The page first says which files it
  already has, so next week's send carries only what is new, and a complete
  send drops files the course no longer lists. ([#66])
- **Import a saved folder.** Files the helper saved to a folder — before this
  existed, or in a browser where the two tabs cannot reach each other — are
  read in from the Materials page, links and videos included. ([#66])
- **Dark mode.** Follow the device, or pick light or dark from the top bar. The
  choice is kept in this browser and applied before the page is drawn, so a
  dark choice never flashes light. ([#68])

### Changed

- **The Materials page folds.** Each course starts closed, with a line saying
  what is in it; inside, its files form a folder tree that names each folder
  once; every folder, and the videos, links and tools, open on their own.
  Expand all and Collapse all; what is open is remembered. ([#67])
- **HuskyCT Helper 1.2.0.** Send to BetterHuskyCT leads after collecting
  materials; saving to a folder stays; the separate links-page button is gone,
  since the app now shows them. ([#66])

### Security

- **The Materials page hears only HuskyCT.** Messages are accepted from
  `lms.uconn.edu` and `huskyct.uconn.edu` alone, and each is checked whole —
  its kind, its sizes, file keys that must be HuskyCT's own file addresses,
  links that must be `http(s)` — before anything is stored. The helper, in
  turn, hears only the app's origin, so no other page can start or steer a
  delivery. ([#66])

### Notes

- **Light mode is unchanged to the pixel.** The components had 68 colours
  written into them, which a theme cannot reach. Each is now a CSS variable
  whose light value is the colour it was; dark redefines the set by role. A
  test fails if a colour is hard-coded again, if one has no dark value, or if
  key text in dark falls under 4.5:1 contrast. ([#68])
- **Files stay on this device.** The Materials page keeps them in IndexedDB,
  like everything else the app holds in the browser; a phone or another
  computer gets them by sending again from HuskyCT there.

## [1.9.1](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.9.1) — The helper checks itself

*Patch: HuskyCT Helper 1.1.0 — a self-check, a fix it caught, and a faster second walk. The dashboard itself is unchanged.*

### Added

- **A self-check.** Each walk now names the step that came back empty where it
  should not have — the Courses page, the Calendar's Due dates view, a course's
  content, documents that did not open, files with no download address — in a
  line starting "Self-check:", instead of saying "Done" over an empty result.
  Blackboard changes its pages with its releases; this is how that will show.
  ([#64])

### Fixed

- **A walk started on a course's page read one course, or none.** That page,
  still on screen for a moment after the move and full of links into the
  course, was taken for the Courses page. Only what appears after the move
  counts now; live, starting from ECON 1201's page, all six courses. The
  self-check found it. ([#64])
- **Saving to the Desktop said it "contains system files".** Edge and Chrome do
  not let a page pick the Desktop itself. The panel now says, before the picker
  opens, to make a folder on the Desktop and pick that. ([#64])

### Changed

- **A second materials walk within a week is quick.** What each document held is
  kept for a week, so the next walk opens only new documents, and a document is
  read the moment its page holds still rather than after a fixed second. ([#64])

## [1.9.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.9.0) — HuskyCT Helper 1.0

*Minor: new capabilities. The helper reaches its first release, 1.0.0: one press collects the whole term, another the course materials.*

### Added

- **Collect everything, in one press.** The helper walks HuskyCT itself — the
  Courses page, every course's Announcements page, the Calendar — then goes back
  to the page you were on. No more opening each course by hand. It moves the way
  HuskyCT's own links do, without reloading: six courses took 13–20 s live.
  ([#60])
- **The whole term's deadlines.** The to-do list only spans a week either side
  of today, so in a quiet week nothing came through. The walk now also reads the
  Calendar's "Due dates" view to the end of the term — 29 items through December
  11 on the account it was measured with — with EDT/EST read as exact instants.
  A deadline on both lists is sent once. ([#60])
- **Collect course materials.** A second walk opens every folder and every
  document in every course and lists the files, lecture videos, links and tools
  it finds; nothing is downloaded until you choose. ([#61], [#62])
  - **Save the files into a folder you pick** — the Desktop is offered first —
    sorted as `HuskyCT Fall 2026/<course>/<the course's own folders>/`. One file
    at a time; a file already there is skipped, so next week's press saves only
    what is new. Edge and Chrome write straight into the folder; other browsers
    get one ZIP with the same folders.
  - **Save the links and videos** as one page, by course and folder, with tools
    that only open from HuskyCT linking back to their course.

### Changed

- **The helper panel keeps only the two walks.** "Get this page's calendar",
  "Export events collected so far" and "Collect this course" each worked on the
  one page in front of you; the walks do their jobs for every course at once.
  The FullCalendar harvest that polled every page went with them. ([#62])
- **Summaries are written in the page's language.** The free models tended to
  answer in the language they read, so English announcements came back in
  English on a Chinese page. The language now leads the prompt, named in the
  language itself, and a summary in the wrong language is not shown: the other
  model is asked instead. ([#60])

### Fixed

- **Announcements from the helper were all under "No course".** The page filed
  one under a course only when the import page's course list held exactly one
  course with its code, so without that list — or with a lecture and a
  discussion under one code — every row landed there while still naming its
  course. They are grouped by their course code now. ([#60])
- **Collect everything read nothing on a wide screen.** There the Courses page
  lists every course as a card, with no "View All" button; the walk waited for
  one. Both layouts are read now. ([#60])
- **Announcement bodies no longer repeat their title**, and they arrive with the
  date they were posted. ([#60])

### Notes

- **Still no request for data of its own.** HuskyCT's API refuses scripts and its
  pages refuse to load in a frame, both re-measured on 2026-09-27. The walks read
  the pages HuskyCT renders for you, one at a time. The one request the helper
  makes itself is for a course file you asked to save: HuskyCT's file address
  redirects to Blackboard's file store, which answers any origin as long as no
  credentials are sent to it.
- **A page between two courses is never misread.** Moving from one course to the
  next can leave the last one's page on screen under the new address, so a page
  counts only once its heading names the course being read and none of it is
  left over from before.
- **Links from a UConn mailbox are unwrapped** from Outlook's safe-links, whose
  query carries the student's email address, before they go in a file.
- **Update the helper to get this.** Tampermonkey picks up 1.0.0 by itself within
  a day, or at once from its dashboard's update check.

## [1.8.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.8.0) — Collected as you browse

*Minor: a new capability — the helper gathers every course's announcements and your deadlines as you move around HuskyCT, and sends them in one press.*

### Added

- **The helper collects as you browse.** HuskyCT Helper 0.15.0 keeps a basket
  in your browser: the Courses page adds every course you are enrolled in and
  the to-do list, and each course's Announcements tab adds that course's
  announcements. You no longer send from one page at a time. ([#58])
- **One press sends everything.** *Send everything to BetterHuskyCT* puts every
  collected deadline and announcement in a single link, opened in the same
  dashboard tab each time. ([#58])
- **The panel shows what is in the basket and what is left.** It shows a count
  like "12 deadlines and 31 announcements, from 3 of 5 courses", a **Next: ECON
  1201 announcements →** button for the courses not yet opened, and
  *Clear basket*. ([#58])

### Fixed

- **Every announcement body began with its own title.** The helper read the
  block that wraps both; it now reads the body's own paragraph, whose full text
  is there under the three-line clamp. ([#58])
- **Announcements from the helper arrived with no posted date.** The date
  selector matched nothing on the live Announcements page; it now reads
  `.list-item-date-sent` ("9/25/26, 4:00 PM"). ([#58])

### Notes

- **Still read off the page, nothing requested.** HuskyCT's API still refuses
  scripts (re-measured 2026-09-27: 403 `AccessDenied`), so the basket fills only
  from pages you open yourself.
- **Built to stay honest.**
  - A revisit replaces a course's announcements, so ones the instructor deleted
    leave too.
  - An empty to-do list is ignored, because it only spans a week either side of
    today.
  - Announcements on the Stream page are not collected, because they cannot be
    placed in a course.
- **A full basket still fits.** If the link would pass the dashboard's 32 KB
  limit, the oldest announcements are dropped evenly across courses, and the
  panel says how many. Deadlines are never dropped.
- **Update the helper to get this.** Tampermonkey picks up 0.15.0 by itself
  within a day, or at once from the dashboard's update check.

## [1.7.0](https://github.com/NoGod3524/betterhuskyct/releases/tag/v1.7.0) — Announcements, summarized

*Minor: a new capability — one press turns a course's announcements into what you need to know.*

### Added

- **Summarize a course's announcements.** Pick a course on the announcements
  page and press **Summarize**: its announcements become a few key points —
  deadlines and changed due dates, exams, moved or cancelled classes, things to
  prepare — in the language the page is showing, on any device. The summary
  says how many announcements it read and which service wrote it. ([#56])
- **Two free models, tried in order.** Z.ai's `glm-4.7-flash` first; when it is
  busy, out of quota or failing, Google Gemini's free tier. Keys live only on
  the server (`ZAI_API_KEY`, `GEMINI_API_KEY`); with neither set, the page shows
  no summary button at all. ([#56])

### Privacy

- **Nothing is sent until you press, and the page says where it goes first.**
  Next to the button: usually GLM (run from Singapore; says it keeps nothing),
  or Gemini when Z.ai is busy (Google may use the text to improve its models,
  and reviewers may read it).
- **Contact details are taken out on the server** before either service sees
  anything: email addresses, phone numbers and links (a Zoom link carries its
  passcode). Dates, times, rooms and course codes are kept.
- **Gemini's free tier is never used for readers in the EEA, Switzerland or the
  UK**, as its terms require.
- **No announcement text is logged**, only which service failed and its status.

### Fixed

- **The "No course" announcement filter always showed an empty list.** Its chip
  keyed unfiled announcements as `"__none"`, and the filter compared that with a
  course id of `null`. ([#55])

### Notes

- **On-device summaries came first, and did not last a day.** #55 used Chrome's
  built-in model: private and free, but only on desktop Chrome or Edge with
  22 GB free and 16 GB of memory, after a multi-GB download. Most students, and
  every phone, got nothing, so #56 replaced it.
- **Checked live, with real keys.** GLM answered in about 2.5 s in English and
  Chinese, with dates and rooms copied exactly; an instruction planted inside an
  announcement was ignored. With three requests at once, GLM took one and Gemini
  the other two.
- **Expect a real share of summaries to come from Gemini.** GLM's free tier was
  busy even for a single request in testing. That is the path with Google's
  data terms, which is why the page names it.
- **The summary cache is per server instance.** Summaries are kept in memory for
  six hours and reused for the same announcements, but only by requests that
  reach the same instance, so classmates share less than a shared store would
  allow.
- **AI wording can drift.** One Chinese summary called Friday's *extra* office
  hours "extended" hours. Every summary says the announcements themselves are
  what count.

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
[#55]: https://github.com/NoGod3524/betterhuskyct/pull/55
[#56]: https://github.com/NoGod3524/betterhuskyct/pull/56
[#58]: https://github.com/NoGod3524/betterhuskyct/pull/58
[#60]: https://github.com/NoGod3524/betterhuskyct/pull/60
[#61]: https://github.com/NoGod3524/betterhuskyct/pull/61
[#62]: https://github.com/NoGod3524/betterhuskyct/pull/62
[#64]: https://github.com/NoGod3524/betterhuskyct/pull/64
[#66]: https://github.com/NoGod3524/betterhuskyct/pull/66
[#67]: https://github.com/NoGod3524/betterhuskyct/pull/67
[#68]: https://github.com/NoGod3524/betterhuskyct/pull/68
[#70]: https://github.com/NoGod3524/betterhuskyct/pull/70
[#71]: https://github.com/NoGod3524/betterhuskyct/pull/71
[#73]: https://github.com/NoGod3524/betterhuskyct/pull/73
[#74]: https://github.com/NoGod3524/betterhuskyct/pull/74
[#76]: https://github.com/NoGod3524/betterhuskyct/pull/76
[#77]: https://github.com/NoGod3524/betterhuskyct/pull/77
[#78]: https://github.com/NoGod3524/betterhuskyct/pull/78
[#80]: https://github.com/NoGod3524/betterhuskyct/pull/80
[#81]: https://github.com/NoGod3524/betterhuskyct/pull/81
[#82]: https://github.com/NoGod3524/betterhuskyct/pull/82
[#84]: https://github.com/NoGod3524/betterhuskyct/pull/84
[#86]: https://github.com/NoGod3524/betterhuskyct/pull/86
[#87]: https://github.com/NoGod3524/betterhuskyct/pull/87
[#88]: https://github.com/NoGod3524/betterhuskyct/pull/88
[#89]: https://github.com/NoGod3524/betterhuskyct/pull/89
[#90]: https://github.com/NoGod3524/betterhuskyct/pull/90
[#92]: https://github.com/NoGod3524/betterhuskyct/pull/92
[#93]: https://github.com/NoGod3524/betterhuskyct/pull/93
[#94]: https://github.com/NoGod3524/betterhuskyct/pull/94
[#95]: https://github.com/NoGod3524/betterhuskyct/pull/95
[#97]: https://github.com/NoGod3524/betterhuskyct/pull/97
[#99]: https://github.com/NoGod3524/betterhuskyct/pull/99
[#100]: https://github.com/NoGod3524/betterhuskyct/pull/100
[#102]: https://github.com/NoGod3524/betterhuskyct/pull/102
[#104]: https://github.com/NoGod3524/betterhuskyct/pull/104
[#105]: https://github.com/NoGod3524/betterhuskyct/pull/105
[#106]: https://github.com/NoGod3524/betterhuskyct/pull/106
[#107]: https://github.com/NoGod3524/betterhuskyct/pull/107
[#108]: https://github.com/NoGod3524/betterhuskyct/pull/108
[#109]: https://github.com/NoGod3524/betterhuskyct/pull/109



