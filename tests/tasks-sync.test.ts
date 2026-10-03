import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarTask } from "../src/lib/calendar-types.ts";
import { EMPTY_COURSE_BOOK } from "../src/lib/courses.ts";
import { buildSyncPayload, serialiseSyncPayload, type SyncPayload } from "../src/lib/sync.ts";
import {
  createTasksReceiver,
  parseTasksMessage,
  TASKS_PROTOCOL,
  type TasksEvent,
} from "../src/lib/tasks-sync.ts";

function task(id: string): CalendarTask {
  return {
    id,
    title: id,
    course: "MATH 1070Q",
    start: "2026-09-18T23:59:00.000Z",
    dateKey: null,
    end: null,
    allDay: false,
    location: null,
    kind: "assignment",
  };
}

/**
 * The wire shape: what the helper actually posts. `SyncPayload` itself has no
 * `courses.version` — that is added only on the way out, by
 * `serialiseSyncPayload` — so a receiver test has to go through it too, the
 * same as a real sender would, rather than handing the application type
 * straight to a parser built for JSON off the wire.
 */
function payload(): unknown {
  return JSON.parse(
    serialiseSyncPayload(
      buildSyncPayload({
        feeds: [{ name: "HuskyCT to-do", courseId: null, importedAt: "2026-09-16T11:00:00.000Z", events: [task("a")] }],
        completedIds: [],
        efforts: {},
        courses: EMPTY_COURSE_BOOK,
        now: new Date("2026-09-16T12:00:00.000Z"),
      }),
    ),
  );
}

const message = (body: Record<string, unknown>) => ({ protocol: TASKS_PROTOCOL, ...body });

function helperWindow() {
  const replies: Array<{ message: Record<string, unknown>; origin: string }> = [];
  return {
    replies,
    source: {
      postMessage(reply: unknown, origin: string) {
        replies.push({ message: reply as Record<string, unknown>, origin });
      },
    },
  };
}

// --- what is accepted -------------------------------------------------------------

test("a hello is answered with ready, and a sync payload is handed to onSync", async () => {
  const applied: SyncPayload[] = [];
  const receive = createTasksReceiver({
    onSync: (incoming) => {
      applied.push(incoming);
      return true;
    },
  });
  const helper = helperWindow();
  const from = "https://lms.uconn.edu";

  receive({ origin: from, data: message({ kind: "hello" }), source: helper.source });
  receive({ origin: from, data: message({ kind: "sync", payload: payload() }), source: helper.source });

  assert.deepEqual(
    helper.replies.map((reply) => reply.message),
    [
      { protocol: TASKS_PROTOCOL, kind: "ready" },
      { protocol: TASKS_PROTOCOL, kind: "stored", ok: true },
    ],
  );
  assert.ok(helper.replies.every((reply) => reply.origin === from), "a reply went to another origin");
  assert.equal(applied.length, 1);
  assert.equal(applied[0].feeds[0].events[0].id, "a");
});

test("parseTasksMessage reads exactly the two message kinds", () => {
  assert.deepEqual(parseTasksMessage(message({ kind: "hello" })), { kind: "hello" });
  const good = parseTasksMessage(message({ kind: "sync", payload: payload() }));
  assert.equal(good?.kind, "sync");
  assert.equal(parseTasksMessage(message({ kind: "stored", ok: true })), null);
  assert.equal(parseTasksMessage({ protocol: "something-else", kind: "hello" }), null);
  assert.equal(parseTasksMessage(message({ kind: "sync", payload: { not: "a payload" } })), null);
});

// --- what is refused ---------------------------------------------------------------

test("only HuskyCT's own origins are heard, and only with a tab to answer", () => {
  const applied: SyncPayload[] = [];
  const receive = createTasksReceiver({ onSync: (incoming) => (applied.push(incoming), true) });
  const stranger = helperWindow();

  for (const origin of ["https://evil.example", "https://lms.uconn.edu.evil.example", "http://lms.uconn.edu"]) {
    receive({ origin, data: message({ kind: "sync", payload: payload() }), source: stranger.source });
  }
  receive({ origin: "https://lms.uconn.edu", data: message({ kind: "sync", payload: payload() }), source: null });

  assert.equal(stranger.replies.length, 0);
  assert.equal(applied.length, 0);
});

test("a payload onSync cannot apply is reported as not stored", () => {
  const receive = createTasksReceiver({
    onSync: () => {
      throw new Error("storage is full");
    },
  });
  const helper = helperWindow();

  receive({ origin: "https://lms.uconn.edu", data: message({ kind: "sync", payload: payload() }), source: helper.source });

  assert.deepEqual(helper.replies.map((reply) => reply.message.ok), [false]);
});

test("a malformed payload never reaches onSync", () => {
  let calls = 0;
  const receive = createTasksReceiver({
    onSync: () => {
      calls += 1;
      return true;
    },
  });
  const helper = helperWindow();
  const event: TasksEvent = {
    origin: "https://lms.uconn.edu",
    data: message({ kind: "sync", payload: { version: 1 } }),
    source: helper.source,
  };

  receive(event);

  assert.equal(calls, 0);
  assert.equal(helper.replies.length, 0);
});
