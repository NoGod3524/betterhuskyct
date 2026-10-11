import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * The "Project structure" block of each README names the files under src/app, src/components and
 * src/lib. It had drifted (a file that no longer existed, forty that were not listed, the two
 * languages disagreeing), so it is checked: every name must exist, every source file must be named,
 * and both languages must name the same ones.
 */
const SECTIONS: Record<string, string> = { "app/": "src/app/", "components/": "src/components/", "lib/": "src/lib/" };

function namedFiles(readme: string): Set<string> {
  const text = readFileSync(readme, "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf("```text\nsrc/");
  assert.ok(start >= 0, `${readme} has no structure block`);
  const block = text.slice(start, text.indexOf("```", start + 8)).split("\n");
  const named = new Set<string>();
  let base: string | null = null;
  for (const line of block) {
    const heading = /^[├└]─ (app\/|components\/|lib\/)\s*$/.exec(line);
    if (heading) {
      base = SECTIONS[heading[1]];
      continue;
    }
    // a new top-level folder (public/, tools/, ...) ends the src listing
    if (/^[a-z]/.test(line) && !line.startsWith("src/")) base = null;
    if (!base) continue;
    const entry = /^(?:│  |   )[├└]─ ([^#]+?)\s*#/.exec(line);
    if (!entry) continue;
    for (const name of entry[1].split(/,\s*/)) named.add(base + name.trim());
  }
  return named;
}

const english = namedFiles("README.md");
const chinese = namedFiles("README.zh.md");

test("every file the README names under src exists", () => {
  for (const [label, named] of [["README.md", english], ["README.zh.md", chinese]] as const) {
    assert.deepEqual([...named].filter((file) => !existsSync(file)), [], `${label} names files that are not there`);
  }
});

test("every component and library file is named in the README", () => {
  for (const dir of ["src/components", "src/lib"]) {
    const files = readdirSync(dir).filter((file) => /\.(ts|tsx)$/.test(file)).map((file) => `${dir}/${file}`);
    for (const [label, named] of [["README.md", english], ["README.zh.md", chinese]] as const) {
      assert.deepEqual(files.filter((file) => !named.has(file)), [], `${label} leaves out files`);
    }
  }
});

test("the two READMEs name the same files", () => {
  assert.deepEqual([...english].sort(), [...chinese].sort());
  assert.ok(english.size > 80, "the block was not read");
});
