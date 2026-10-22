import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";

/**
 * These run the *shipped* userscript, not a copy of it.
 *
 * The file is a self-contained IIFE so it can be pasted into Tampermonkey, which
 * means there is nothing to import. Loading it in a bare VM context gives the
 * same code a chance to run without a browser, and the helpers it attaches are
 * what the assertions below use.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  join(HERE, "..", "tools", "huskyct-helper", "huskyct-helper.user.js"),
  "utf8",
);

/** The surface the userscript attaches for exactly this purpose. */
type HelperSurface = {
  STRINGS: Record<string, Record<string, string>>;
  LOCALE_KEY: string;
  detectLocale: () => string;
  setLocale: (next: string) => void;
  getLocale: () => string;
  t: (key: string, params?: Record<string, string | number>) => string;
  otherLocale: () => string;
  courseCodeFromDisplay: (value: string | null) => string | null;
  announcementsToCandidates: (
    records: Array<{ title: string; body?: string; posted?: string | null }>,
    courseCode: string | null,
    now?: Date,
  ) => Array<Record<string, unknown>>;
  todosToRecords: (todos: Array<Record<string, unknown>>) => Array<Record<string, unknown>>;
  taskFromRecord: (record: Record<string, unknown>) => Record<string, unknown>;
  syncPayload: (
    records: Array<Record<string, unknown>>,
    now?: Date,
    announcements?: Array<Record<string, unknown>>,
  ) => Record<string, unknown>;
  VERSION: string;
};

