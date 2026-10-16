import { isRecord } from "./is-record.ts";

export const CHANGES_KEY = "huskypilot.changes.v1";
export const CHANGES_CHANGED = "huskypilot:changes-changed";
export const MAX_CHANGES = 500;
export const CHANGES_RETENTION_DAYS = 30;

/** Serialize browser tabs that update this one localStorage value; Node and older browsers stay synchronous. */
export function withChangesLock<T>(work: () => T | Promise<T>): T | Promise<T> {
  const locks = typeof window === "undefined" ? undefined : window.navigator.locks;
  return locks?.request ? locks.request(CHANGES_KEY, work).then<T>((value) => value) : work();
}

export type ChangeKind = "grade" | "announcement-new" | "announcement-edited" | "deadline-moved" | "deadline-added" | "file-new" | "done-by-huskyct";
export type ChangeEntry = {
  id: string;
  at: string;
  kind: ChangeKind;
  courseCode: string | null;
  title: string;
  detail?: { from?: string; to?: string; text?: string };
  ref?: { page: "/grades" | "/announcements" | "/tasks" | "/materials" | "/calendar"; id?: string };
  read: boolean;
};
export type ChangesStore = { version: 1; entries: ChangeEntry[]; baselines: string[] };

const KINDS = new Set<unknown>(["grade", "announcement-new", "announcement-edited", "deadline-moved", "deadline-added", "file-new", "done-by-huskyct"]);
const PAGES = new Set<unknown>(["/grades", "/announcements", "/tasks", "/materials", "/calendar"]);
const MAX_BASELINES = 1000;
const MAX_RAW = 8 * 1024 * 1024;
const empty = (): ChangesStore => ({ version: 1, entries: [], baselines: [] });
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length > 0 && value.length <= limit;

function readEntry(value: unknown): ChangeEntry | null {
  if (!isRecord(value) || !text(value.id, 4096) || !text(value.at, 40) || !KINDS.has(value.kind)) return null;
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.at) || !Number.isFinite(Date.parse(value.at))) return null;
  if (!text(value.title, 400) || !value.title.trim() || typeof value.read !== "boolean") return null;
  if (value.courseCode !== null && !text(value.courseCode, 80)) return null;
  const entry: ChangeEntry = {
    id: value.id, at: new Date(value.at).toISOString(), kind: value.kind as ChangeKind,
    courseCode: value.courseCode, title: value.title, read: value.read,
  };
  if (value.detail !== undefined) {
    if (!isRecord(value.detail)) return null;
    entry.detail = {};
    for (const key of ["from", "to", "text"] as const) {
      const part = value.detail[key];
      if (part !== undefined) {
        if (typeof part !== "string" || part.length > 1200) return null;
        entry.detail[key] = part;
      }
    }
  }
  if (value.ref !== undefined) {
    if (!isRecord(value.ref) || !PAGES.has(value.ref.page)) return null;
    if (value.ref.id !== undefined && !text(value.ref.id, 4096)) return null;
    entry.ref = { page: value.ref.page as NonNullable<ChangeEntry["ref"]>["page"] };
    if (value.ref.id !== undefined) entry.ref.id = value.ref.id;
  }
  // The row cap also bounds JSON escaping; a full 500-row store remains readable by parseChanges.
  return JSON.stringify(entry).length <= 8192 ? entry : null;
}

function combine(entries: readonly unknown[], baselines: readonly unknown[], now?: Date): ChangesStore {
  const byId = new Map<string, ChangeEntry>();
  const cutoff = now ? now.valueOf() - CHANGES_RETENTION_DAYS * 86_400_000 : -Infinity;
  for (const raw of entries) {
    const entry = readEntry(raw);
    if (!entry || Date.parse(entry.at) < cutoff) continue;
    const previous = byId.get(entry.id);
    // A repeated reading cannot change history or resurrect an unread badge.
    byId.set(entry.id, previous ? { ...previous, read: previous.read || entry.read } : entry);
  }
  return {
    version: 1,
    entries: [...byId.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id)).slice(0, MAX_CHANGES),
    baselines: [...new Set(baselines.filter((value): value is string => text(value, 200)))].slice(0, MAX_BASELINES),
  };
}

/** Damaged rows are skipped individually. Unknown versions and oversized stores are ignored. */
export function parseChanges(raw: string | null, now: Date = new Date()): ChangesStore {
  if (!raw || raw.length > MAX_RAW) return empty();
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries) || !Array.isArray(value.baselines)) return empty();
    return combine(value.entries, value.baselines, now);
  } catch { return empty(); }
}

export function restoreChanges(storage: Pick<Storage, "getItem">): ChangesStore {
  try { return parseChanges(storage.getItem(CHANGES_KEY)); } catch { return empty(); }
}

/** Let write failures reach callers: a source must not acknowledge a change that was not saved. */
export function saveChanges(storage: Pick<Storage, "setItem">, store: ChangesStore): void {
  storage.setItem(CHANGES_KEY, JSON.stringify(combine(store.entries, store.baselines)));
}

/** IDs describe a particular source revision and transition; callers supply both in parts. */
export function createChangeId(kind: ChangeKind, ...parts: string[]): string {
  return `${kind}:${JSON.stringify(parts)}`;
}

export function recordChanges(current: ChangesStore, entries: readonly ChangeEntry[], now: Date, baselines: readonly string[] = []): ChangesStore {
  return combine([...current.entries, ...entries], [...current.baselines, ...baselines], now);
}

/** An empty ID list marks nothing; omitting it marks everything currently shown. */
export function markChangesRead(current: ChangesStore, ids?: readonly string[]): ChangesStore {
  const selected = ids === undefined ? null : new Set(ids);
  return { ...current, entries: current.entries.map((entry) => selected === null || selected.has(entry.id) ? { ...entry, read: true } : entry) };
}

/** Shared by backup restore: a read decision on either device wins. */
export function mergeChangeStores(local: ChangesStore, incoming: ChangesStore, now: Date): ChangesStore {
  return recordChanges(local, incoming.entries, now, incoming.baselines);
}
