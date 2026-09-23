# BetterHuskyCT

**Your course deadlines, organized.** Bring a calendar from any LMS or calendar app — paste its private ICS link, or drop a downloaded `.ics` file — and get one calm, ordered view of what's due next.

**English** | [简体中文](./README.zh.md)

[**Live demo**](https://betterhuskyct.vercel.app/) · [Changelog](./CHANGELOG.md) · [Report an issue](https://github.com/NoGod3524/betterhuskyct/issues)

[![CI](https://github.com/NoGod3524/betterhuskyct/actions/workflows/ci.yml/badge.svg)](https://github.com/NoGod3524/betterhuskyct/actions/workflows/ci.yml)

![BetterHuskyCT](./public/og.png)

## Screenshots

**Overview** — add your calendar, then the rolling week.

![Overview route](./public/screenshots/overview.png)

**Plan** — what to do next, and what no longer fits in the days left.

![Plan route](./public/screenshots/plan.png)

**Tasks** — Today / Tomorrow / This week, with per-course filters and completion.

![Tasks route](./public/screenshots/tasks.png)

The same routes in Chinese: [`overview.zh.png`](./public/screenshots/overview.zh.png) · [`plan.zh.png`](./public/screenshots/plan.zh.png) · [`tasks.zh.png`](./public/screenshots/tasks.zh.png)

## Why

Students track deadlines across an LMS, a syllabus, and email. BetterHuskyCT turns the calendar feed you already have into a single rolling 7-day list, so "what's due next" is one glance instead of a scavenger hunt.

It is deliberately small and privacy-first: no NetID, no password, no scraping, no account.

BetterHuskyCT was built at UConn against HuskyCT (Blackboard), which is the awkward case: it hands out **one feed per course**, and its assignment entries carry no course name. Anything that exports iCalendar works too — see [Where to get your calendar](#where-to-get-your-calendar).

## Features

- **Import any ICS calendar** — drop a downloaded `.ics` file anywhere on the page, or paste a private feed URL; several at once is fine
- **Courses named for you** — a Blackboard feed titles a class meeting `Environmental Science` and never says which course it is, so the app looks the title up in UConn's public course catalogue and fills in `NRE 1000E` itself. Nothing to configure
- **Sync to your phone without a server** — *Sync* packs the calendars, your ticks and your courses into one ~1,800-character link. It rides in the URL fragment, so it is never uploaded, and your feed link is left out of it on purpose
- **Plan** — set how big each task is (quick / medium / long) and BetterHuskyCT warns you honestly when the days left no longer fit the work, and resurfaces anything already overdue
- **Several calendars, several courses** — HuskyCT issues one feed per course, so add as many as you have; file each under a course (code plus LEC / DIS / LAB / SEM), and every task shows its course, whether it is a class meeting or an assignment, its room, and the exact due time — with a per-task picker for the rows the default gets wrong
- **Rolling 7-day view** — Today / Tomorrow / This week, grouped and time-sorted
- **Due-soon reminders** — an in-app banner for anything due in the next 24 hours, plus optional browser notifications while the app is open
- **Installable and offline** — add it to a phone's home screen as a PWA and keep reading saved tasks without a connection
- **Announcements** — the browser helper brings your courses' announcements in on the same press as the deadlines, newest first and grouped by course
- **Completion tracking** — tick tasks done; the state is saved in your browser and survives refresh
- **Workload insights** — completion rate, tasks per course, and the next 7 days / 4 weeks at a glance
- **English / 简体中文** — one-click language toggle, remembered across visits
- **Local persistence** — re-importing the same calendar preserves your completion state
- **Optional auto-refresh** — off by default; tick **Remember new links** and BetterHuskyCT re-imports those feeds whenever you open it
- **Privacy by design** — no NetID, no password, no account. Your ICS URL is used once and discarded unless you opt in to remembering it

## Where to get your calendar

Any system that exports iCalendar (`.ics`) works. The two routes in are equivalent — a link refreshes itself, a file needs no setup at all.

| System | How to get it | One feed covers |
| --- | --- | --- |
| **Blackboard / HuskyCT** | Calendar → gear (*setting*) → ⋯ → *share calendar* → *copy* → paste into the address bar → drag the downloaded file in | **one course per link** |
| **Canvas** | Calendar → *Calendar feed* (bottom right) | every course you are enrolled in |
| **Moodle** | Calendar → *Export calendar* → *Get calendar URL*, or download the `.ics` | whichever courses you select |
| **Google Classroom** | Classroom → *Calendar* → the calendar's settings → *Secret address in iCal format* | every class on that calendar |
| **Google Calendar / Outlook** | Calendar settings → the private/secret iCal address, or *Export* to download a file | the whole calendar |

If your system hands out one link per course — Blackboard does — either paste them one at a time, or download each `.ics` and drop them all into the import card together. Rows are de-duplicated by their ICS UID, so overlapping feeds never double up.

## Architecture

```mermaid
flowchart TB
    subgraph Browser["Browser - React client"]
        UI["Route sections<br/>app-shell.tsx + *-section.tsx"]
        VIEW["calendar-view.ts<br/>group + format"]
        STORE[("localStorage<br/>calendar - completion - locale")]
    end

    subgraph Server["Next.js server - Node runtime"]
        API["POST /api/calendar/import<br/>route.ts"]
        GUARD["safe-fetch.ts<br/>SSRF-guarded HTTPS fetch"]
        PARSE["parse-calendar.ts<br/>node-ical to CalendarTask list"]
    end

    FEED[("HuskyCT / Blackboard<br/>private ICS feed")]

    UI -->|"1 paste ICS URL"| API
    API -->|"2 zod validate"| GUARD
    GUARD -->|"3 HTTPS GET"| FEED
    FEED -->|"4 ICS text"| PARSE
    PARSE -->|"5 JSON events"| API
    API -->|"6 JSON response"| UI
    UI --> VIEW
    UI <-->|"7 persist / restore"| STORE

    classDef client fill:#eaf2ff,stroke:#2a71d8,color:#12314f
    classDef server fill:#eef7f1,stroke:#2f8f5b,color:#123a26
    classDef feed fill:#fff4e8,stroke:#d98324,color:#5a3410
    class UI,VIEW,STORE client
    class API,GUARD,PARSE server
    class FEED feed
```

### How an import works

1. You paste an ICS URL into the dashboard.
2. The client `POST`s it to `/api/calendar/import` (a Next.js route handler on the Node runtime).
3. The payload is validated with Zod (one `url` field, ≤ 2048 characters; request body ≤ 4 KB).
4. `safe-fetch.ts` validates and downloads the feed (see **Security** below).
5. `parse-calendar.ts` parses it with `node-ical`, expanding recurring events, handling all-day events, and extracting course codes from titles.
6. The route returns `{ calendarName, importedAt, events[] }` as JSON with `Cache-Control: no-store`.
7. The client groups events into Today / Tomorrow / This week and renders them. Completed task IDs and the language choice are kept in `localStorage`.

## Security: fetching a user-supplied URL safely

Downloading a URL that a user provides is a textbook SSRF surface, so the download path (`src/lib/safe-fetch.ts`) is intentionally strict:

| Control | What it does |
|---|---|
| HTTPS only | Rejects `http:`, URLs containing credentials, and any port other than 443 |
| DNS pre-resolution | Resolves every address and rejects private, loopback, link-local, multicast, and reserved ranges (IPv4 and IPv6) |
| Pinned connection | Connects to the **validated IP** while preserving the original `Host` header and TLS SNI, reducing DNS-rebinding risk |
| Bounded redirects | Follows at most 3 redirects, re-validating each hop |
| Size and time caps | Rejects responses over 2 MB (both declared and streamed) and times out after 8 seconds |
| Content check | Requires a `BEGIN:VCALENDAR` / `END:VCALENDAR` payload |

Failures are logged without ever writing the private calendar URL to the log.

## Privacy model

| Data | Where it lives |
|---|---|
| Your ICS URL | Nowhere by default — used once, then discarded. Saved in this browser only if you tick **Remember new links** |
| A dropped `.ics` file | Read in the page, sent to BetterHuskyCT's own endpoint to be parsed, and never written anywhere |
| Parsed events | `localStorage`, in your browser only |
| Course announcements | `localStorage`, in your browser only — sent over by the browser helper alongside your deadlines |
| Completed task IDs | `localStorage`, in your browser only |
| Language choice | `localStorage`, in your browser only |

No NetID, no password, no account, no database, no analytics. The **Clear saved data** button wipes the saved calendar and the completion state together.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript, with native type-stripping for tests |
| UI | React 19, Tailwind CSS 4, lucide-react |
| Calendar parsing | node-ical |
| Validation | Zod |
| Tests | Node's built-in test runner (`node --test`) |
| Hosting | Vercel |

## Project structure

```text
src/
├─ app/
│  ├─ api/calendar/import/route.ts   # POST endpoint: validate -> fetch -> parse -> JSON
│  ├─ layout.tsx                     # Metadata, theme setup, provider, persistent shell
│  ├─ manifest.ts                    # Web app manifest (installable PWA)
│  ├─ page.tsx                       # /          overview
│  ├─ plan/page.tsx                  # /plan      what to do next
│  ├─ tasks/page.tsx                 # /tasks     rolling 7-day list
│  ├─ calendar/page.tsx              # /calendar  add another calendar
│  ├─ announcements/page.tsx         # /announcements  course announcements
│  ├─ insights/page.tsx              # /insights  workload analytics
│  ├─ helper/page.tsx                # /helper    install the browser helper
│  ├─ globals.css
│  └─ icon.tsx
├─ components/
│  ├─ calendar-provider.tsx          # Every piece of app state, in the root layout
│  ├─ app-shell.tsx                  # Sidebar, header, footer
│  ├─ connect-section.tsx            # Import form, course list, help text
│  ├─ helper-section.tsx             # How to install the browser helper
│  ├─ plan-section.tsx               # Overdue / at risk / upcoming plan rows
│  ├─ tasks-section.tsx              # Task groups and cards
│  ├─ task-card.tsx                  # One task: badges, time, room, course picker
│  ├─ course-picker.tsx              # Per-task course override
│  ├─ insights-section.tsx           # Workload analytics
│  ├─ announcements-section.tsx      # Course announcements, grouped and filterable
│  ├─ hero-section.tsx               # Overview header and status line
│  ├─ app-footer.tsx                 # Version footer
│  └─ service-worker-registrar.tsx   # Registers the offline service worker (production only)
└─ lib/
   ├─ safe-fetch.ts                  # SSRF-hardened HTTPS download
   ├─ parse-calendar.ts              # ICS parsing -> CalendarTask[]
   ├─ calendar-view.ts               # Grouping (Today / Tomorrow / This week) and formatting
   ├─ calendar-types.ts              # Shared types
   ├─ date-utils.ts                  # Shared local-date helpers
   ├─ effort.ts                      # Per-task effort estimates
   ├─ plan.ts                        # Work remaining vs days left -> at-risk judgement
   ├─ courses.ts                     # Course list, per-task overrides, 1.0.1 migration
   ├─ calendar-source.ts             # Opt-in remembered feed URL
   ├─ export.ts                      # CSV export
   ├─ insights.ts                    # Workload analytics (completion, per course, per week)
   ├─ reminders.ts                   # Due-soon detection and reminder settings
   ├─ calendar-file.ts               # Reading a dropped .ics: size, sanity, file-name labelling
   ├─ subscriptions.ts               # The list of calendars: cached events, names, opt-in URLs
   ├─ announcements.ts               # Course announcements: derived ids, caps, storage
   ├─ import-storage.ts              # 1.0.x single-import storage, read once to migrate
   ├─ completion-storage.ts          # Versioned localStorage for completed task IDs
   └─ i18n.ts                        # English / 简体中文 dictionaries and lookup
public/
├─ sw.js                             # Offline app-shell service worker
└─ icons/                            # PWA icons (192 / 512 / maskable)
tests/                               # node:test suites
```

## Getting started

Requires **Node.js 22+** (the test script relies on native TypeScript type stripping).

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # parsing, grouping, URL blocking, storage
npm run lint
npm run build
npm run course-map   # rebuild the UConn course catalogue (once a semester)
```

`npm run course-map` reads UConn's public class search — no login, no token — and
rewrites `src/lib/ucc-courses.json`, which is what lets a class meeting named
"Environmental Science" find its own course code. Course numbers and titles move
slowly, so running it once a semester is plenty. Pass a term to limit it:
`npm run course-map -- 1268`.

## Design decisions

- **Fetch on the server, not in the browser.** Calendar hosts rarely send permissive CORS headers, and keeping the download in one module (`safe-fetch.ts`) makes the SSRF controls reviewable in a single place.
- **Store the ICS URL only when asked.** The feed URL embeds a private token, so by default it is used once and never written anywhere. Auto-refresh is an explicit opt-in: the URL stays in this browser only (never on the server, never in logs) and is removed by unticking the box or pressing **Clear saved data**.
- **Version every stored payload.** Each `localStorage` entry is a versioned, structurally validated object. Malformed data is dropped (and the user is told) instead of crashing the app.
- **Completion is keyed by event ID.** IDs are derived from the event UID plus start time, so re-importing the same calendar preserves completion. If the source calendar moves an event's start time, its ID changes and completion resets — a known limitation.
- **A rolling 7 days, not a calendar week.** The question the app answers is "what's due next", not "what is on this week's grid".
- **No i18n library.** The string set is bounded and small; two dictionaries plus a lookup function were enough.
- **Reminders only fire while the app is open.** Real background push would need a push server plus stored subscriptions, which this project deliberately avoids. So reminders are an in-app banner plus opt-in notifications, de-duplicated by a task fingerprint so the same reminder is never repeated.
- **Offline means the app shell, not the data.** The service worker serves navigations network-first (so a new deploy lands immediately) and hashed assets cache-first, and never caches the import API. The tasks themselves already live in `localStorage`.

## Testing

`npm test` runs the `node:test` suite using Node's native TypeScript type stripping — no bundler or test framework needed. Coverage includes ICS parsing (recurring events, all-day events, course extraction), grouping, URL / SSRF rejection, and the versioned import and completion storage modules.

## Background

BetterHuskyCT started as a personal tool. Deadlines were spread across HuskyCT, syllabi, and email, and the existing options either asked for a NetID or wanted more access than a simple "what's due next" view needs. This project is a narrow attempt to fix that: one private calendar feed in, one clear list out, and everything kept on your own device.

## Roadmap

- [x] CI: run `test` / `lint` / `build` on every pull request
- [x] Insights view: workload by course, busiest weeks, completion rate
- [x] Installable PWA with an offline app shell
- [x] Due-soon reminders (while the app is open)
- [x] Optional, opt-in auto-refresh (stores the feed URL locally, off by default)
- [x] Export tasks to CSV
- [ ] Background push reminders (would require a push server)

## Author

Built by [Yinuo (NoGod3524)](https://github.com/NoGod3524), a UConn student.

## Disclaimer

BetterHuskyCT is an independent student project. It is **not affiliated with, endorsed by, or supported by** the University of Connecticut, HuskyCT, or Blackboard Inc. "HuskyCT", "Blackboard" and "UConn" are named only to describe what the app reads.

You paste your own private calendar link, and you are responsible for keeping it private — it works like a password. The app has no server-side database and stores nothing about you, but a link you tick **Remember** is saved in that browser.

## License

[MIT](./LICENSE) © 2026 Yinuo
