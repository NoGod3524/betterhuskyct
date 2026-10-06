import assert from "node:assert/strict";
import test from "node:test";

import {
  createHelperSync,
  GIVE_UP_AFTER_MS,
  HELPER_SYNC_PROTOCOL,
  HUSKYCT_TARGET_ORIGIN,
  parseSyncMessage,
  RETRY_EVERY_MS,
  STALL_AFTER_MS,
  type HelperSyncState,
  type HuskyctTab,
} from "../src/lib/helper-sync.ts";

/**
 * BetterHuskyCT's Sync button asks the helper in a HuskyCT tab to read in the background. The
 * request is repeated until the helper answers, because it loads after the tab opens and a
 * student who is signed out has to sign in first.
 */

/** A clock and a queue of timers that a test moves by hand. */
function clock() {
  let now = 0;
  const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
  return {
    now: () => now,
    schedule: (run: () => void, ms: number) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    /** Moves time on, running what falls due, in order. */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((timer) => timer.live && timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        due.live = false;
        due.run();
      }
      now = end;
    },
    pending: () => timers.filter((timer) => timer.live).length,
  };
}

function setup(options: { refuse?: boolean } = {}) {
  const time = clock();
  const sent: unknown[] = [];
  const origins: string[] = [];
  const tab: HuskyctTab = {
    closed: false,
    postMessage: (message, origin) => {
      sent.push(message);
      origins.push(origin);
    },
  };
  const states: HelperSyncState[] = [];
  let opened = 0;
  const sync = createHelperSync({
    open: () => {
      opened++;
      return options.refuse ? null : tab;
    },
    schedule: time.schedule,
    now: time.now,
    onChange: (state) => states.push(state),
  });
  const say = (data: unknown, origin = "https://lms.uconn.edu", source: unknown = tab) => sync.receive({ origin, data, source });
  return { sync, time, tab, sent, origins, states, say, opened: () => opened };
}

const message = (fields: Record<string, unknown>) => ({ protocol: HELPER_SYNC_PROTOCOL, ...fields });
const DONE = { kind: "done", ok: true, courses: 2, announcements: 3, gradeItems: 4, skipped: ["ECON 1201"], sent: true };

test("a message is read only if it is shaped as one the helper sends", () => {
  assert.deepEqual(parseSyncMessage(message({ kind: "ack", state: "started" })), { kind: "ack", state: "started" });
  assert.deepEqual(parseSyncMessage(message({ kind: "progress", course: "MATH 1070Q", index: 1, total: 6 })), { kind: "progress", course: "MATH 1070Q", index: 1, total: 6 });
  assert.deepEqual(parseSyncMessage(message(DONE)), { kind: "done", ok: true, courses: 2, announcements: 3, gradeItems: 4, skipped: ["ECON 1201"], sent: true });

  for (const bad of [
    null,
    "ack",
    { kind: "ack", state: "started" },
    message({ kind: "ack", state: "maybe" }),
    message({ kind: "progress", course: "x", index: -1, total: 2 }),
    message({ kind: "progress", course: "x", index: 1.5, total: 2 }),
    message({ kind: "done", ok: "yes", courses: 1, announcements: 1, gradeItems: 1 }),
    message({ kind: "done", ok: true, courses: 1e9, announcements: 1, gradeItems: 1 }),
    message({ kind: "unknown" }),
  ]) {
    assert.equal(parseSyncMessage(bad), null, JSON.stringify(bad));
  }
  // Odd values are cut down, not trusted at their length.
  const long = parseSyncMessage(message({ ...DONE, skipped: Array.from({ length: 50 }, () => "x".repeat(500)) }));
  assert.equal(long?.kind === "done" && long.skipped.length, 20);
  assert.equal(long?.kind === "done" && long.skipped[0].length, 40);
});

test("a press opens the tab, and asks the helper again every second until it answers", () => {
  const { sync, time, sent, origins, states } = setup();

  sync.start();

  assert.deepEqual(states.map((state) => state.phase), ["waiting"]);
  assert.deepEqual(sent, [{ protocol: HELPER_SYNC_PROTOCOL, kind: "request" }]);
  time.advance(RETRY_EVERY_MS * 3);
  assert.equal(sent.length, 4, "it did not ask again each second");
  assert.ok(origins.every((origin) => origin === HUSKYCT_TARGET_ORIGIN), "a request went to an origin other than HuskyCT's");
});

test("once the helper answers the asking stops, and its progress and result are followed", () => {
  const { sync, time, sent, say, states } = setup();
  sync.start();

  say(message({ kind: "ack", state: "started" }));
  const askedBefore = sent.length;
  time.advance(RETRY_EVERY_MS * 5);
  assert.equal(sent.length, askedBefore, "it kept asking after the helper answered");
  assert.equal(sync.state.phase, "syncing");

  say(message({ kind: "progress", course: "MATH 1070Q", index: 2, total: 6 }));
  assert.deepEqual(sync.state, { phase: "syncing", course: "MATH 1070Q", index: 2, total: 6 });

  say(message(DONE));
  assert.deepEqual(sync.state, { phase: "done", courses: 2, announcements: 3, gradeItems: 4, skipped: ["ECON 1201"], sent: true });
  assert.equal(time.pending(), 0, "a timer was left running");
  assert.equal(states[states.length - 1].phase, "done");
});

