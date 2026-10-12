# Privacy policy — BetterHuskyCT Helper

*Last updated 2026-10-12.*

BetterHuskyCT Helper is a browser extension for Chrome and Edge. It reads your own HuskyCT data in your own browser and hands it to BetterHuskyCT (`https://betterhuskyct.vercel.app`), the dashboard you use alongside it.

## What it reads

While you are signed in to HuskyCT (`lms.uconn.edu`), it asks HuskyCT, as you, for your course list, announcements, due dates and to-do list, gradebook and course files and links. It uses the session your browser already has.

## What it never does

- It never asks for, reads, stores or sends your NetID, password or cookies.
- It never sends what it reads to any server of ours or anyone else's. The only requests it makes are to `lms.uconn.edu`, to HuskyCT itself, and it has no analytics, advertising or tracking of any kind.
- It does not sell or share data, and has no use for it beyond showing it to you.

## Where the data goes

What it reads is passed, inside your browser, from the HuskyCT tab to the BetterHuskyCT tab, and kept in the extension's local storage and in BetterHuskyCT's storage in your browser. It stays on your device. Clearing BetterHuskyCT's site data or removing the extension removes it.

This policy covers the extension. The BetterHuskyCT website is a separate program and is described in the project's README; in particular, its announcement features that use a language model send the text of announcements to the website's server, which passes it to a model provider to produce a summary or a list of suggested tasks. The extension does not do that, and nothing in the extension's data reaches the website's server except through those features.

## Permissions

- `storage`, `unlimitedStorage`: to keep what it reads (including course files you ask for) on your device.
- `scripting`: to run the helper in HuskyCT's and BetterHuskyCT's pages.
- Access to `lms.uconn.edu`, `huskyct.uconn.edu` and `betterhuskyct.vercel.app`: to read HuskyCT and to hand the result to BetterHuskyCT. No other site.

## Source and contact

The extension is open source: <https://github.com/NoGod3524/betterhuskyct>. Questions or concerns: open an issue there.
