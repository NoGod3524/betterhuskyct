/**
 * Course announcements, as a first-class thing the app can hold.
 *
 * Until now the helper could read announcements but had nowhere to put them: it
 * wrote a Markdown digest and the app only ever knew about deadlines. This is the
 * data type that lets them arrive the same way deadlines do.
 *
 * Three properties matter, and each is a response to something measured:
 *
 * - **An announcement has an id, and it is derived rather than given.**
 *   Blackboard hands out no id for an announcement, and the only timestamp on it
 *   is the page's own words — "7 hours ago, at 5:31 PM" — which the helper
 *   deliberately refuses to convert, because turning a relative time into an
 *   instant needs a clock reading that may not match the person reading it. So
 *   the id is a hash of the parts that *are* stable across collects. Collecting
 *   the same course twice updates a row in place instead of duplicating it.
 * - **The posted time is kept as text.** Converting it would mean inventing a
 *   precision the page does not have, and a wrong date on an announcement is
 *   worse than an approximate one. `announced` — when we actually saw it — is
 *   what gets sorted and aged.
 * - **`title` is the only required field.** The helper already skips any row
 *   without one, so demanding more would be the "depending on the caller's
 *   selector for the shape of a record" mistake that file's own comments warn
 *   against: it is how an empty entry reaches the output.
 */

export const ANNOUNCEMENTS_STORAGE_KEY = "huskypilot.announcements.v1";
const ANNOUNCEMENTS_STORAGE_VERSION = 1;

/**
 * Caps, because this travels in a URL fragment.
 *
 * A fragment is not a database: the whole payload has to fit in about 32 KB
 * once gzipped and base64url'd, and a term of announcements with full bodies
 * can approach that on its own. The helper's own guard is 32 KB for a term of
 * 120 deadlines at ~1.4 KB, so these numbers leave the deadlines plenty of room.
 */
export const MAX_ANNOUNCEMENTS = 400;
export const MAX_ANNOUNCEMENT_BODY = 1_200;

export type Announcement = {
  /** Derived from course, title and posted — stable across collects. */
  id: string;
  /** Resolved to a local course when one matches; null when none does. */
  courseId: string | null;
  /** The course as the page named it, so an unmatched one is still readable. */
  courseCode: string | null;
  title: string;
  body: string;
  /** The page's own words. Never converted to an instant. */
  posted: string | null;
  /** When this device (or the device that sent it) actually saw it. */
  announced: string;
};

/**
 * What the helper sends, before ids and course resolution exist.
 *
 * Same field names as `Announcement` on purpose: whoever adds the next producer
 * should be able to copy the shape rather than learn a second vocabulary.
 */
export type AnnouncementCandidate = {
  courseCode: string | null;
  title: string;
  body: string;
  posted: string | null;
  announced: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isAnnouncement(value: unknown): value is Announcement {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (typeof value.courseId === "string" || value.courseId === null) &&
    (typeof value.courseCode === "string" || value.courseCode === null) &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    (typeof value.posted === "string" || value.posted === null) &&
    isValidDateString(value.announced)
  );
}

/**
 * FNV-1a, as hex.
 *
 * Not a security hash and not trying to be: it only has to be stable, cheap, and
 * spread well enough that two announcements in one course do not collide. A
 * cryptographic digest would be more code for a property nothing reads.
 */
function hash(value: string): string {
  let accumulator = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    accumulator ^= value.charCodeAt(index);
    accumulator = Math.imul(accumulator, 0x01000193);
  }
  return (accumulator >>> 0).toString(16).padStart(8, "0");
}

/**
 * The id an announcement keeps for the rest of its life.
 *
 * The course code is an input rather than the resolved course id because ids are
 * per-device UUIDs: the same announcement arriving by sync on a second device
 * has to hash to the same thing, or it would be counted twice there.
 */
export function computeAnnouncementId(input: {
  courseCode: string | null;
  title: string;
  posted: string | null;
}): string {
  return hash(
    `${input.courseCode ?? ""}|${input.title}|${input.posted ?? ""}`,
  );
}

