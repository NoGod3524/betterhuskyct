export type StorageWriter = Pick<Storage, "setItem" | "removeItem">;
type StorageAccess = StorageWriter & Pick<Storage, "getItem">;

/** Stage related values, then save them together. A failed write restores the keys already changed. */
export function writeStorageBatch(storage: StorageAccess, write: (staged: StorageWriter) => void): void {
  const changes = new Map<string, string | null>();
  write({
    setItem: (key, value) => { changes.set(key, value); },
    removeItem: (key) => { changes.set(key, null); },
  });
  const before = new Map([...changes.keys()].map((key) => [key, storage.getItem(key)]));
  const written: string[] = [];
  try {
    for (const [key, value] of changes) {
      if (value === before.get(key)) continue;
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
      written.push(key);
    }
  } catch (error) {
    // Free the new values first: they may otherwise prevent restoring an earlier, larger value.
    for (const key of written) {
      try { storage.removeItem(key); } catch { /* storage may have become unavailable */ }
    }
    for (const key of written) {
      const value = before.get(key)!;
      if (value !== null) {
        try { storage.setItem(key, value); } catch { /* the browser still refuses storage */ }
      }
    }
    throw error;
  }
}
