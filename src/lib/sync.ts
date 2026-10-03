import {
  MAX_ANNOUNCEMENTS,
  parseAnnouncementCandidates,
  type Announcement,
} from "./announcements.ts";
import { isDeadline, type CalendarTask } from "./calendar-types.ts";
import { isCalendarTask } from "./import-storage.ts";
import { EFFORT_LEVELS, type EffortMap } from "./effort.ts";
import { doneMapFrom, type DoneReason } from "./task-status.ts";
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
  /**
   * What HuskyCT's gradebook says is done, by task id, with the reason. Optional
   * on input for the same reason as `announcements`: a link made before this
   * existed simply says nothing about it.
   */
  doneByHuskyct: Record<string, DoneReason>;
  /** Tasks the student reopened on that device, which HuskyCT's word does not close. */
  reopened: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/**
 * Puts back what a compact link left out, so the rest of the reader sees the
 * full event. A link made before compaction has every field and passes through
 * unchanged.
 */
function restoreEvent(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { uid, ...rest } = value;
  // A task's id is its UID and its start, so a compact link carries the UID alone.
  const id =
    typeof rest.id === "string"
      ? rest.id
      : typeof uid === "string" && typeof rest.start === "string"
        ? `${uid}:${rest.start}`
        : undefined;
  return {
    ...rest,
    id,
    course: rest.course ?? null,
    dateKey: rest.dateKey ?? null,
    end: rest.end ?? null,
    allDay: rest.allDay ?? false,
    location: rest.location ?? null,
  };
}

function parseFeed(value: unknown): SyncFeed | null {
  if (!isRecord(value)) return null;
  if (!isValidDateString(value.importedAt)) return null;
  const events = Array.isArray(value.events) ? value.events.map(restoreEvent) : null;
  if (!events || !events.every(isCalendarTask)) return null;

  return {
    name: typeof value.name === "string" ? value.name : null,
    courseId: typeof value.courseId === "string" ? value.courseId : null,
    importedAt: value.importedAt,
    events,
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
 * Reads a payload already parsed out of JSON — a `postMessage` carries a
 * structured-cloned object, not text, so there is nothing here to `JSON.parse`.
 *
 * As strict as the storage readers: this is untrusted input, so anything that
 * does not match is dropped rather than half-applied. Feeds with no events are
 * dropped too — they would only add an empty calendar to the list.
 */
export function parseSyncPayloadValue(parsed: unknown): SyncPayload | null {
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

  // Lenient, like the announcements: a missing field reads as nothing to add.
  const doneByHuskyct = Object.fromEntries(
    doneMapFrom(isRecord(parsed.doneByHuskyct) ? Object.entries(parsed.doneByHuskyct) : []),
  ) as Record<string, DoneReason>;
  const reopened = Array.isArray(parsed.reopened)
    ? parsed.reopened.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length < 500).slice(0, 5000)
    : [];

  return {
    version: SYNC_VERSION,
    exportedAt: parsed.exportedAt,
    feeds,
    completedIds: parsed.completedIds as string[],
    efforts,
    courses,
    announcements,
    doneByHuskyct,
    reopened,
  };
}

/** The same reading, starting from the JSON text a sync link carries. */
export function parseSyncPayload(text: string): SyncPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return parseSyncPayloadValue(parsed);
}

export function buildSyncPayload(input: {
  feeds: Array<{ name: string | null; courseId: string | null; importedAt: string; events: CalendarTask[] }>;
  completedIds: Iterable<string>;
  efforts: EffortMap;
  courses: CourseBook;
  announcements?: Announcement[];
  doneByHuskyct?: Iterable<[string, DoneReason]>;
  reopened?: Iterable<string>;
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
    doneByHuskyct: Object.fromEntries(input.doneByHuskyct ?? []),
    reopened: [...(input.reopened ?? [])].slice(0, 5000),
  };
}

/** The stored shape, so a payload round-trips through the same validators. */
/** How many announcements a link carries: the newest, the rest stay on the computer. */
export const LINK_ANNOUNCEMENTS = 25;
/** How much of each announcement's body a link carries: a preview, not the whole page. */
export const LINK_BODY_CHARS = 120;
/** How far back a link reaches for events. Older ones are not what a phone is for. */
export const LINK_PAST_DAYS = 30;
/** And how far ahead: a term is months long, and the far end of it stays on the computer. */
export const LINK_AHEAD_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An event without the fields that are empty or default, and without an id
 * that its UID and start already say. A link is read back by `restoreEvent`.
 */
function compactEvent(event: CalendarTask): Record<string, unknown> {
  const suffix = `:${event.start}`;
  const fromUid = event.id.endsWith(suffix) && event.id.length > suffix.length;
  const compact: Record<string, unknown> = { title: event.title, start: event.start };
  if (fromUid) compact.uid = event.id.slice(0, -suffix.length);
  else compact.id = event.id;
  if (event.course !== null) compact.course = event.course;
  if (event.dateKey !== null) compact.dateKey = event.dateKey;
  if (event.end !== null) compact.end = event.end;
  if (event.allDay) compact.allDay = true;
  if (event.location !== null) compact.location = event.location;
  if (event.kind) compact.kind = event.kind;
  return compact;
}

/**
 * The payload as a link carries it. A computer's full set-up, with a long
 * announcement history, is far too long for a QR code; the parts that are long
 * and least needed on the phone are cut here, and the rest is written as it is.
 */
export function serialiseSyncPayload(payload: SyncPayload): string {
  // Only what is near enough to matter on a phone. Older events stay on the computer.
  const now = Date.parse(payload.exportedAt);
  const from = now - LINK_PAST_DAYS * DAY_MS;
  const to = now + LINK_AHEAD_DAYS * DAY_MS;
  const feeds = payload.feeds.map((feed) => ({
    ...feed,
    events: feed.events.filter((event) => {
      const at = Date.parse(event.start);
      return at >= from && at <= to;
    }),
  }));
  const kept = new Set(feeds.flatMap((feed) => feed.events.map((event) => event.id)));
  // A tick, a done state or an effort mark for an event the link no longer
  // carries would only be an id that costs room and points at nothing.
  const forKept = <T>(entries: Iterable<[string, T]>) => Object.fromEntries([...entries].filter(([id]) => kept.has(id)));

  return JSON.stringify({
    version: payload.version,
    exportedAt: payload.exportedAt,
    feeds: feeds.map((feed) => ({ ...feed, events: feed.events.map(compactEvent) })),
    completedIds: payload.completedIds.filter((id) => kept.has(id)),
    efforts: forKept(Object.entries(payload.efforts)),
    courses: serialiseCourseBook(payload.courses),
    announcements: payload.announcements
      .slice(0, LINK_ANNOUNCEMENTS)
      .map((announcement) => ({ ...announcement, body: announcement.body.slice(0, LINK_BODY_CHARS) })),
    doneByHuskyct: forKept(Object.entries(payload.doneByHuskyct)),
    reopened: payload.reopened.filter((id) => kept.has(id)),
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
