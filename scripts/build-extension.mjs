// The browser extension, zipped and served from this site as /betterhuskyct-extension.zip.
//
// It is the same helper as the userscript (tools/huskyct-helper), with the small files in
// tools/extension around it, so the two cannot drift apart. The version is the helper's.
// The zip is made before `dev` and `build` and is not committed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";

const here = (path) => new URL(path, import.meta.url);
const helper = readFileSync(here("../tools/huskyct-helper/huskyct-helper.user.js"), "utf8");
const version = /^\/\/ @version\s+(\S+)/m.exec(helper)?.[1];
if (!version) throw new Error("no @version in the helper");

const manifest = JSON.parse(readFileSync(here("../tools/extension/manifest.json"), "utf8"));
manifest.version = version;

const files = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2) + "\n"), "huskyct-helper.js": strToU8(helper) };
for (const name of ["background.js", "relay.js", "shim.js"]) files[name] = readFileSync(here(`../tools/extension/${name}`));

mkdirSync(here("../public/"), { recursive: true });
writeFileSync(here("../public/betterhuskyct-extension.zip"), zipSync(files, { level: 9 }));
console.log(`public/betterhuskyct-extension.zip written (${version})`);
