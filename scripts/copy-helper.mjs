// The helper, served from this site as /huskyct-helper.js.
//
// The userscript is the one source of truth, in tools/huskyct-helper. The bookmark on the Helper
// page loads it from here, because raw.githubusercontent.com serves it as text/plain with
// `nosniff`, which a browser will not run as a script. The copy is made before `dev` and `build`
// and is not committed.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
copyFileSync(
  new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url),
  new URL("../public/huskyct-helper.js", import.meta.url),
);
console.log("public/huskyct-helper.js written");
