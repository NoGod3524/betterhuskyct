export const CALENDAR_SOURCE_STORAGE_KEY = "huskypilot.calendarSource.v1";
const SOURCE_STORAGE_VERSION = 1;
const MAX_URL_LENGTH = 2_048;

/**
 * An opt-in record of the calendar feed URL, kept in this browser only so the
 * dashboard can refresh itself on open.
 *
 * This is the one place BetterHuskyCT knowingly stores a private feed URL, so it
 * is off by default and the UI must explain what turning it on means. The URL
 * is still never sent anywhere except the app's own import endpoint.
 */
export type RememberedSource = {
  url: string;
  savedAt: string;
};

type StoredSourcePayload = RememberedSource & { version: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidSavedAt(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** Mirrors the checks the import endpoint applies, so a stored value is usable. */
export function isUsableSourceUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return false;

  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function parseStoredSource(rawValue: string): RememberedSource | null {
  try {
    const parsed = JSON.parse(rawValue);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== SOURCE_STORAGE_VERSION) return null;
    if (!isUsableSourceUrl(parsed.url)) return null;
    if (!isValidSavedAt(parsed.savedAt)) return null;

    return { url: parsed.url.trim(), savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function restoreRememberedSource(storage: Storage): RememberedSource | null {
  const raw = storage.getItem(CALENDAR_SOURCE_STORAGE_KEY);
  if (!raw) return null;

  const parsed = parseStoredSource(raw);
  if (!parsed) {
    storage.removeItem(CALENDAR_SOURCE_STORAGE_KEY);
    return null;
  }

  return parsed;
}

/** Stores the feed URL. Returns false (and stores nothing) for an unusable URL. */
export function saveRememberedSource(
  storage: Storage,
  url: string,
  now: Date = new Date(),
): boolean {
  if (!isUsableSourceUrl(url)) return false;

  const payload: StoredSourcePayload = {
    version: SOURCE_STORAGE_VERSION,
    url: url.trim(),
    savedAt: now.toISOString(),
  };
  storage.setItem(CALENDAR_SOURCE_STORAGE_KEY, JSON.stringify(payload));

  return true;
}

export function clearRememberedSource(storage: Storage) {
  storage.removeItem(CALENDAR_SOURCE_STORAGE_KEY);
}
