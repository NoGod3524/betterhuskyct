import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

/**
 * The service worker, run for real against an in-memory Cache API.
 *
 * `public/sw.js` is plain script with no imports, so it can be evaluated with
 * stand-ins for `self`, `caches` and `fetch`, and driven by dispatching the
 * events a browser would. That checks what it *does* — which page comes back
 * offline — rather than what its source says.
 */
const ORIGIN = "http://localhost:3000";
const SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

type Listener = (event: Record<string, unknown>) => void;

function loadWorker(pages: Record<string, number>) {
  const store = new Map<string, Map<string, string>>();
  const keyOf = (key: string | { url: string }) =>
    new URL(typeof key === "string" ? key : key.url, ORIGIN).pathname;

  const cacheFor = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const entries = store.get(name)!;
    return {
      put: async (key: string, response: Response) => {
        entries.set(keyOf(key), await response.text());
      },
      match: async (key: string) =>
        entries.has(keyOf(key)) ? new Response(entries.get(keyOf(key))) : undefined,
      addAll: async (keys: string[]) => {
        for (const key of keys) entries.set(keyOf(key), `${keyOf(key)} page`);
      },
    };
  };

  const caches = {
    open: async (name: string) => cacheFor(name),
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (key: string) => {
      for (const name of store.keys()) {
        const hit = await cacheFor(name).match(key);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const network = { online: true };
  const fetch = async (request: { url: string }) => {
    if (!network.online) throw new TypeError("offline");
    const path = new URL(request.url).pathname;
    return new Response(`${path} page`, { status: pages[path] ?? 404 });
  };

  const listeners: Record<string, Listener> = {};
  const self = {
    addEventListener: (type: string, listener: Listener) => (listeners[type] = listener),
    location: { origin: ORIGIN },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(SOURCE, { self, caches, fetch, URL, Promise, Response });

  async function fire(type: string, extra: Record<string, unknown> = {}) {
    let pending: Promise<unknown> | undefined;
    listeners[type]({
      ...extra,
      waitUntil: (value: Promise<unknown>) => (pending = value),
      respondWith: (value: Promise<unknown>) => (pending = value),
    });
    return pending;
  }

  async function navigate(path: string): Promise<string> {
    const response = (await fire("fetch", {
      request: { method: "GET", mode: "navigate", url: ORIGIN + path },
    })) as Response;
    // The cache write is deliberately not awaited by the worker; let it land.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return response.text();
  }

  return { store, network, fire, navigate };
}

test("offline, each route gets its own page back", async () => {
  const worker = loadWorker({ "/": 200, "/plan": 200, "/tasks": 200 });
  await worker.fire("install");
  await worker.fire("activate");

  for (const path of ["/", "/plan", "/tasks"]) await worker.navigate(path);
  worker.network.online = false;

  // Every route used to be stored under "/", so this returned "/tasks page"
  // — whichever was visited last — for all three.
  assert.equal(await worker.navigate("/plan"), "/plan page");
  assert.equal(await worker.navigate("/tasks"), "/tasks page");
  assert.equal(await worker.navigate("/"), "/ page");
});

test("an error page is never kept as the offline copy", async () => {
  const worker = loadWorker({ "/": 200, "/broken": 500 });
  await worker.fire("install");
  await worker.fire("activate");

  await worker.navigate("/");
  await worker.navigate("/broken");
  worker.network.online = false;

  assert.equal(await worker.navigate("/"), "/ page", "a 500 page replaced the shell");
  assert.equal(await worker.navigate("/broken"), "/ page");
});

test("a route never visited falls back to the home page offline", async () => {
  const worker = loadWorker({ "/": 200 });
  await worker.fire("install");
  await worker.fire("activate");
  worker.network.online = false;

  assert.equal(await worker.navigate("/insights"), "/ page");
});

test("activating clears the old cache, whose shell may be another route's page", async () => {
  const worker = loadWorker({ "/": 200 });
  worker.store.set("huskypilot-v1", new Map([["/", "/plan page"]]));

  await worker.fire("install");
  await worker.fire("activate");

  assert.deepEqual([...worker.store.keys()], ["huskypilot-v2"]);
});
