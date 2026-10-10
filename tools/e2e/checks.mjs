/**
 * The checks of an end-to-end run and the exit code they earn.
 *
 * A failed check used to be printed and nothing more, so a run with failures could leave the
 * process at exit code 0 and pass for green wherever a script or a pipeline looked only at that.
 * Kept apart from the runner, which needs a browser, so that it can be tested on its own.
 */
export function createChecks(log = console.log) {
  const failures = [];

  function check(label, ok, detail) {
    log((ok ? "  [PASS] " : "  [FAIL] ") + label + (detail ? "  — " + detail : ""));
    if (!ok) failures.push(label);
  }

  /**
   * The exit code the run should end with, given the one already claimed (or undefined): a code
   * somebody set on purpose, such as "behind a login", is kept; a failed check turns a clean
   * run into 1.
   */
  function exitCodeFor(claimed) {
    if (claimed !== undefined && claimed !== 0) return claimed;
    return failures.length > 0 ? 1 : claimed;
  }

  return { check, failures, exitCodeFor };
}
