# Privacy policy — BetterHuskyCT Helper

*Last updated 2026-10-18.*

BetterHuskyCT Helper is a browser extension for Chrome and Edge. It reads your own HuskyCT data in your own browser and hands it to BetterHuskyCT (`https://betterhuskyct.vercel.app`), the dashboard you use alongside it.

## What it reads

While you are signed in to HuskyCT (`lms.uconn.edu`), it asks HuskyCT, as you, for your course list, announcements, due dates and to-do list, gradebook and course files and links. It uses the session your browser already has.

Background checks start enabled on a new installation and can be turned off in the extension popup. An existing saved off setting stays off after an update. The first check is scheduled about one minute after installation, then checks run about every six hours while the browser is running, including when no HuskyCT or BetterHuskyCT tab is open. A signed-out response pauses these checks until you sign in and retry. Background checks read course-file directories; file contents are downloaded by the manual sync on the Materials page or in HuskyCT's helper panel.

## What it never does

- It never asks for your NetID or password and never copies, saves or exports session cookies. Your browser attaches its existing session to requests to HuskyCT.
- It never sends what it reads to any server of ours or anyone else's. The only requests it makes are to `lms.uconn.edu`, to HuskyCT itself, and it has no analytics, advertising or tracking of any kind.
- It does not sell or share data, and has no use for it beyond showing it to you.

## Where the data goes

What it reads stays inside your browser. Manual sync passes data from HuskyCT to your BetterHuskyCT tab. Background sync keeps its last successful snapshot and pending change history in the extension, then hands them to your BetterHuskyCT tab when it opens. Pending history is limited to the most recent 30 days and 500 entries. No credentials are kept in these snapshots.

Clearing BetterHuskyCT's site data removes the website's copy. Removing the extension removes its own copy. Background sync can read data again while enabled; turn it off before clearing data you do not want imported again. Website backups export the website's saved data, not the extension's separate cache.

System notifications are also optional and start off. Enabling them requests the browser's notification permission. A notification preview can show course names and item titles on your device. The first background reading is a baseline and does not create notifications.

This policy covers the extension. The BetterHuskyCT website is a separate program and is described in the project's README; in particular, its announcement features that use a language model send the text of announcements to the website's server, which passes it to a model provider to produce a summary or a list of suggested tasks. The extension does not do that, and nothing in the extension's data reaches the website's server except through those features.

## Permissions

- `storage`, `unlimitedStorage`: to keep what it reads (including course files you ask for) on your device.
- `scripting`: to run the helper in HuskyCT's and BetterHuskyCT's pages.
- `alarms`, `offscreen`: to schedule background checks and run the bundled reader in a document with DOM support. Checks start enabled and can be turned off in the popup.
- `notifications` (optional): to show local course-update and sign-in reminders only when you enable them. No push server is used.
- Access to `lms.uconn.edu`, `huskyct.uconn.edu` and `betterhuskyct.vercel.app`: to read HuskyCT and to hand the result to BetterHuskyCT. No other site.

## Source and contact

The extension is open source: <https://github.com/NoGod3524/betterhuskyct>. Questions or concerns: open an issue there.
