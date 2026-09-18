# Changelog

Every notable change to HuskyPilot, oldest first. Each entry corresponds to a
merged pull request, and each version tag marks the state of `main` right after
that merge.

The scheme is deliberately simple:

- **Patch** (`0.1.x`, `0.2.x`, `1.0.x`) — a fix, a cleanup, documentation, or a small addition.
- **Minor** (`0.2.0`, `0.3.0`, `1.1.0`) — a new capability, or a change to the architecture.

## [1.3.1](https://github.com/NoGod3524/huskypilot/releases/tag/v1.3.1) — Where did the delete button go

*Patch: the collapsed card had no way in to remove a calendar.*

### Fixed

- The card collapses once a calendar is in, and its only door was labelled
  **Add another calendar** — but the remove button lives behind that door too.
  Nobody would look for "delete" under "add", which is exactly the complaint
  that came back. That button now reads **Manage calendars**, and the line
  under it says so. ([#30])

## [1.3.0](https://github.com/NoGod3524/huskypilot/releases/tag/v1.3.0) — The same dashboard, on your phone

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

## [1.2.0](https://github.com/NoGod3524/huskypilot/releases/tag/v1.2.0) — The calendar names its own courses

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

## [1.1.1](https://github.com/NoGod3524/huskypilot/releases/tag/v1.1.1) — A lecture is not a deadline

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

## [1.1.0](https://github.com/NoGod3524/huskypilot/releases/tag/v1.1.0) — Any calendar, several of them

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

## [1.0.1](https://github.com/NoGod3524/huskypilot/releases/tag/v1.0.1) — Rows you can actually recognise

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

## [1.0.0](https://github.com/NoGod3524/huskypilot/releases/tag/v1.0.0) — Plan

*First stable release. HuskyPilot stops only showing what is due and starts
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

## [0.3.1](https://github.com/NoGod3524/huskypilot/releases/tag/v0.3.1) — Version footer and settled history

### Added

- A version footer on every route, read from `package.json` so the version has a
  single source of truth. ([#18])
- This changelog, plus annotated git tags marking every earlier release. ([#17])

## [0.3.0](https://github.com/NoGod3524/huskypilot/releases/tag/v0.3.0) — Real routes

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

## [0.2.3](https://github.com/NoGod3524/huskypilot/releases/tag/v0.2.3) — Auto-refresh and CSV export

### Added

- Opt-in auto-refresh from a remembered calendar URL. It is off by default, the
  URL is kept in this browser only, and it is removed by unticking the box or
  pressing **Clear saved data**. ([#14])
- CSV export of everything currently on screen, with a UTF-8 byte-order mark so
  Excel reads Chinese text correctly. ([#15])

### Changed

- The privacy wording now says the ICS URL is not stored *unless you explicitly
  ask for it*.

## [0.2.2](https://github.com/NoGod3524/huskypilot/releases/tag/v0.2.2) — Documentation refresh

### Changed

- Both READMEs now document the PWA, reminders, insights, and the optional
  auto-refresh, and the project structure and roadmap are up to date. ([#13])

## [0.2.1](https://github.com/NoGod3524/huskypilot/releases/tag/v0.2.1) — Due-soon reminders

### Added

- A due-soon banner for anything due in the next 24 hours. ([#12])
- Opt-in browser notifications while the app is open, de-duplicated by a task
  fingerprint so the same reminder is never repeated.
- A service worker `notificationclick` handler that brings the open app forward.

## [0.2.0](https://github.com/NoGod3524/huskypilot/releases/tag/v0.2.0) — Installable and offline

*Minor bump: new capability.*

### Added

- A web app manifest, PWA icons, and a theme colour, so HuskyPilot can be added
  to a phone's home screen and opened full screen. ([#11])
- A service worker that caches the app shell: navigations are network-first (so a
  new deploy lands immediately), hashed assets are cache-first, and the import API
  is never cached.
- Safe-area padding so the layout clears the home indicator when installed.

## [0.1.10](https://github.com/NoGod3524/huskypilot/releases/tag/v0.1.10) — Import help

### Added

- An expandable "Where do I find my ICS link?" section on the import card. ([#10])

## [0.1.9](https://github.com/NoGod3524/huskypilot/releases/tag/v0.1.9) — Repository cleanup

### Added

- A secrets audit of the working tree and the full git history before the
  repository was made public.

### Removed

- The assistant prompt file and editor/assistant scaffolding, so the repository
  root only contains project files. ([#9])

## [0.1.8](https://github.com/NoGod3524/huskypilot/releases/tag/v0.1.8) — Continuous integration

### Added

- GitHub Actions running `test`, `lint`, and `build` on every pull request and
  every push to `main`, with least-privilege permissions and concurrency
  cancellation. ([#8])

## [0.1.7](https://github.com/NoGod3524/huskypilot/releases/tag/v0.1.7) — Insights panel

### Added

- A workload analytics section: completion rate, tasks per course, the next 7
  days, and the next 4 weeks. ([#7])

## [0.1.6](https://github.com/NoGod3524/huskypilot/releases/tag/v0.1.6) — Portfolio README

### Added

- A bilingual README (English and Simplified Chinese) with an architecture
  diagram, the SSRF control table, and the design decisions. ([#6])

## [0.1.5](https://github.com/NoGod3524/huskypilot/releases/tag/v0.1.5) — Obsolete panel removed

### Removed

- The outdated "Private by design" panel. ([#5])

## [0.1.4](https://github.com/NoGod3524/huskypilot/releases/tag/v0.1.4) — Dead navigation removed

### Removed

- Sidebar links that pointed at nothing ("Courses" and "Privacy"). ([#4])

## [0.1.3](https://github.com/NoGod3524/huskypilot/releases/tag/v0.1.3) — English / 简体中文

### Added

- A language toggle for the whole interface, including date formatting, remembered
  across visits. ([#3])

## [0.1.2](https://github.com/NoGod3524/huskypilot/releases/tag/v0.1.2) — Task completion

### Added

- A checkbox on every task card, a struck-through title when done, and state that
  survives a refresh and a re-import. ([#2])

## [0.1.1](https://github.com/NoGod3524/huskypilot/releases/tag/v0.1.1) — Local persistence

### Added

- Imported events and their metadata are saved in the browser and restored on
  load, using versioned payloads that recover safely from corrupt data. ([#1])

## [0.1.0](https://github.com/NoGod3524/huskypilot/releases/tag/v0.1.0) — HuskyPilot V0

### Added

- The first working version: paste a HuskyCT / Blackboard ICS link and get the
  next 7 days grouped into Today / Tomorrow / This week.
- An SSRF-hardened server-side download (`safe-fetch.ts`), ICS parsing with
  `node-ical`, and course-name extraction from event titles.
- A `node:test` suite covering parsing, grouping, and URL rejection.

[#1]: https://github.com/NoGod3524/huskypilot/pull/1
[#2]: https://github.com/NoGod3524/huskypilot/pull/2
[#3]: https://github.com/NoGod3524/huskypilot/pull/3
[#4]: https://github.com/NoGod3524/huskypilot/pull/4
[#5]: https://github.com/NoGod3524/huskypilot/pull/5
[#6]: https://github.com/NoGod3524/huskypilot/pull/6
[#7]: https://github.com/NoGod3524/huskypilot/pull/7
[#8]: https://github.com/NoGod3524/huskypilot/pull/8
[#9]: https://github.com/NoGod3524/huskypilot/pull/9
[#10]: https://github.com/NoGod3524/huskypilot/pull/10
[#11]: https://github.com/NoGod3524/huskypilot/pull/11
[#12]: https://github.com/NoGod3524/huskypilot/pull/12
[#13]: https://github.com/NoGod3524/huskypilot/pull/13
[#14]: https://github.com/NoGod3524/huskypilot/pull/14
[#15]: https://github.com/NoGod3524/huskypilot/pull/15
[#16]: https://github.com/NoGod3524/huskypilot/pull/16
[#17]: https://github.com/NoGod3524/huskypilot/pull/17
[#18]: https://github.com/NoGod3524/huskypilot/pull/18
[#19]: https://github.com/NoGod3524/huskypilot/pull/19
[#20]: https://github.com/NoGod3524/huskypilot/pull/20
[#21]: https://github.com/NoGod3524/huskypilot/pull/21
[#22]: https://github.com/NoGod3524/huskypilot/pull/22
[#27]: https://github.com/NoGod3524/huskypilot/pull/27
[#28]: https://github.com/NoGod3524/huskypilot/pull/28
[#29]: https://github.com/NoGod3524/huskypilot/pull/29
[#30]: https://github.com/NoGod3524/huskypilot/pull/30