function clamp(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

/** Collapses the whitespace the helper's `textOf` already collapses, then trims. */
function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * Reads what a producer sent, and returns only the entries that are usable.
 *
 * Lenient by design, and the opposite of `parseSyncPayload`'s all-or-nothing
 * rule. That strictness exists because a *link* is untrusted input that must not
 * be half-applied. This is downstream of that check, and an announcement with no
 * body is a perfectly normal announcement — the title is the part that carries
 * the meaning. Dropping the whole batch because one row is thin would be the
 * wrong trade.
 */
export function parseAnnouncementCandidates(
  value: unknown,
  now: Date = new Date(),
): Announcement[] {
  if (!Array.isArray(value)) return [];

  const stamp = now.toISOString();
  const byId = new Map<string, Announcement>();

  for (const entry of value) {
    if (!isRecord(entry)) continue;

    const title = text(entry.title);
    // Not `!!title`: a title is the one thing an announcement cannot lose, and
    // this is the same guard the helper applies before it records a row.
    if (!title) continue;

    const rawCode = text(entry.courseCode);
    const courseCode = rawCode.length > 0 ? rawCode : null;
    const rawPosted = text(entry.posted);
    const posted = rawPosted.length > 0 ? rawPosted : null;
    const announced = isValidDateString(entry.announced) ? entry.announced : stamp;

    const announcement: Announcement = {
      id: computeAnnouncementId({ courseCode, title, posted }),
      courseId: null,
      courseCode,
      title: clamp(title, 200),
      body: clamp(text(entry.body), MAX_ANNOUNCEMENT_BODY),
      posted,
      announced,
    };

    // A batch is allowed to repeat itself; the last reading wins, because a
    // producer working down a page has the fullest copy of a row last.
    byId.set(announcement.id, announcement);
  }

  return [...byId.values()].slice(0, MAX_ANNOUNCEMENTS);
}

export function parseStoredAnnouncements(rawValue: string): Announcement[] | null {
  try {
    const parsed = JSON.parse(rawValue);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== ANNOUNCEMENTS_STORAGE_VERSION) return null;
    if (
      !Array.isArray(parsed.announcements) ||
      !parsed.announcements.every(isAnnouncement)
    ) {
      return null;
    }

    return parsed.announcements.slice(0, MAX_ANNOUNCEMENTS);
  } catch {
    return null;
  }
}

export function serializeAnnouncements(announcements: Announcement[]): string {
  return JSON.stringify({
    version: ANNOUNCEMENTS_STORAGE_VERSION,
    announcements: announcements.slice(0, MAX_ANNOUNCEMENTS),
  });
}

/**
 * Restores what is saved, and clears it if it does not read back.
 *
 * Same bargain as the rest of the storage readers: unreadable data is removed
 * rather than left to fail on every load.
 */
export function restoreAnnouncements(storage: Storage): {
  announcements: Announcement[];
  recoveredFromCorruptData: boolean;
} {
  const raw = storage.getItem(ANNOUNCEMENTS_STORAGE_KEY);
  if (!raw) return { announcements: [], recoveredFromCorruptData: false };

  const parsed = parseStoredAnnouncements(raw);
  if (!parsed) {
    storage.removeItem(ANNOUNCEMENTS_STORAGE_KEY);
    return { announcements: [], recoveredFromCorruptData: true };
  }

  return { announcements: parsed, recoveredFromCorruptData: false };
}

export function saveAnnouncements(storage: Storage, announcements: Announcement[]) {
  storage.setItem(ANNOUNCEMENTS_STORAGE_KEY, serializeAnnouncements(announcements));
}

export function clearAnnouncements(storage: Storage) {
  storage.removeItem(ANNOUNCEMENTS_STORAGE_KEY);
}

/**
 * Newest first, with the sort made total.
 *
 * Two announcements collected in the same millisecond are common — one page
 * read stamps them all — so `announced` alone leaves the order up to the sort
 * implementation, and a list that reshuffles between loads reads as a bug. The
 * title and id are the tie-breakers that make it stable.
 */
export function sortAnnouncements(announcements: Announcement[]): Announcement[] {
  return [...announcements].sort((left, right) => {
    if (left.announced !== right.announced) {
      return left.announced < right.announced ? 1 : -1;
    }
    if (left.title !== right.title) return left.title < right.title ? -1 : 1;
    return left.id < right.id ? -1 : 1;
  });
}
