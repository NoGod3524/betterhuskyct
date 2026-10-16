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
import ts from "typescript";

const here = (path) => new URL(path, import.meta.url);
// Text goes into the package with LF line endings, so a checkout that turned them into CRLF (git on
// Windows does) still builds the same package as GitHub's.
const text = (path) => readFileSync(here(path), "utf8").replace(/\r\n/g, "\n");
const helper = text("../tools/huskyct-helper/huskyct-helper.user.js");
const version = /^\/\/ @version\s+(\S+)/m.exec(helper)?.[1];
if (!version) throw new Error("no @version in the helper");

const manifest = JSON.parse(text("../tools/extension/manifest.json"));
manifest.version = version;

const files = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2) + "\n"), "huskyct-helper.js": strToU8(helper) };
for (const name of ["background.js", "background-sync.js", "background-diff.js", "offscreen.html", "offscreen.js", "popup.html", "popup.js", "popup.css", "relay.js", "shim.js"]) {
  files[name] = strToU8(text(`../tools/extension/${name}`).replace(/"\.\.\/\.\.\/src\/lib\/(changes|announcements)\.ts"/g, '"./$1.js"'));
}
for (const name of ["changes", "is-record", "announcements", "content-hash"]) {
  const compiled = ts.transpileModule(text(`../src/lib/${name}.ts`), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, newLine: ts.NewLineKind.LineFeed },
  }).outputText.replace(/"\.\/(is-record|content-hash)\.ts"/g, '"./$1.js"');
  files[`${name}.js`] = strToU8(compiled);
}

for (const size of [16, 48, 128]) files[`icons/icon-${size}.png`] = readFileSync(here(`../tools/extension/icons/icon-${size}.png`));

// An output path may be given (the tests build elsewhere); the site serves the one in public/.
const output = process.argv[2] ?? fileURLToPath(here("../public/betterhuskyct-extension.zip"));
mkdirSync(dirname(output), { recursive: true });
// A zip keeps the clock reading of the machine that made it, so the time is built from its parts,
// not as an instant: the same reading comes out whatever time zone the build runs in.
const FIXED_TIME = new Date(2000, 5, 15, 12, 0, 0).getTime();
writeFileSync(output, zipSync(files, { level: 9, mtime: FIXED_TIME }));
console.log(`${process.argv[2] ?? "public/betterhuskyct-extension.zip"} written (${version})`);
