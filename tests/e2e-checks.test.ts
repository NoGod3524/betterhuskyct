import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createChecks } from "../tools/e2e/checks.mjs";

const quiet = () => undefined;

test("a failed check is recorded and printed with its label and detail", () => {
  const lines: string[] = [];
  const { check, failures } = createChecks((line: string) => lines.push(line));
  check("it shows", true);
  check("it counts", false, "got 2");
  assert.deepEqual(failures, ["it counts"]);
  assert.deepEqual(lines, ["  [PASS] it shows", "  [FAIL] it counts  — got 2"]);
});

test("the exit code: clean stays clean, a failed check makes it 1, and a code claimed on purpose is kept", () => {
  const clean = createChecks(quiet);
  clean.check("fine", true);
  assert.equal(clean.exitCodeFor(undefined), undefined);
  assert.equal(clean.exitCodeFor(0), 0);

  const failed = createChecks(quiet);
  failed.check("broken", false);
  assert.equal(failed.exitCodeFor(undefined), 1);
  assert.equal(failed.exitCodeFor(0), 1);
  assert.equal(failed.exitCodeFor(3), 3, "the 'behind a login' code was replaced");
});

test("a run that ends the way the runner does exits 0 when every check passed, and 1 when one failed", () => {
  const helper = fileURLToPath(new URL("../tools/e2e/checks.mjs", import.meta.url)).replace(/\\/g, "/");
  const run = (ok: boolean) =>
    spawnSync(process.execPath, ["--input-type=module", "-e", `import { createChecks } from "file://${helper}"; const { check, exitCodeFor } = createChecks(() => {}); check("one", ${ok}); process.exitCode = exitCodeFor(process.exitCode);`]).status;
  assert.equal(run(true), 0);
  assert.equal(run(false), 1);
});