const sandbox: Record<string, unknown> = {
  console,
  URL,
  setTimeout,
  clearTimeout,
  navigator: {},
  // Real ones, not stubs: building the BetterHuskyCT link gzips the payload through
  // Blob -> CompressionStream -> Response, and a stub Blob cannot stream.
  Blob,
  Response,
  TextEncoder,
  TextDecoder,
  CompressionStream,
  DecompressionStream,
  btoa,
  atob,
  // A userscript always runs inside a page, so a real Location is part of the
  // environment rather than something the code should work around. This is the
  // host HuskyCT actually serves from.
  location: {
    href: "https://lms.uconn.edu/ultra/course",
    origin: "https://lms.uconn.edu",
    pathname: "/ultra/course",
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(SOURCE, sandbox);

const {
  STRINGS,
  detectLocale,
  setLocale,
  getLocale,
  t,
  otherLocale,
  VERSION,
  courseCodeFromDisplay,
  announcementsToCandidates,
  taskFromRecord,
  syncPayload,
} = sandbox.__huskyctHelper as HelperSurface;

test("the userscript parses and exposes its helpers", () => {
  assert.equal(typeof syncPayload, "function");
  assert.equal(typeof taskFromRecord, "function");
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test("a legacy retained record never receives the time of its new export", () => {
  const record = { uid: "huskyct-todo-_1_1", title: "Homework", start: "2026-10-21T18:00:00.000Z" };
  assert.equal(taskFromRecord(record).observedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(taskFromRecord({ ...record, observedAt: "2026-10-22T08:00:00.000Z" }).observedAt, "2026-10-22T08:00:00.000Z");
});

/**
 * The panel prints this version, and it is the only way to tell from the screen
 * which copy the browser actually installed. If it drifts from `@version`, the
 * panel confidently reports a build that is not running.
 */
test("the panel version matches the version in the metadata block", () => {
  const declared = SOURCE.match(/^\/\/\s*@version\s+(\S+)/m)?.[1];
  assert.ok(declared, "@version is missing from the userscript header");
  assert.equal(VERSION, declared);
});



// ---------------------------------------------------------- the Blackboard side

// These are the real calendar names and records HuskyCT produces, copied from a
// report of the Calendar page with the payload left as it was.
const MATH_NAME =
  "1268-UCONN-MATH-1070Q-SEC100-1191: MATH-1070Q-Mathematics for Business and Economics-SEC100-1268";
const NRE_NAME =
  "1268-UCONN-NRE-1000E-SEC002-3874: NRE-1000E-Environmental Science-SEC002-1268";



test("the course code is read out of the calendar name", () => {
  // The calendar feed's name and the page's own name are parsed by one
  // function; this is the feed's shape.
  assert.equal(courseCodeFromDisplay(MATH_NAME), "MATH 1070Q");
  assert.equal(courseCodeFromDisplay(NRE_NAME), "NRE 1000E");
  assert.equal(courseCodeFromDisplay(null), null);
  assert.equal(courseCodeFromDisplay("nothing useful"), null);
});

// ------------------------------------------------- the endpoint recorder

// ---------------------------------------------------------------- course page
//
// The readers touch the DOM, but the parts that decide what the data means are
// pure, and those are where mistakes would hide.

test("the course code comes out of the name the page displays", () => {
  assert.equal(courseCodeFromDisplay("MATH-1070Q-Mathematics for Business and Economics-SEC100-1268"), "MATH 1070Q");
  assert.equal(courseCodeFromDisplay("NRE-1000E-Environmental Science-SEC002-1268"), "NRE 1000E");
  // The other form on the same page, and the one the calendar feed carries.
  assert.equal(courseCodeFromDisplay("1268-UCONN-MATH-1070Q-SEC100-1191"), "MATH 1070Q");
  assert.equal(courseCodeFromDisplay("no course code here"), null);
  assert.equal(courseCodeFromDisplay(""), null);
  assert.equal(courseCodeFromDisplay(null), null);
});

// ------------------------------------------------------- announcements travel

/** Announcements as a sync hands them over. */
function collectedAnnouncements() {
  return [
    {
      title: "Online OH Starting soon",
      body: "Hi everyone, office hours tonight.",
      posted: "9/17/26, 4:47 PM",
    },
    {
      title: "Midterm moved",
      body: "The midterm moves to the 14th.",
      posted: "7 hours ago, at 5:31 PM",
    },
  ];
}

test("an announcement carries its course by code, because that is what both sides know", () => {
  const candidates = announcementsToCandidates(
    collectedAnnouncements(),
    "MATH 1070Q",
    new Date("2026-09-19T12:00:00Z"),
  );

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].courseCode, "MATH 1070Q");
  assert.equal(candidates[0].title, "Online OH Starting soon");
  assert.equal(candidates[0].body, "Hi everyone, office hours tonight.");
  // The posted time travels as the page's own words, never as a parsed instant.
  assert.equal(candidates[1].posted, "7 hours ago, at 5:31 PM");
});

test("the announced time is when the page was read, so relative prose cannot rot", () => {
  const at = new Date("2026-09-19T12:00:00Z");
  const candidates = announcementsToCandidates(collectedAnnouncements(), "MATH 1070Q", at);

  assert.equal(candidates[0].announced, at.toISOString());
  assert.equal(candidates[1].announced, at.toISOString());
});

test("an announcement with no title is dropped before it reaches the payload", () => {
  const candidates = announcementsToCandidates(
    [{ title: "", body: "orphan", posted: null }, ...collectedAnnouncements()],
    "MATH 1070Q",
  );

  assert.equal(candidates.length, 2);
});

test("a missing body or course becomes null-ish rather than undefined", () => {
  const [candidate] = announcementsToCandidates([{ title: "Only a title" }], null);

  assert.equal(candidate.courseCode, null);
  assert.equal(candidate.body, "");
  assert.equal(candidate.posted, null);
});

// ------------------------------------------- one button for the page's calendar

/**
 * The panel lives in a template string, which means a mismatch between a button
 * and its handler is invisible: no test builds the panel, so a selector that
 * matches nothing would be a null dereference on every page load rather than a
 * failing assertion. (I hit exactly this while writing the change — a button
 * labelled "Send deadlines…" whose handler compared against `"todos"` — so it is
 * a real mistake here, not a hypothetical.)
 *
 * These check the source for the pairings, which is cheap and catches the ones
 * that mattered.
 */
test("every panel button has a handler, and the labels match", () => {
  const actions = [...SOURCE.matchAll(/data-act="([a-z]+)"/g)].map((match) => match[1]);
  assert.ok(actions.length > 0, "no panel buttons found at all");

  for (const action of actions) {
    // `copy` is handled by its own branch; the rest are compared against `act`.
    assert.match(
      SOURCE,
      new RegExp(`act === "${action}"`),
      `the "${action}" button has no handler`,
    );
  }

  // The panel reads no page and keeps no basket to send by hand: what is left is the sync and
  // its switch. Collect everything, Send and Clear basket went in 2.0.0, when every read became
  // a request to HuskyCT's own data.
  assert.deepEqual([...new Set(actions)].sort(), ["autosync", "sync"]);
  for (const gone of ["collectall", "todos", "emptybasket", "acquire", "export", "clear", "course", "copy", "merge", "recapi", "materials", "sendmaterials", "savefiles", "grades", "sendgrades"]) {
    assert.ok(!actions.includes(gone), `the "${gone}" button is back`);
  }
});

/**
 * Three panel bugs that were reported, or measured against the live page, pinned
 * so they cannot come back. None of them is visible to a test that only exercises
 * the pure helpers, because all three live in the DOM wiring.
 */
test("closing the panel collapses it instead of deleting it", () => {
  // Reported as "I do not know where to press it": the close button called
  // `host.remove()`, which took every button out of the page for the rest of the
  // session, with nothing to say how to get them back.
  assert.ok(
    !/\.close"\)\.addEventListener\("click",\s*\(\)\s*=>\s*\{\s*host\.remove\(\)/.test(SOURCE),
    "the close button deletes the panel again instead of collapsing it",
  );
  assert.match(SOURCE, /setCollapsed\(true\)/, "closing no longer collapses");
  // The chip is built with `className = "chip"`, not written as markup.
  assert.match(SOURCE, /className = "chip"/, "the way back (the chip) is gone");
  assert.match(SOURCE, /data-collapsed/, "nothing tracks the collapsed state");
});

test("mounting the panel twice leaves one panel", () => {
  // Measured: injecting the shipped script into a live page twice stacked two
  // panels, and the one underneath looked like a broken panel.
  assert.match(
    SOURCE,
    /querySelectorAll\("#huskypilot-helper"\)\.forEach\(\(node\) => node\.remove\(\)\)/,
    "mountPanel no longer clears an existing panel, so it can stack",
  );
});

/**
 * The ordering that broke the panel in 0.14.0, checked specifically.
 *
 * `langButton` is a `const`, so wiring it or calling `relabel()` above its
 * declaration is a temporal-dead-zone ReferenceError at the top of mountPanel —
 * which means the panel never appears at all. That shipped with 262 tests green,
 * because nothing in this file runs mountPanel; the markup is rendered as a
 * string and the pure helpers are called directly. Only injecting the script
 * into a real page caught it.
 *
 * Deliberately specific rather than a general "is this used before it is
 * declared" walk: the general version cannot tell a reference inside a function
 * body (fine, it runs later — `out` in `show()` is one) from a top-level one
 * (a crash). This asserts the one rule that actually broke, which is the one
 * worth keeping.
 */
test("mountPanel's element handles are declared before anything renders", () => {
  const start = SOURCE.indexOf("function mountPanel()");
  assert.ok(start !== -1, "mountPanel is gone");
  const body = SOURCE.slice(start);

  const lastDeclaration = Math.max(
    ...[...body.matchAll(/const\s+[A-Za-z_$][\w$]*\s*=\s*wrap\.querySelector\(/g)].map(
      (match) => match.index ?? 0,
    ),
  );
  assert.ok(Number.isFinite(lastDeclaration), "no element handles found in mountPanel");

  for (const statement of ["langButton.addEventListener", "\n    relabel();"]) {
    const at = body.indexOf(statement);
    assert.ok(at !== -1, `mountPanel no longer contains: ${statement.trim()}`);
    assert.ok(
      at > lastDeclaration,
      `${statement.trim()} runs before every element handle exists — the TDZ crash that hides the panel`,
    );
  }
});

/**
 * The panel and the dashboard are on different origins, so neither can read the
 * other's localStorage. What they can do is agree — same key name, same two
 * values, same browser-derived default — and that is what these pin.
 */
test("the panel speaks both languages the dashboard does, with no gaps", () => {
  const en = Object.keys(STRINGS.en);
  const zh = Object.keys(STRINGS["zh-CN"]);

  assert.ok(en.length > 20, "the dictionary looks truncated: " + en.length);
  assert.deepEqual(
    en.filter((key) => !zh.includes(key)),
    [],
    "keys missing from the Chinese dictionary",
  );
  assert.deepEqual(
    zh.filter((key) => !en.includes(key)),
    [],
    "keys in Chinese that English does not have",
  );

  // Every key resolves to something, and never to the key itself — that is what
  // a missing translation looks like at runtime.
  for (const locale of ["en", "zh-CN"]) {
    setLocale(locale);
    for (const key of en) {
      const text = t(key);
      assert.ok(text && text.length > 0, `${locale} has an empty string for ${key}`);
      assert.notEqual(text, key, `${locale} is missing a translation for ${key}`);
    }
  }

  setLocale("en");
});

test("the Chinese dictionary is actually Chinese, not copied English", () => {
  setLocale("zh-CN");
  const samples = [t("panelTitle"), t("syncNow"), t("syncNoData")];
  for (const sample of samples) {
    assert.match(sample, /[\u4e00-\u9fff]/, `not translated: ${sample}`);
  }

  setLocale("en");
  assert.ok(!/[\u4e00-\u9fff]/.test(t("syncNow")), "English picked up Chinese text");
});

test("the language defaults to the browser and is remembered once chosen", () => {
  // The sandbox has no localStorage and a bare navigator, so this exercises the
  // fallback path: no stored choice means ask the browser, and no browser answer
  // means English.
  assert.equal(detectLocale(), "en");

  setLocale("zh-CN");
  assert.equal(getLocale(), "zh-CN");
  setLocale("en");
  assert.equal(getLocale(), "en");

  // A junk value must not become the locale.
  setLocale("klingon");
  assert.equal(getLocale(), "en");
});

test("the switch offers the other language", () => {
  setLocale("en");
  assert.equal(otherLocale(), "zh-CN");
  setLocale("zh-CN");
  assert.equal(otherLocale(), "en");
  setLocale("en");
});

/**
 * The rendered markup in the other language, not just the dictionary.
 *
 * The panel is the one surface I could not reach in a browser (the DevTools
 * connection to the signed-in Edge needs its per-connection approval), so this
 * checks what would actually be written into it: the same template the panel
 * builds, rendered from the dictionary. It is the difference between "the
 * dictionary has Chinese in it" and "the panel shows Chinese".
 */
test("the panel markup renders in Chinese, with nothing left in English", () => {
  const surface = sandbox.__huskyctHelper as HelperSurface & {
    panelMarkup: () => string;
  };
  assert.equal(typeof surface.panelMarkup, "function", "panelMarkup is not exposed");

  surface.setLocale("en");
  const english = surface.panelMarkup();
  const englishLabels = ["Sync now", "Sync on its own when HuskyCT opens: on"];
  for (const label of englishLabels) {
    assert.ok(english.includes(label), `the English panel lost: ${label}`);
  }

  surface.setLocale("zh-CN");
  const chinese = surface.panelMarkup();

  // Every translated label must be present in the markup, in Chinese.
  for (const key of ["syncNow", "autoOn"]) {
    const text = surface.t(key);
    assert.match(text, /[\u4e00-\u9fff]/, `not translated: ${key}`);
    assert.ok(chinese.includes(text), `the rendered panel is missing the translation for ${key}`);
  }

  // And no label that was translated may still be sitting there in English.
  // This is the check that catches a template string somebody forgot to wire up.
  for (const label of englishLabels) {
    assert.ok(!chinese.includes(label), `the Chinese panel still contains: ${label}`);
  }

  surface.setLocale("en");
});

test("the panel leads with Sync now, and the automatic-sync switch follows", () => {
  // Anchored on the closing backtick of the template literal, not on the first `</div>`: a comment
  // inside the markup once contained one, and slicing there made a test of this kind lie.
  const start = SOURCE.indexOf('<div class="body">');
  const end = SOURCE.indexOf("`;", start);
  assert.ok(start !== -1 && end > start, "could not find the panel template");
  const panel = SOURCE.slice(start, end);

  const syncAt = panel.indexOf('data-act="sync"');
  const autoAt = panel.indexOf('data-act="autosync"');
  assert.ok(syncAt !== -1 && autoAt !== -1, "the panel lost a button");
  assert.ok(syncAt < autoAt, "the panel's actions are out of order");
  // One primary in the markup: Sync now.
  const primaries = [...panel.matchAll(/class="act primary" data-act="([a-z]+)"( hidden)?/g)];
  assert.deepEqual(
    primaries.map((match) => [match[1], Boolean(match[2])]),
    [["sync", false]],
  );
});
