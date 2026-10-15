# Checking the extension is what this repository says it is

The helper reads your HuskyCT data, so you should not have to take anyone's word for what is in it. Every release has a package built **by GitHub, from the public code, at the release's tag**, with a checksum and a signed build attestation. You can check it three ways, from quickest to most thorough.

## 1. Check the attestation

Each release on the [Releases page](https://github.com/NoGod3524/betterhuskyct/releases) has `betterhuskyct-helper-X.Y.Z.zip` (the Chrome/Edge extension), `huskyct-helper-X.Y.Z.user.js` (the userscript) and `SHA256SUMS`. Download the zip, then, with the [GitHub CLI](https://cli.github.com/):

```bash
gh attestation verify betterhuskyct-helper-X.Y.Z.zip --repo NoGod3524/betterhuskyct
```

It passes only if GitHub's own record says that exact file was built by this repository's release workflow, from the commit it names. A file edited after the build, or built anywhere else, fails.

## 2. Build it yourself and compare

The build is deterministic: the same source gives the same bytes, whatever the machine or time zone. So you can rebuild and compare checksums with `SHA256SUMS`. You need Node 24 and Git.

```bash
git clone https://github.com/NoGod3524/betterhuskyct.git
cd betterhuskyct
git checkout vX.Y.Z          # the release's tag
npm ci
node scripts/build-extension.mjs my-build.zip
sha256sum my-build.zip       # shasum -a 256 on macOS; Get-FileHash on Windows
```

The line must match the one for `betterhuskyct-helper-X.Y.Z.zip` in `SHA256SUMS`. (The helper's version `X.Y.Z` in the file name is the helper's own, which is in `tools/huskyct-helper/huskyct-helper.user.js` as `@version`, and is not always the same as the site's.)

## 3. Compare what is installed with the release

A browser installs the store's copy, which you can compare file by file with the release. In Edge or Chrome, open `edge://extensions` or `chrome://extensions`, turn on Developer mode, and note the extension's ID. Its files are in your browser profile, under `Extensions/<id>/<version>_0/`. Unzip the release's package beside it and compare each file: `manifest.json`, `huskyct-helper.js`, `background.js`, `relay.js`, `shim.js` and `icons/`. Ignore a `_metadata/` folder, which the browser adds itself.

Packages before the one that introduced this page (helper 2.0.4 and earlier) were built before the build was made deterministic. Their **files** are identical to the release's, but the zip's bytes may differ, so compare files for those, not the zip's checksum.

## What there is to check

Worth knowing while you look:

- **Permissions** are in `manifest.json`: `storage`, `unlimitedStorage` and `scripting`, with access to `lms.uconn.edu`, `huskyct.uconn.edu` and `betterhuskyct.vercel.app` only.
- **No remote code.** Nothing in the package calls `eval` or `new Function`, injects a script, or loads code from an address; everything that runs is in the zip.
- **Where it connects:** to HuskyCT (to read your data with your own session) and nowhere else. It never asks for or stores your password or cookies.

The plain-language version is the [privacy page](../../PRIVACY.md). If you find a mismatch, that is a security problem: please report it privately, as [SECURITY.md](../../SECURITY.md) describes.
