# BetterHuskyCT Helper — browser extension

The same helper as the userscript in `../huskyct-helper`, run by the browser itself instead of Tampermonkey. Manifest V3, Chrome and Edge.

- `manifest.json` — permissions: `storage`, `scripting`, and the three sites the helper already matched.
- `relay.js` — content script in the extension's world; carries the helper's storage to `chrome.storage.local` and its tab requests to the background.
- `background.js` — when a matching page loads, injects `shim.js` and then the helper into the page's own world; opens and closes the HuskyCT tab a sync asks for.
- `shim.js` — gives the helper the four `GM_*` functions it uses (`GM_getValue`, `GM_setValue`, `GM_addValueChangeListener`, `GM_openInTab`).

`scripts/build-extension.mjs` zips these with the helper into `public/betterhuskyct-extension.zip` before `dev` and `build`; the version is the helper's. To try it: unzip, `chrome://extensions` → Developer mode → Load unpacked.
