import { CHANGES_KEY, createChangeId, parseChanges, recordChanges, saveChanges, withChangesLock, type ChangeEntry } from "./changes.ts";
import { isRecord } from "./is-record.ts";
import { isMaterialKey, materialsCourseKey, type MaterialsIndex } from "./materials.ts";

/** Saved with the directory in the same IndexedDB transaction, before notifying the app. */
export type MaterialsChangeOutbox = { seen: Record<string, string[]>; pending: ChangeEntry[] };

export function recordMaterialChanges(previous: MaterialsIndex | null, incoming: MaterialsIndex, raw: unknown, now: Date): MaterialsChangeOutbox {
  const seen: Record<string, string[]> = {};
  if (isRecord(raw) && isRecord(raw.seen)) {
    for (const [key, files] of Object.entries(raw.seen)) {
      if ((key.startsWith("id:") || key.startsWith("code:")) && Array.isArray(files)) seen[key] = files.filter(isMaterialKey);
    }
  }
  // Existing installations already have a baseline, even before the Changes page exists.
  for (const course of previous?.courses ?? []) {
    const key = materialsCourseKey(course);
    seen[key] = [...new Set([...(seen[key] ?? []), ...course.files.map((file) => file.key)])];
  }
  const added: ChangeEntry[] = [];
  for (const course of incoming.courses) {
    const key = materialsCourseKey(course);
    const known = seen[key] === undefined ? null : new Set(seen[key]);
    for (const file of course.files) {
      if (known && !known.has(file.key)) {
        added.push({
          id: createChangeId("file-new", key, file.key), at: now.toISOString(), kind: "file-new",
          courseCode: course.code, title: file.title, ref: { page: "/materials", id: file.key }, read: false,
        });
        known.add(file.key);
      }
    }
    seen[key] = known ? [...known] : [...new Set(course.files.map((file) => file.key))];
  }
  const current = parseChanges(JSON.stringify({ version: 1, entries: isRecord(raw) && Array.isArray(raw.pending) ? raw.pending : [], baselines: [] }), now);
  return { seen, pending: recordChanges(current, added, now).entries };
}

/** A failed delivery leaves its outbox intact; replay after a crash keeps read decisions. */
export async function flushMaterialChanges(
  storage: Pick<Storage, "getItem" | "setItem">,
  pending: readonly ChangeEntry[] | (() => Promise<readonly ChangeEntry[]>),
  acknowledge: (ids: readonly string[]) => Promise<void>,
  notify: () => void,
  now = new Date(),
): Promise<void> {
  let delivered: readonly string[] = [];
  await withChangesLock(async () => {
    // Read the outbox after acquiring the lock: another tab may have cleared materials while waiting.
    const entries = typeof pending === "function" ? await pending() : pending;
    if (entries.length === 0) return;
    const current = parseChanges(storage.getItem(CHANGES_KEY), now);
    saveChanges(storage, recordChanges(current, entries, now));
    delivered = entries.map((entry) => entry.id);
    notify();
  });
  if (delivered.length > 0) await acknowledge(delivered);
}
