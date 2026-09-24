import {
  MAX_ANNOUNCEMENTS,
  parseAnnouncementCandidates,
  type Announcement,
} from "./announcements.ts";
import { isDeadline, type CalendarTask } from "./calendar-types.ts";
import { isCalendarTask } from "./import-storage.ts";
import { EFFORT_LEVELS, type EffortMap } from "./effort.ts";
import {
  parseCourseBook,
  serialiseCourseBook,
  type CourseBook,
} from "./courses.ts";

/**
 * Moving a set-up dashboard from one device to another without a server.
 *
 * The whole payload — the calendar, the ticks, the courses, the effort marks —
 * fits in about 1,800 characters once gzipped, so it can ride in the *fragment*
 * of a URL. Browsers never send a fragment to the server, which is what keeps
 * this honest: the data goes from one of the user's devices to another and
 * nowhere else. Nothing is stored, nothing is uploaded, and nothing expires —
 * there is no room to expire from.
 *
 * The feed URL is deliberately not part of the payload. It is a password, and a
 * link that gets pasted into a chat client is not a place for one. The events
 * come across instead, so the second device needs no import at all.
 */
export const SYNC_VERSION = 1;
export const SYNC_FRAGMENT = "#sync=";

/** A guard against a hostile link: this should never be anywhere near it. */
const MAX_PACKED_LENGTH = 32_768;

/**
 * The same guard, after decompression.
 *
 * The packed limit alone does not bound what a link expands to: gzip can reach
 * about 1000:1 on repetitive input, so 32 KB of link could become tens of
 * megabytes of JSON parsed on the main thread of whoever opened it. A real
 * worst case — 400 announcements at their full body length plus a term of
 * deadlines — is well under half a megabyte.
 */
export const MAX_UNPACKED_BYTES = 2 * 1024 * 1024;

export type SyncFeed = {
  name: string | null;
  courseId: string | null;
  importedAt: string;
  events: CalendarTask[];
};

export type SyncPayload = {
  version: number;
  exportedAt: string;
  feeds: SyncFeed[];
  completedIds: string[];
  efforts: EffortMap;
  courses: CourseBook;
  /**
   * Always present, empty when there is nothing to say.
   *
   * Optional *on input* and required on output, and that asymmetry is the whole
   * compatibility story. A helper installed before this field existed still
   * sends `version: 1` with no `announcements`, and bumping the version would
   * have made every one of those links fail outright — the same breakage the two
   * domain flips already cost. An absent field reads as "nothing to add", which
   * is exactly what the older producers mean by it.
   */
  announcements: Announcement[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function parseFeed(value: unknown): SyncFeed | null {
  if (!isRecord(value)) return null;
  if (!isValidDateString(value.importedAt)) return null;
  if (!Array.isArray(value.events) || !value.events.every(isCalendarTask)) return null;

  return {
    name: typeof value.name === "string" ? value.name : null,
    courseId: typeof value.courseId === "string" ? value.courseId : null,
    importedAt: value.importedAt,
    events: value.events,
  };
}

function parseEfforts(value: unknown): EffortMap | null {
  if (!isRecord(value)) return null;

  const efforts: EffortMap = {};
  for (const [taskId, level] of Object.entries(value)) {
    if (!taskId) continue;
    if (typeof level !== "string") continue;
    if (!(EFFORT_LEVELS as readonly string[]).includes(level)) continue;
    efforts[taskId] = level as EffortMap[string];
  }

  return efforts;
}

/**
 * Reads a payload that arrived from another device.
 *
 * As strict as the storage readers: a link is untrusted input, so anything that
 * does not match is dropped rather than half-applied. Feeds with no events are
 * dropped too — they would only add an empty calendar to the list.
 */
export function parseSyncPayload(text: string): SyncPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.version !== SYNC_VERSION) return null;
  if (!isValidDateString(parsed.exportedAt)) return null;
  if (!Array.isArray(parsed.feeds)) return null;
  if (!Array.isArray(parsed.completedIds)) return null;
  if (!parsed.completedIds.every((id) => typeof id === "string")) return null;

  const courses = parseCourseBook(parsed.courses);
  if (!courses) return null;

  const efforts = parseEfforts(parsed.efforts);
  if (!efforts) return null;

  const feeds: SyncFeed[] = [];
  for (const entry of parsed.feeds) {
    const feed = parseFeed(entry);
    if (feed && feed.events.length > 0) feeds.push(feed);
  }

  // Lenient where the rest of this reader is strict, on purpose: an announcement
  // is decoration next to the deadlines, and a link carrying one malformed row
  // should still hand over the term. A missing field is not malformed at all —
  // it is what every producer written before this field existed sends.
  const announcements = parseAnnouncementCandidates(
    parsed.announcements,
    new Date(parsed.exportedAt),
  );

  return {
    version: SYNC_VERSION,
    exportedAt: parsed.exportedAt,
    feeds,
    completedIds: parsed.completedIds as string[],
    efforts,
    courses,
    announcements,
  };
}

