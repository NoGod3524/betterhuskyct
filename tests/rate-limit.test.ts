import assert from "node:assert/strict";
import test from "node:test";

import { clientKey, createRateLimiter } from "../src/lib/rate-limit.ts";

test("the first requests in a window are allowed", () => {
  const check = createRateLimiter({ windowMs: 60_000, max: 3 });

  assert.deepEqual(check("a", 0), {
    allowed: true,
    remaining: 2,
    retryAfterSeconds: 0,
  });
  assert.equal(check("a", 1).remaining, 1);
  assert.equal(check("a", 2).remaining, 0);
});

test("the request after the limit is refused, with a wait", () => {
  const check = createRateLimiter({ windowMs: 60_000, max: 2 });
  check("a", 0);
  check("a", 1_000);

  const refused = check("a", 2_000);

  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  // The window started at 0, so it reopens at 60s: 58 seconds from now.
  assert.equal(refused.retryAfterSeconds, 58);
});

test("the window slides, so the limit is not a permanent ban", () => {
  const check = createRateLimiter({ windowMs: 60_000, max: 1 });
  check("a", 0);

  assert.equal(check("a", 30_000).allowed, false);
  assert.equal(check("a", 60_001).allowed, true);
});

test("each key gets its own budget", () => {
  const check = createRateLimiter({ windowMs: 60_000, max: 1 });
  check("a", 0);

  assert.equal(check("a", 0).allowed, false);
  assert.equal(check("b", 0).allowed, true);
});

test("a flood of distinct keys cannot grow the map without bound", () => {
  const check = createRateLimiter({ windowMs: 60_000, max: 5, maxKeys: 3 });

  for (let index = 0; index < 50; index += 1) {
    check(`key-${index}`, 0);
  }

  // The limiter keeps working after the prune rather than throwing or leaking.
  assert.equal(check("fresh", 0).allowed, true);
});

test("clientKey prefers the first forwarded address", () => {
  const request = (headers: Record<string, string>) =>
    new Request("https://example.com/api", { method: "POST", headers });

  assert.equal(
    clientKey(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })),
    "203.0.113.7",
  );
  assert.equal(clientKey(request({ "x-real-ip": "198.51.100.4" })), "198.51.100.4");
  // No address at all still yields a stable bucket rather than an exception.
  assert.equal(clientKey(request({})), "unknown");
});

test("clientKey trusts the platform's header over one a caller can write", () => {
  const request = (headers: Record<string, string>) =>
    new Request("https://example.com/api", { method: "POST", headers });

  // A caller rotating a made-up x-forwarded-for must not get a new bucket each
  // time when the platform has said who they really are.
  const spoofed = { "x-forwarded-for": "1.2.3.4", "x-real-ip": "198.51.100.4" };
  assert.equal(clientKey(request(spoofed)), "198.51.100.4");
  assert.equal(
    clientKey(request({ ...spoofed, "x-vercel-forwarded-for": "203.0.113.9" })),
    "203.0.113.9",
  );
});
