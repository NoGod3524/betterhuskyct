// The browser extension, zipped and served from this site as /betterhuskyct-extension.zip.
//
// It is the same helper as the userscript (tools/huskyct-helper), with the small files in
// tools/extension around it, so the two cannot drift apart. The version is the helper's.
// The zip is made before `dev` and `build` and is not committed.
//
// The same source always gives the same bytes: every file carries one fixed modification time
// instead of the moment of the build. That is what lets anyone build it themselves and compare
// the checksum with the released package (see tools/extension/VERIFY.md).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

const here = (path) => new URL(path, import.meta.url);
const helper = readFileSync(here("../tools/huskyct-helper/huskyct-helper.user.js"), "utf8");
const version = /^\/\/ @version\s+(\S+)/m.exec(helper)?.[1];
if (!version) throw new Error("no @version in the helper");

const manifest = JSON.parse(readFileSync(here("../tools/extension/manifest.json"), "utf8"));
manifest.version = version;

const files = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2) + "\n"), "huskyct-helper.js": strToU8(helper) };
for (const name of ["background.js", "relay.js", "shim.js"]) files[name] = readFileSync(here(`../tools/extension/${name}`));

for (const size of [16, 48, 128]) files[`icons/icon-${size}.png`] = readFileSync(here(`../tools/extension/icons/icon-${size}.png`));

// An output path may be given (the tests build elsewhere); the site serves the one in public/.
const output = process.argv[2] ?? fileURLToPath(here("../public/betterhuskyct-extension.zip"));
mkdirSync(dirname(output), { recursive: true });
// A zip keeps the clock reading of the machine that made it, so the time is built from its parts,
// not as an instant: the same reading comes out whatever time zone the build runs in.
const FIXED_TIME = new Date(2000, 5, 15, 12, 0, 0).getTime();
writeFileSync(output, zipSync(files, { level: 9, mtime: FIXED_TIME }));
console.log(`${process.argv[2] ?? "public/betterhuskyct-extension.zip"} written (${version})`);
