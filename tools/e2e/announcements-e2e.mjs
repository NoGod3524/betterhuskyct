/**
 * End-to-end check of the announcements feature against the real build.
 *
 * Not a substitute for the unit tests — it answers the one question they cannot:
 * does a link the helper would produce actually put announcements on the page,
 * in a real browser, through the real React app?
 *
 *   node tools/e2e/announcements-e2e.mjs
 *
 * Needs `next build` to have run (it serves the production build), and Chrome.
 * Set CHROME_PATH if yours is not at the puppeteer default below.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Imported from the app's own source, so the payload under test is produced by
// the same code that produces it in production.
const { buildSyncPayload, encodeSyncPayload } = await import(
  "file://" + join(REPO, "src", "lib", "sync.ts").replace(/\\/g, "/")
);
const { parseAnnouncementCandidates } = await import(
  "file://" + join(REPO, "src", "lib", "announcements.ts").replace(/\\/g, "/")
);

const CANDIDATES = [
  "C:/Users/Oscar/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe",
  "C:/Users/Oscar/.cache/puppeteer/chrome/win64-152.0.7977.42/chrome-win64/chrome.exe",
];
const CHROME =
  process.env.CHROME_PATH ?? CANDIDATES.find((candidate) => existsSync(candidate));

const PORT = 3199;
const DEBUG_PORT = 9333;
const PROFILE = join(process.env.TEMP ?? ".", "huskyct-e2e-profile");

const AT = new Date("2026-09-23T12:00:00Z");

if (!CHROME) {
  console.error("No Chrome found. Set CHROME_PATH to a chrome.exe and try again.");
  process.exit(2);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A payload of the shape the helper sends, packed by the app's own packer. */
async function buildFragment() {
  const announcements = parseAnnouncementCandidates(
    [
      {
        courseCode: "MATH 1070Q",
        title: "Midterm moved to the 14th",
        body: "The midterm moves to the 14th. Room unchanged.",
        posted: "9/17/26, 4:47 PM",
        announced: AT.toISOString(),
      },
      {
        courseCode: "SOCI 1501",
        title: "Online office hours tonight",
        body: "Hi everyone, office hours tonight.",
        posted: "7 hours ago, at 5:31 PM",
        announced: AT.toISOString(),
      },
    ],
    AT,
  );

  const payload = buildSyncPayload({
    feeds: [
      {
        name: "HuskyCT to-do",
        courseId: null,
        importedAt: AT.toISOString(),
        events: [
          {
            id: "huskyct-todo-_1_1:" + AT.toISOString(),
            title: "Section 4.7 Homework",
            course: "MATH 1070Q",
            start: "2026-09-25T03:59:00.000Z",
            dateKey: null,
            end: null,
            allDay: false,
            location: null,
            kind: "assignment",
          },
        ],
      },
    ],
    completedIds: [],
    efforts: {},
    courses: { courses: [], assignments: {} },
    announcements,
    now: AT,
  });

  return await encodeSyncPayload(payload);
}

async function cdp(ws, method, params = {}, sessionId) {
  const id = Math.floor(Math.random() * 1e9);
  const message = { id, method, params };
  if (sessionId) message.sessionId = sessionId;

  return await new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id !== id) return;
      ws.removeEventListener("message", onMessage);
      if (data.error) reject(new Error(method + ": " + JSON.stringify(data.error)));
      else resolve(data.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify(message));
    setTimeout(() => reject(new Error(method + " timed out")), 30000);
  });
}

async function waitForHttp(url, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(label + " never came up at " + url);
}

const failures = [];
function check(label, ok, detail) {
  console.log((ok ? "  [PASS] " : "  [FAIL] ") + label + (detail ? "  — " + detail : ""));
  if (!ok) failures.push(label);
}

/**
 * Spawned without a shell, and as `node <next> start` rather than `npx next`.
 *
 * `shell: true` was the first version of this, and it leaked: killing the shell
 * leaves the actual server holding the port. `npx` also adds a wrapper process.
 * This way the pid we hold is the server, and killing it kills the server.
 */
const server = spawn(
  process.execPath,
  [join(REPO, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)],
  { cwd: REPO, stdio: "ignore" },
);
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--remote-debugging-port=" + DEBUG_PORT,
    "--user-data-dir=" + PROFILE,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let ws;
