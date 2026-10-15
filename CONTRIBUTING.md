# Contributing

Thanks for wanting to help. BetterHuskyCT is a small student project, so the rules are few.

## The licence

The code is [MIT](./LICENSE). By sending a change you agree it is released under the same licence. There is no contributor agreement to sign, and the copyright of a contribution stays with whoever wrote it.

## Before a big change

Open an issue first, or comment on an existing one, so you don't build something that can't be merged. A bug fix or a clearer sentence doesn't need that: just send it.

## Running it

```bash
npm ci
npm run dev        # http://localhost:3000, with the demo calendar
npm test           # every test; they use made-up data only
npx tsc --noEmit
npx eslint .
```

Node 24. The extension is built from `tools/` into `public/betterhuskyct-extension.zip` before `dev` and `build`.

## What a good change looks like

- **A test that fails without it.** The suite runs under three time zones in CI; if the change touches dates, run it with `TZ=Pacific/Auckland` and `TZ=America/New_York` too.
- **Real data stays out.** Fixtures and screenshots use made-up names, courses and grades. Never commit a feed link, cookie, token or anything from a real HuskyCT account.
- **The helper's version moves with the helper.** A change to `tools/huskyct-helper` raises `@version` and `VERSION` together (a test checks they agree); a userscript manager only offers an update when it goes up.
- **Everything the app stores is in the backup.** A new `huskypilot.*` browser-storage key must be added to `src/lib/backup.ts`, or a test fails.
- **Files are listed.** A new file under `src/` is named in both READMEs' project structure (a test checks).
- **Words in both languages.** Text shown to students is in `src/lib/i18n.ts`, English and 简体中文.
- **Small, one subject per pull request,** with a plain description of what changed and why.

## What the project will not take

Anything that sends a student's data to a server, adds analytics, advertising or tracking, or puts a feature behind payment. These are in [the promise](./README.md#the-promise) and not up for trade.

## Conduct

Be kind and be specific. Disagreeing about a change is fine; making it about the person isn't.
