#!/usr/bin/env node
/**
 * Regenerate the UConn course-code map.
 *
 * HuskyCT's calendar feed names a class meeting "Environmental Science" and
 * never says which course that is. UConn's public class search knows the
 * pairing, so this reads it and folds ~12,000 sections per term down to a few
 * thousand unique courses.
 *
 * The endpoint is public — no login, no token. Run it once a semester:
 *
 *     npm run course-map            # every term the site offers
 *     npm run course-map -- 1268    # just one term
 *
 * The request body is URL-encoded JSON with the route on the query string; that
 * is how the class-search page calls it, and raw JSON is rejected.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "lib", "ucc-courses.json");
const ORIGIN = "https://classes.uconn.edu";
const API = `${ORIGIN}/api/?page=fose`;
const USER_AGENT =
  "huskypilot-course-map (+https://github.com/NoGod3524/betterhuskyct)";

/**
 * Terms the site offers, newest first. A term only appears once registration
 * for it opens, and one term's list is not a superset of another's — a course
 * taught only in spring is missing from the fall list — so they get merged.
 */
async function discoverTerms() {
  const response = await fetch(ORIGIN, { headers: { "User-Agent": USER_AGENT } });
  const html = await response.text();

  const terms = [...html.matchAll(/<option[^>]*value="(1\d{3})"[^>]*>([^<]*)</g)].map(
    (match) => ({ code: match[1], label: match[2].trim() }),
  );
  if (terms.length === 0) {
    throw new Error("Could not find a term code on the class-search page.");
  }

  return terms.sort((left, right) => Number(right.code) - Number(left.code));
}

async function fetchSections(term) {
  const payload = { other: { srcdb: term }, criteria: [] };
  const response = await fetch(`${API}&route=search`, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: encodeURIComponent(JSON.stringify(payload)),
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Class search did not return JSON: ${text.slice(0, 200)}`);
  }
  if (parsed.fatal) throw new Error(`Class search refused: ${parsed.fatal}`);

  return parsed;
}

const requested = process.argv.slice(2).filter((arg) => /^1\d{3}$/.test(arg));
const terms =
  requested.length > 0
    ? (await discoverTerms()).filter((term) => requested.includes(term.code))
    : await discoverTerms();

/** code -> title. Across terms a code keeps its shortest title. */
const titles = new Map();

for (const term of terms) {
  const payload = await fetchSections(term.code);
  const rows = payload.results ?? [];
  let added = 0;

  for (const row of rows) {
    const code = String(row.code ?? "").replace(/\s+/g, " ").trim();
    const title = String(row.title ?? "").replace(/\s+/g, " ").trim();
    if (!code || !title) continue;

    const existing = titles.get(code);
    if (!existing) {
      titles.set(code, title);
      added += 1;
    } else if (title.length < existing.length) {
      titles.set(code, title);
    }
  }

  console.log(
    `${term.code} ${term.label}: ${rows.length} sections, ${added} new courses`,
  );
}

const map = Object.fromEntries(
  [...titles.entries()].sort(([left], [right]) => left.localeCompare(right)),
);
const json = JSON.stringify(map);
writeFileSync(OUT, json);

console.log(`\nwrote ${OUT}`);
console.log(`  ${Object.keys(map).length} courses, ${json.length.toLocaleString()} bytes`);

const byTitle = new Map();
for (const [code, title] of Object.entries(map)) {
  const key = title.toLowerCase();
  byTitle.set(key, [...(byTitle.get(key) ?? []), code]);
}
const shared = [...byTitle.values()].filter((codes) => codes.length > 1);
console.log(
  `  ${shared.length} titles belong to more than one code — those are never guessed`,
);