test("a result that read nothing is nodata, not done", () => {
  const { sync, say } = setup();
  sync.start();
  say(message({ kind: "ack", state: "started" }));

  say(message({ ...DONE, ok: false, courses: 0, announcements: 0, gradeItems: 0, skipped: [], sent: false }));

  assert.equal(sync.state.phase, "nodata");
});

test("a result that read nothing keeps where it stopped, and a signed-out one asks for a sign-in", () => {
  const nothing = { ...DONE, ok: false, courses: 0, announcements: 0, gradeItems: 0, skipped: [], sent: false };
  const run = (extra: Record<string, unknown>) => {
    const { sync, say } = setup();
    sync.start();
    say(message({ kind: "ack", state: "started" }));
    say(message({ ...nothing, ...extra }));
    return sync.state;
  };

  assert.deepEqual(run({ reason: "courses", detail: "HTTP 403" }), { phase: "nodata", why: { step: "courses", detail: "HTTP 403" } });
  assert.deepEqual(run({ reason: "read", detail: null }), { phase: "nodata", why: { step: "read", detail: null } });
  assert.deepEqual(run({ reason: "signedout", detail: null }), { phase: "failed", reason: "signedout" });
  // What the helper says is cut down to plain words before it is shown.
  assert.deepEqual(run({ reason: "error", detail: "<img src=x onerror=alert(1)>" + "x".repeat(100) }), {
    phase: "nodata",
    why: { step: "error", detail: ("img srcx onerroralert1" + "x".repeat(100)).slice(0, 90) },
  });
  // A reason this does not know is left out, not shown.
  assert.deepEqual(run({ reason: "whatever", detail: "HTTP 403" }), { phase: "nodata" });
});

test("a helper that is busy with a sync of its own is asked again until it is free", () => {
  const { sync, time, sent, say } = setup();
  sync.start();

  say(message({ kind: "ack", state: "busy" }));
  assert.equal(sync.state.phase, "waiting", "busy was taken as started");
  const askedBefore = sent.length;
  time.advance(RETRY_EVERY_MS * 2);
  assert.ok(sent.length > askedBefore, "it stopped asking");
});

test("what does not come from HuskyCT's origin, or from the tab that was opened, is ignored", () => {
  const { sync, say } = setup();
  sync.start();

  say(message({ kind: "ack", state: "started" }), "https://evil.example");
  say(message({ kind: "ack", state: "started" }), "https://lms.uconn.edu", { postMessage() {} });
  say({ kind: "ack", state: "started" });
  say("ack");
  assert.equal(sync.state.phase, "waiting");

  say(message({ kind: "ack", state: "started" }), "https://huskyct.uconn.edu");
  assert.equal(sync.state.phase, "syncing", "HuskyCT's other address is also HuskyCT");
});

test("a helper that never answers is given up on after the time a sign-in needs", () => {
  const { sync, time, sent } = setup();
  sync.start();

  time.advance(GIVE_UP_AFTER_MS - 1000);
  assert.equal(sync.state.phase, "waiting", "gave up while a sign-in could still be in progress");
  time.advance(2000 + RETRY_EVERY_MS);

  assert.deepEqual(sync.state, { phase: "failed", reason: "noanswer" });
  const askedAtEnd = sent.length;
  time.advance(RETRY_EVERY_MS * 5);
  assert.equal(sent.length, askedAtEnd, "it kept asking after giving up");
});

test("a tab that is shut before it answers ends the wait", () => {
  const { sync, time, tab } = setup();
  sync.start();

  tab.closed = true;
  time.advance(RETRY_EVERY_MS);

  assert.deepEqual(sync.state, { phase: "failed", reason: "closed" });
});

test("a sync that goes quiet after it began is called stalled, and any word from it starts the wait again", () => {
  const { sync, time, say } = setup();
  sync.start();
  say(message({ kind: "ack", state: "started" }));

  time.advance(STALL_AFTER_MS - 1000);
  say(message({ kind: "progress", course: "MATH 1070Q", index: 1, total: 2 }));
  time.advance(STALL_AFTER_MS - 1000);
  assert.equal(sync.state.phase, "syncing", "progress did not restart the wait");

  time.advance(2000);
  assert.deepEqual(sync.state, { phase: "failed", reason: "stalled" });
});

test("a browser that refuses the tab leaves the button blocked and asks nothing", () => {
  const { sync, sent } = setup({ refuse: true });

  sync.start();

  assert.deepEqual(sync.state, { phase: "blocked" });
  assert.equal(sent.length, 0);
});

test("a press while a sync is going does nothing; after it ends a new press starts again", () => {
  const { sync, say, opened } = setup();
  sync.start();
  sync.start();
  assert.equal(opened(), 1, "a second tab was opened for a second press");

  say(message({ kind: "ack", state: "started" }));
  sync.start();
  assert.equal(opened(), 1);

  say(message(DONE));
  sync.start();
  assert.equal(opened(), 2);
  assert.equal(sync.state.phase, "waiting");
});

test("a result can be dismissed, but a sync in progress cannot", () => {
  const { sync, say } = setup();
  sync.start();
  sync.dismiss();
  assert.equal(sync.state.phase, "waiting");

  say(message({ kind: "ack", state: "started" }));
  say(message(DONE));
  sync.dismiss();
  assert.equal(sync.state.phase, "idle");
});