try {
  const fragment = await buildFragment();
  console.log("fragment length:", fragment.length, "\n");

  await waitForHttp("http://127.0.0.1:" + PORT + "/announcements", "next start");
  await waitForHttp("http://127.0.0.1:" + DEBUG_PORT + "/json/version", "chrome");

  const version = await (await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/version")).json();
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve));

  const target = await cdp(ws, "Target.createTarget", { url: "about:blank" });
  const attached = await cdp(ws, "Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  const sessionId = attached.sessionId;

  await cdp(ws, "Runtime.enable", {}, sessionId);
  await cdp(ws, "Page.enable", {}, sessionId);

  const url = "http://127.0.0.1:" + PORT + "/announcements#sync=" + fragment;
  await cdp(ws, "Page.navigate", { url }, sessionId);
  await sleep(6000);

  const text = await cdp(
    ws,
    "Runtime.evaluate",
    { expression: "document.body.innerText", returnByValue: true },
    sessionId,
  );
  const body = text.result.value ?? "";

  console.log("--- what the browser rendered (announcements route) ---");
  console.log(body.split("\n").filter((line) => line.trim()).slice(0, 30).join("\n"));
  console.log("\n--- checks ---");

  check("the sync banner offers the link", /arrived from another device/i.test(body));
  check(
    "the banner counts the announcements",
    /2 course announcement\(s\)/.test(body),
    body.match(/\d+ course announcement\(s\)/)?.[0] ?? "not found",
  );

  // Nothing is written until the user accepts, which is the whole point of the banner.
  const beforeApply = await cdp(
    ws,
    "Runtime.evaluate",
    { expression: "JSON.stringify(Object.keys(localStorage))", returnByValue: true },
    sessionId,
  );
  check(
    "nothing is stored before Apply",
    !/announcements/.test(beforeApply.result.value ?? ""),
    beforeApply.result.value ?? "",
  );

  // Press the real button rather than calling into React.
  const clicked = await cdp(
    ws,
    "Runtime.evaluate",
    {
      expression: `(() => {
        const button = [...document.querySelectorAll("button")]
          .find((node) => /add it here/i.test(node.textContent || ""));
        if (!button) return "no button";
        button.click();
        return "clicked";
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  check("the Apply button was found and clicked", clicked.result.value === "clicked", clicked.result.value);

  await sleep(2500);

  const after = await cdp(
    ws,
    "Runtime.evaluate",
    { expression: "document.body.innerText", returnByValue: true },
    sessionId,
  );
  const afterBody = after.result.value ?? "";

  const stored = await cdp(
    ws,
    "Runtime.evaluate",
    {
      expression: "localStorage.getItem('huskypilot.announcements.v1') || 'MISSING'",
      returnByValue: true,
    },
    sessionId,
  );

  console.log("\n--- what the browser rendered (after Apply) ---");
  console.log(afterBody.split("\n").filter((line) => line.trim()).slice(0, 26).join("\n"));
  console.log("\n--- storage ---");
  console.log((stored.result.value ?? "").slice(0, 300));

  check("the announcements route lists the first announcement", /Midterm moved to the 14th/.test(afterBody));
  check("it lists the second one too", /Online office hours tonight/.test(afterBody));
  check("the posted line is shown as the page wrote it", /9\/17\/26, 4:47 PM/.test(afterBody));
  check("the relative posted line survived verbatim", /7 hours ago, at 5:31 PM/.test(afterBody));
  check("the course code is the group label", /MATH 1070Q/.test(afterBody));
  check("an unmatched course still shows its code", /SOCI 1501/.test(afterBody));
  check("announcements were written to storage", /Midterm moved to the 14th/.test(stored.result.value ?? ""));
  check(
    "the storage key is the one the code declares",
    stored.result.value !== "MISSING",
  );

  // The deadline lands in the subscriptions store, not on this route — the
  // announcements page has no reason to list tasks. Assert where it actually is.
  const feeds = await cdp(
    ws,
    "Runtime.evaluate",
    {
      expression: `(() => {
        const raw = localStorage.getItem("huskypilot.subscriptions.v1");
        if (!raw) return "MISSING";
        const parsed = JSON.parse(raw);
        const titles = parsed.subscriptions.flatMap((s) => s.events.map((e) => e.title));
        return JSON.stringify({ subscriptionCount: parsed.subscriptions.length, titles });
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  console.log("\n--- subscription store ---");
  console.log(feeds.result.value ?? "");
  check(
    "the deadline arrived alongside the announcements",
    /Section 4\.7 Homework/.test(feeds.result.value ?? ""),
    feeds.result.value ?? "",
  );

  const summary = await cdp(
    ws,
    "Runtime.evaluate",
    {
      expression: `(() => {
        const raw = JSON.parse(localStorage.getItem("huskypilot.announcements.v1"));
        return JSON.stringify({ version: raw.version, count: raw.announcements.length, ids: raw.announcements.map(a => a.id) });
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  console.log("\n--- parsed storage ---");
  console.log(summary.result.value ?? "");
  check("two announcements are held", /"count":2/.test(summary.result.value ?? ""));
  check("each has a derived id", (JSON.parse(summary.result.value ?? "{}").ids ?? []).every((id) => /^[0-9a-f]{8}$/.test(id)));

  console.log("\n=== " + (failures.length === 0 ? "ALL CHECKS PASSED" : failures.length + " FAILED: " + failures.join("; ")) + " ===");
} catch (error) {
  console.error("E2E ERROR:", error.message);
  process.exitCode = 1;
} finally {
  ws?.close();
  chrome.kill();
  server.kill();
  await sleep(1500);
}
