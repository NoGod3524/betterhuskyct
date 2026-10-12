# BetterHuskyCT Helper — browser extension

The same helper as the userscript in `../huskyct-helper`, run by the browser itself instead of Tampermonkey. Manifest V3, Chrome and Edge.

- `manifest.json` — permissions: `storage`, `scripting`, and the three sites the helper already matched.
- `relay.js` — content script in the extension's world; carries the helper's storage to `chrome.storage.local` and its tab requests to the background.
- `background.js` — when a matching page loads, injects `shim.js` and then the helper into the page's own world; opens and closes the HuskyCT tab a sync asks for.
- `shim.js` — gives the helper the four `GM_*` functions it uses (`GM_getValue`, `GM_setValue`, `GM_addValueChangeListener`, `GM_openInTab`).

`scripts/build-extension.mjs` zips these with the helper into `public/betterhuskyct-extension.zip` before `dev` and `build`; the version is the helper's. To try it: unzip, `chrome://extensions` → Developer mode → Load unpacked.

## Sending a new version to Edge

Releases do it on their own. When a release is tagged (`vX.Y.Z`) and the helper's `@version` moved since the tag before, the workflow `.github/workflows/publish-edge.yml` builds the zip, uploads it over the draft in Microsoft Edge Add-ons with `scripts/publish-edge.ts`, and submits it for review with the notes in `certification-notes.txt` and the release's title on top. Review still takes up to seven days, and the browsers update the extension by themselves after it. A release that did not touch the helper sends nothing. **Run workflow** in the Actions tab sends the current helper by hand.

It uses Microsoft's Add-ons API, v1.1, and needs two repository secrets, from Partner Center → Microsoft Edge → **Publish API** → **Create API credentials**:

- `EDGE_CLIENT_ID`: the Client ID.
- `EDGE_API_KEY`: the API key. It expires (the page shows when), and renewing it there gives a new one to put in the secret.

The API only updates an extension that is already in the store. The listing's text and images, and the first submission, are Partner Center's. A version has to be higher than the one in the store, and a submission already in review has to finish first; the workflow fails and says so otherwise. The same script can be run by hand: `EDGE_CLIENT_ID=… EDGE_API_KEY=… EDGE_PRODUCT_ID=… node scripts/publish-edge.ts`.
