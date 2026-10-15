import assert from "node:assert/strict";
import test from "node:test";

import { readRequestText, RequestBodyError } from "../src/lib/request-body.ts";

function request(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/test", {
    method: "POST", body, headers, duplex: "half",
  } as RequestInit);
}

test("request text preserves UTF-8 characters split across chunks, at the exact byte limit", async () => {
  const text = "课程 📚";
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  assert.equal(await readRequestText(request(body), bytes.byteLength), text);
  assert.equal(body.locked, false);
});

test("an oversized declared body is cancelled before reading", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull() { pulls++; },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  await assert.rejects(readRequestText(request(body, { "Content-Length": "11" }), 10), {
    name: "RequestBodyError", status: 413,
  });
  assert.equal(pulls, 0);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("chunked bytes stop at the limit even with a false length and a stalled cancellation", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(Uint8Array.of(1, 2));
    },
    cancel() { cancelled = true; return new Promise(() => {}); },
  }, { highWaterMark: 0 });
  await assert.rejects(readRequestText(request(body, { "Content-Length": "1" }), 4), {
    name: "RequestBodyError", status: 413,
  });
  assert.equal(pulls, 3);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("a slow trickle cannot reset the whole request deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(stream) { controller = stream; },
    cancel() { cancelled = true; },
  });
  const result = readRequestText(request(body), 100);
  const rejected = assert.rejects(result, { name: "RequestBodyError", status: 408 });
  for (let second = 0; second < 4; second++) {
    t.mock.timers.tick(1_000);
    controller!.enqueue(Uint8Array.of(1));
    await Promise.resolve();
  }
  t.mock.timers.tick(1_000);
  await rejected;
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("a failed body exposes a generic error instead of its private contents", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.error(new Error("private syllabus text")); },
  });
  await assert.rejects(readRequestText(request(body), 100), (error) =>
    error instanceof RequestBodyError && error.status === 400 && !error.message.includes("private"),
  );
  assert.equal(body.locked, false);
});
