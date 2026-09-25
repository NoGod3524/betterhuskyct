/**
 * Lets `node --test` import the app's `.tsx` files.
 *
 * `--experimental-strip-types` removes types but does not transform JSX, so a
 * component could not even be imported. Two hooks close the gap, using only
 * what the repo already has:
 *
 * - `resolve` maps the app's `@/` alias onto `src/`, and finds the file for an
 *   extensionless specifier (`@/lib/sync` → `src/lib/sync.ts`) the way the
 *   bundler does.
 * - `load` transpiles `.tsx` with the `typescript` package already in
 *   devDependencies. `.ts` is left to Node's own type stripping.
 *
 * No type checking happens here — `tsc --noEmit` already does that.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = new URL("../../", import.meta.url);
const CANDIDATES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

/**
 * `next/link` and friends: a package subpath with no `exports` map, which the
 * bundler resolves to `link.js` and Node's ESM resolver refuses without the
 * extension. Retrying with `.js` is what the bundler does.
 */
async function resolvePackageSubpath(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isSubpath = /^(@[^/]+\/)?[^./@][^/]*\/.+/.test(specifier) && !/\.[cm]?js$/.test(specifier);
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || !isSubpath) throw error;
    return nextResolve(`${specifier}.js`, context);
  }
}

export async function resolve(specifier, context, nextResolve) {
  let url = null;
  if (specifier.startsWith("@/")) {
    url = new URL(`src/${specifier.slice(2)}`, ROOT);
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    url = new URL(specifier, context.parentURL);
  }
  if (!url) return resolvePackageSubpath(specifier, context, nextResolve);
  if (url.protocol !== "file:") return nextResolve(specifier, context);

  const path = fileURLToPath(url);
  if (!isFile(path)) {
    const found = CANDIDATES.map((suffix) => path + suffix).find(isFile);
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }
  return nextResolve(url.href, context);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:") || !url.endsWith(".tsx")) return nextLoad(url, context);

  const fileName = fileURLToPath(url);
  const { outputText } = ts.transpileModule(readFileSync(fileName, "utf8"), {
    fileName,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
