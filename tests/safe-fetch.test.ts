import assert from "node:assert/strict";
import test from "node:test";

import { SafeFetchError, withinDeadline } from "../src/lib/safe-fetch.ts";

/**
 * The overall deadline on a calendar download.
 *
 * The socket timeout it sits beside is an *idle* timeout, so a server sending a
 * byte every few seconds never trips it and holds the function open. These check
 * the part that stops that. The download itself cannot be driven from a test —
 * the SSRF guard refuses localhost and non-443 ports on purpose.
 */

test("work that outlives the deadline is abandoned, and told to stop", async () => {
  let stopped = false;
  const never = new Promise<string>(() => undefined);

  await assert.rejects(
    withinDeadline(never, Date.now() + 20, () => {
      stopped = true;
    }),
    (error) => error instanceof SafeFetchError && /too long/.test(error.message),
  );
  assert.ok(stopped, "the hung request was left open");
});

test("work that finishes in time is returned untouched", async () => {
  let stopped = false;
  const value = await withinDeadline(Promise.resolve("BEGIN:VCALENDAR"), Date.now() + 1_000, () => {
    stopped = true;
  });

  assert.equal(value, "BEGIN:VCALENDAR");
  assert.equal(stopped, false);
});

test("a failure inside the deadline is passed through as it was", async () => {
  const failure = new SafeFetchError("That calendar file is larger than 2 MB.");
  await assert.rejects(withinDeadline(Promise.reject(failure), Date.now() + 1_000), failure);
});

test("a deadline already spent fails at once rather than waiting", async () => {
  const started = Date.now();
  await assert.rejects(
    withinDeadline(new Promise(() => undefined), started - 1),
    SafeFetchError,
  );
  assert.ok(Date.now() - started < 200);
});

test("the loser of the race settling later is not an unhandled rejection", async () => {
  let unhandled = false;
  const onUnhandled = () => {
    unhandled = true;
  };
  process.on("unhandledRejection", onUnhandled);

  let fail: (error: Error) => void = () => undefined;
  const late = new Promise<string>((_, reject) => {
    fail = reject;
  });
  await assert.rejects(withinDeadline(late, Date.now() + 10), SafeFetchError);

  // What happens in real use: the destroyed socket errors after the timeout won.
  fail(new Error("socket hang up"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.off("unhandledRejection", onUnhandled);

  assert.equal(unhandled, false);
});