export function buildSyncPayload(input: {
  feeds: Array<{ name: string | null; courseId: string | null; importedAt: string; events: CalendarTask[] }>;
  completedIds: Iterable<string>;
  efforts: EffortMap;
  courses: CourseBook;
  announcements?: Announcement[];
  now?: Date;
}): SyncPayload {
  return {
    version: SYNC_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    feeds: input.feeds.map((feed) => ({ ...feed })),
    completedIds: [...input.completedIds],
    efforts: { ...input.efforts },
    courses: {
      courses: input.courses.courses.map((course) => ({ ...course })),
      assignments: { ...input.courses.assignments },
    },
    announcements: (input.announcements ?? []).slice(0, MAX_ANNOUNCEMENTS),
  };
}

/** The stored shape, so a payload round-trips through the same validators. */
export function serialiseSyncPayload(payload: SyncPayload): string {
  return JSON.stringify({
    version: payload.version,
    exportedAt: payload.exportedAt,
    feeds: payload.feeds,
    completedIds: payload.completedIds,
    efforts: payload.efforts,
    courses: serialiseCourseBook(payload.courses),
    announcements: payload.announcements,
  });
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The buffer is spelled out because `Blob` only accepts a view over a plain
// `ArrayBuffer`, not the `ArrayBufferLike` a bare `new Uint8Array()` widens to.
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function through(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * gzip, not deflate-raw: it is the one format every browser implements.
 *
 * `pipeThrough` rather than a hand-written writer, so a stream that errors —
 * which is what a corrupted link looks like — rejects the promise we are already
 * awaiting instead of leaving a rejection nobody handles.
 */
export async function packSync(text: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(text)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));

  return toBase64Url(await through(stream));
}

/** Reads a stream to the end, or throws as soon as it passes `limit` bytes. */
async function throughAtMost(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      // Stop decompressing now, not after the whole bomb has been expanded.
      await reader.cancel();
      throw new Error("The sync link expands past its size limit.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function unpackSync(
  packed: string,
  limit: number = MAX_UNPACKED_BYTES,
): Promise<string> {
  const stream = new Blob([fromBase64Url(packed)])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));

  return new TextDecoder().decode(await throughAtMost(stream, limit));
}

export async function encodeSyncPayload(payload: SyncPayload): Promise<string> {
  return packSync(serialiseSyncPayload(payload));
}

export async function decodeSyncPayload(packed: string): Promise<SyncPayload | null> {
  if (!packed || packed.length > MAX_PACKED_LENGTH) return null;
  try {
    return parseSyncPayload(await unpackSync(packed));
  } catch {
    // A truncated or corrupted link is a normal thing to be handed, not a crash.
    return null;
  }
}

/** The full link a user sends to their other device. */
export function syncLink(origin: string, pathname: string, packed: string): string {
  return `${origin}${pathname}${SYNC_FRAGMENT}${packed}`;
}

export function readSyncFragment(hash: string): string | null {
  if (!hash.startsWith(SYNC_FRAGMENT)) return null;
  const packed = hash.slice(SYNC_FRAGMENT.length);
  return packed.length > 0 && packed.length <= MAX_PACKED_LENGTH ? packed : null;
}

/** A short description of what a payload would bring over, for the prompt. */
export function describeSync(payload: SyncPayload): {
  feeds: number;
  events: number;
  deadlines: number;
  completed: number;
  courses: number;
  efforts: number;
  announcements: number;
} {
  const events = payload.feeds.flatMap((feed) => feed.events);
  return {
    feeds: payload.feeds.length,
    events: events.length,
    deadlines: events.filter(isDeadline).length,
    completed: payload.completedIds.length,
    courses: payload.courses.courses.length,
    efforts: Object.keys(payload.efforts).length,
    announcements: payload.announcements.length,
  };
}
