import assert from "node:assert/strict";
import test from "node:test";

import { CLOCK_TICK_MS, watchClock, type ClockHost } from "../src/lib/clock.ts";

/**
 * A stand-in for `window`: intervals that advance only when told to, and
 * listeners that fire only when an event is sent. Enough to drive the clock
 * the way a browser would, without a DOM.
 */
function fakeWindow(visibilityState = "visible") {
  const listeners = { window: new Map<string, Set<() => void>>(), document: new Map<string, Set<() => void>>() };
  const intervals = new Map<number, { handler: () => void; timeout: number }>();
  let nextId = 1;

  const listenable = (registry: Map<string, Set<() => void>>) => ({
    addEventListener(type: string, listener: () => void) {
      if (!registry.has(type)) registry.set(type, new Set());
      registry.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      registry.get(type)?.delete(listener);
    },
  });

  const document = { ...listenable(listeners.document), visibilityState };
  const host: ClockHost = {
    ...listenable(listeners.window),
    setInterval(handler, timeout) {
      const id = nextId++;
      intervals.set(id, { handler, timeout });
      return id;
    },
    clearInterval(id) {
      if (id !== undefined) intervals.delete(id);
    },
    document,
  };

  return {
    host,
    document,
    advance(ms: number) {
      for (const { handler, timeout } of intervals.values()) {
        for (let elapsed = timeout; elapsed <= ms; elapsed += timeout) handler();
      }
    },
    send(target: "window" | "document", type: string) {
      for (const listener of listeners[target].get(type) ?? []) listener();
    },
    live() {
      const count = (registry: Map<string, Set<() => void>>) =>
        [...registry.values()].reduce((total, set) => total + set.size, 0);
      return { intervals: intervals.size, listeners: count(listeners.window) + count(listeners.document) };
    },
  };
}

test("the clock ticks once a minute", () => {
  const browser = fakeWindow();
  let ticks = 0;
  watchClock(() => ticks++, browser.host);

  browser.advance(CLOCK_TICK_MS - 1);
  assert.equal(ticks, 0);
  browser.advance(CLOCK_TICK_MS);
  assert.equal(ticks, 1);
  browser.advance(3 * CLOCK_TICK_MS);
  assert.equal(ticks, 4, "an app left open for three more minutes saw three more ticks");
});

test("coming back to the tab ticks at once rather than waiting for the interval", () => {
  // Phones suspend timers in background tabs; without this, a phone reopened
  // after a night away shows yesterday until the next interval happens to run.
  const browser = fakeWindow();
  let ticks = 0;
  watchClock(() => ticks++, browser.host);

  browser.send("window", "focus");
  assert.equal(ticks, 1);

  browser.send("document", "visibilitychange");
  assert.equal(ticks, 2, "becoming visible did not refresh the clock");
});

test("a tab being hidden does not tick", () => {
  const browser = fakeWindow("hidden");
  let ticks = 0;
  watchClock(() => ticks++, browser.host);

  browser.send("document", "visibilitychange");
  assert.equal(ticks, 0);
});

test("the cleanup removes the interval and both listeners", () => {
  const browser = fakeWindow();
  let ticks = 0;
  const stop = watchClock(() => ticks++, browser.host);
  assert.deepEqual(browser.live(), { intervals: 1, listeners: 2 });

  stop();

  assert.deepEqual(browser.live(), { intervals: 0, listeners: 0 }, "an unmounted provider kept ticking");
  browser.advance(5 * CLOCK_TICK_MS);
  browser.send("window", "focus");
  browser.send("document", "visibilitychange");
  assert.equal(ticks, 0);
});
