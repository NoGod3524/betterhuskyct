# BetterHuskyCT Helper — browser extension

The same helper as the userscript in `../huskyct-helper`, run by the browser itself instead of Tampermonkey. Manifest V3, Chrome and Edge.

- `manifest.json` — storage, scripting, alarms and offscreen permissions, the three supported sites, and optional notifications.
- `relay.js` — content script in the extension's world; carries GM storage requests to the background and hands cached updates to the app. Private background storage is restricted to trusted extension contexts.
- `background.js` — when a matching page loads, injects `shim.js` and then the helper into the page's own world; opens and closes the HuskyCT tab a sync asks for.
- `background-sync.js`, `background-diff.js` — six-hour checks, session-expiry pause, local snapshots and pending changes, notification preferences, and acknowledged delivery to the app. New installations start enabled, with a first check after about one minute; an existing saved off setting is preserved.
- `offscreen.html`, `offscreen.js` — run the same bundled helper's API reader with a DOM and the live HuskyCT session, without opening a HuskyCT tab.
- `popup.html`, `popup.js`, `popup.css` — background and notification controls. Background checks start enabled and can be turned off; notifications start off. Notification previews can contain course names and item titles.
- `changes.js`, `announcements.js`, `content-hash.js`, `is-record.js` in the package — the app's bounded change-history logic and announcement identities, compiled from the public TypeScript sources by the build script.
- `shim.js` — gives the helper the four `GM_*` functions it uses (`GM_getValue`, `GM_setValue`, `GM_addValueChangeListener`, `GM_openInTab`).

`scripts/build-extension.mjs` zips these with the helper into `public/betterhuskyct-extension.zip` before `dev` and `build`; the version is the helper's. To try it: unzip, `chrome://extensions` → Developer mode → Load unpacked. After installing or updating, reload your BetterHuskyCT tab so the browser can attach the helper.

## Sending a new version to Edge

Releases do it on their own. When a release is tagged (`vX.Y.Z`) and the helper's `@version` has not been sent yet, the workflow `.github/workflows/publish-edge.yml` builds the zip, uploads it over the draft in Microsoft Edge Add-ons with `scripts/publish-edge.ts`, and submits it for review with the notes in `certification-notes.txt` and the release's title on top. Review still takes up to seven days, and the browsers update the extension by themselves after it. Once the store has it, the version is remembered as a tag, `edge/X.Y.Z`, and a release that did not move the helper finds that tag and sends nothing. **Run workflow** in the Actions tab sends the current helper by hand.

It uses Microsoft's Add-ons API, v1.1, and needs two repository secrets, from Partner Center → Microsoft Edge → **Publish API** → **Create API credentials**:

- `EDGE_CLIENT_ID`: the Client ID.
- `EDGE_API_KEY`: the API key. It expires (the page shows when), and renewing it there gives a new one to put in the secret.

The API only updates an extension that is already in the store. The listing's text and images, and the first submission, are Partner Center's. A version has to be higher than the one in the store, and a submission already in review has to finish first; the workflow fails and says so otherwise. The same script can be run by hand: `EDGE_CLIENT_ID=… EDGE_API_KEY=… EDGE_PRODUCT_ID=… node scripts/publish-edge.ts`.
