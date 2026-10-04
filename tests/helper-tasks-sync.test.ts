import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import vm from "node:vm";

import { Window } from "happy-dom";

import { createTasksReceiver } from "../src/lib/tasks-sync.ts";
import type { SyncPayload } from "../src/lib/sync.ts";

/**
 * "Collect everything", sent on to BetterHuskyCT the same way course
 * materials and grades already are: `postMessage`, tab to tab, with no
 * `#sync=` link to build or confirm. The receiving side is the app's own
 * code (`createTasksReceiver`), not a stand-in, so a shape the app would
 * reject is caught here too.
 */
const SOURCE = readFileSync(new URL("../tools/huskyct-helper/huskyct-helper.user.js", import.meta.url), "utf8");

type Basket = {
  version: 1;
  courses: Array<{ id: string; code: string | null; announcements: unknown[]; announcementsAt: string | null }>;
  todos: Array<Record<string, unknown>>;
  todosAt: string | null;
  dueDates: Array<Record<string, unknown>>;
  dueDatesAt: string | null;
};
type Helper = {
  TASKS_PROTOCOL: string;
  openBhcTab: () => { location?: { href: string }; closed?: boolean } | null;
  sendTasksToBhc: (
    target: { postMessage(message: unknown, origin: string): void },
    basket: Basket,
    options?: Record<string, unknown>,
  ) => Promise<{ connected: boolean; stored: boolean; deadlines: number; announcements: number }>;
};

const windows: Window[] = [];
after(async () => {
  for (const window of windows) await window.happyDOM.close();
});

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function openPage(): { window: Window; helper: Helper } {
  const window = new Window({ url: "https://lms.uconn.edu/ultra/stream" });
  windows.push(window);
  const sandbox = {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    Blob,
    CompressionStream,
    Response,
    TextEncoder,
    btoa,
    URL,
    console,
    setTimeout,
    clearTimeout,
  };
  // The sync that starts on its own when HuskyCT opens is tested on its own; here it would run in the middle of the tests.
  window.localStorage.setItem("huskypilot.helper.sync.v1", JSON.stringify({ auto: false }));
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  const helper = (window as unknown as { __huskyctHelper: Helper }).__huskyctHelper;
  return { window, helper };
}

function basketWith(todos: Array<Record<string, unknown>>, announcements: Basket["courses"] = []): Basket {
  return {
    version: 1,
    courses: announcements,
    todos,
    todosAt: "2026-09-16T11:00:00.000Z",
    dueDates: [],
    dueDatesAt: null,
  };
}

const todo = (uid: string, title: string, course: string | null = "MATH 1070Q") => ({
  uid,
  title,
  course,
  start: "2026-09-18T23:59:00.000Z",
  end: null,
  allDay: false,
  kind: "assignment",
});

/**
 * The app's receiver (the code the page runs), fed what the helper posts,
 * answering back into the helper's window as a message from the app's origin.
 */
function appTab(window: Window) {
  const applied: SyncPayload[] = [];
  const receive = createTasksReceiver({
    onSync: (payload) => {
      applied.push(payload);
      return true;
    },
  });
  const posted: Array<{ kind: unknown; origin: string }> = [];
  const target = {
    postMessage(message: unknown, origin: string) {
      posted.push({ kind: (message as { kind?: unknown }).kind, origin });
      receive({
        origin: "https://lms.uconn.edu",
        data: message,
        source: {
          postMessage(reply: unknown) {
            window.dispatchEvent(new window.MessageEvent("message", { data: reply, origin: "https://betterhuskyct.vercel.app" }));
          },
        },
      });
    },
  };
  return { applied, target, posted };
}

const SEND = { helloEvery: 20, connectTimeout: 500, storedTimeout: 500 };

test("sent to BetterHuskyCT: the app is handed a payload it accepts, unchanged", async () => {
  const { window, helper } = openPage();
  const app = appTab(window);
  const basket = basketWith([todo("huskyct-todo-1", "Section 4.1 Homework")]);

  const result = plain(await helper.sendTasksToBhc(app.target, basket, SEND));

  assert.deepEqual(result, { connected: true, stored: true, deadlines: 1, announcements: 0 });
  assert.ok(app.posted.every((post) => post.origin === "https://betterhuskyct.vercel.app"), "posted to another origin");
  assert.equal(app.applied.length, 1);
  assert.equal(app.applied[0].feeds[0]?.events[0]?.title, "Section 4.1 Homework");
});

test("an empty basket still reaches the app, as an empty sync", async () => {
  const { window, helper } = openPage();
  const app = appTab(window);

  const result = plain(await helper.sendTasksToBhc(app.target, basketWith([]), SEND));

  assert.deepEqual(result, { connected: true, stored: true, deadlines: 0, announcements: 0 });
});

test("an app that never answers is reported, not waited on forever", async () => {
  const { helper } = openPage();
  const nobody = { postMessage() {} };

  const result = plain(
    await helper.sendTasksToBhc(nobody, basketWith([todo("huskyct-todo-1", "Section 4.1 Homework")]), {
      ...SEND,
      connectTimeout: 100,
    }),
  );

  assert.deepEqual(result, { connected: false, stored: false, deadlines: 0, announcements: 0 });
});

test("a reply from any other page is ignored", async () => {
  const { window, helper } = openPage();
  const impostor = {
    postMessage(message: unknown) {
      if ((message as { kind?: unknown }).kind !== "hello") return;
      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: { protocol: helper.TASKS_PROTOCOL, kind: "ready" },
          origin: "https://evil.example",
        }),
      );
    },
  };

  const result = plain(
    await helper.sendTasksToBhc(impostor, basketWith([todo("huskyct-todo-1", "Section 4.1 Homework")]), {
      ...SEND,
      connectTimeout: 200,
    }),
  );

  assert.equal(result.connected, false);
});

test("the BetterHuskyCT tab is opened on the press, and a tab already on the app is left as it is", () => {
  const { window, helper } = openPage();
  const requested: Array<[string, string]> = [];

  // A blank tab this press just opened: it is pointed at the app.
  const blank = { location: { href: "about:blank" }, closed: false };
  window.open = (url: string, name: string) => {
    requested.push([url, name]);
    return blank as never;
  };
  assert.equal(helper.openBhcTab(), blank);
  assert.deepEqual(requested, [["", "betterhuskyct"]]);
  assert.equal(blank.location.href, "https://betterhuskyct.vercel.app/");

  // A tab already on the app is another origin to this page: reading its
  // address throws, so it is returned untouched rather than reloaded.
  const existing = {
    get location(): never {
      throw new Error("another origin");
    },
    closed: false,
  };
  window.open = () => existing as never;
  assert.equal(helper.openBhcTab(), existing);

  // The browser refused the tab: nothing to send to.
  window.open = () => null as never;
  assert.equal(helper.openBhcTab(), null);
});
