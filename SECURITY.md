# Security

BetterHuskyCT is a student project kept up in spare time. Security reports are welcome and taken seriously, within that.

## Reporting a problem

Please report it **privately**: on GitHub, open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/NoGod3524/betterhuskyct/security/advisories/new)). Only the maintainer sees it. Please don't post details in a public issue until it is fixed.

Say what you found, where, and how to reproduce it. I will try to answer within a week, and to fix what is real quickly; I can't promise a timetable.

## What counts

- **The app** at `betterhuskyct.vercel.app` and its API routes (`/api/...`).
- **The browser helper**: the userscript and the Chrome/Edge extension in `tools/`.
- **The release packages**: a package that does not match this repository (see [tools/extension/VERIFY.md](./tools/extension/VERIFY.md)).

Especially interesting: anything that lets a web page read what the helper holds, run code in the helper, send a student's data somewhere it should not go, or make the app fetch an address it should not.

## What is not in scope

HuskyCT, Blackboard, UConn, and the third-party AI services (Z.ai, Google Gemini, Groq) are not this project; report problems in them to their owners.

## Supported versions

Only the latest release is supported. Fixes ship as a new version, with a note in the [changelog](./CHANGELOG.md).

## How the project limits the harm

- Nothing a student collects is stored on a server of ours; it stays in their browser.
- The helper has no host access beyond HuskyCT and BetterHuskyCT, never asks for a password or cookie, and loads no remote code.
- The AI routes redact email addresses, phone numbers and links before text leaves the server, bound the size and time of what they read, and log no text.

The details are on the [privacy page](./PRIVACY.md).
