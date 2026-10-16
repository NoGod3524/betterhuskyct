import { mergeMaterialsIndex, type MaterialsIndex, type MaterialsStore, type StoredFile } from "@/lib/materials";
import { CHANGES_CHANGED, CHANGES_KEY, parseChanges, saveChanges, withChangesLock } from "@/lib/changes";
import { flushMaterialChanges, recordMaterialChanges, type MaterialsChangeOutbox } from "@/lib/materials-changes";

/**
 * The materials store in IndexedDB, which holds files as Blobs and can hold a
 * term's worth — hundreds of megabytes — where localStorage holds a few.
 * Everything stays in this browser.
 */
const DB_NAME = "betterhuskyct-materials";
const DB_VERSION = 1;
const FILES = "files";
const META = "meta";
const INDEX_ID = "index";
const CHANGES_ID = "changes";
type ChangesRow = MaterialsChangeOutbox & { id: typeof CHANGES_ID };

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("Materials could not be saved."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: "key" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

export async function openMaterialsStore(): Promise<MaterialsStore> {
  const db = await openDatabase();
  const store = (name: string, mode: IDBTransactionMode) => db.transaction(name, mode).objectStore(name);
  let flushQueue = Promise.resolve();

  const acknowledge = async (ids: readonly string[]) => {
    const transaction = db.transaction(META, "readwrite");
    const meta = transaction.objectStore(META);
    const saved = committed(transaction);
    const update = promised(meta.get(CHANGES_ID)).then((row: ChangesRow | undefined) => {
      if (row) {
        const delivered = new Set(ids);
        meta.put({ ...row, pending: row.pending.filter((entry) => !delivered.has(entry.id)) });
      }
    });
    await Promise.all([update, saved]);
  };

  const flushChanges = (): Promise<void> => {
    const work = flushQueue.then(async () => {
      const pending = async () => {
        const row = await promised(store(META, "readonly").get(CHANGES_ID)) as ChangesRow | undefined;
        return parseChanges(JSON.stringify({ version: 1, entries: row?.pending ?? [], baselines: [] })).entries;
      };
      await flushMaterialChanges(window.localStorage, pending, acknowledge, () => {
        window.dispatchEvent(new window.Event(CHANGES_CHANGED));
      });
    });
    // A full localStorage does not block the index or the helper's transfer acknowledgements.
    flushQueue = work.catch(() => undefined);
    return work;
  };

  const writeIndex = async (incoming: MaterialsIndex, replace?: boolean) => {
    const transaction = db.transaction(META, "readwrite");
    const meta = transaction.objectStore(META);
    const saved = committed(transaction);
    const update = Promise.all([promised(meta.get(INDEX_ID)), promised(meta.get(CHANGES_ID))])
      .then(([row, outbox]: [{ index?: MaterialsIndex } | undefined, unknown]) => {
        const previous = row?.index ?? null;
        const index = replace === undefined ? incoming : mergeMaterialsIndex(previous, incoming, replace);
        const changes = recordMaterialChanges(previous, index, outbox, new Date());
        meta.put({ id: INDEX_ID, index });
        meta.put({ id: CHANGES_ID, ...changes });
      })
      .catch((error: unknown) => {
        try { transaction.abort(); } catch { /* the transaction already aborted */ }
        throw error;
      });
    // Request success alone does not guarantee that the index and its outbox committed.
    await Promise.all([update, saved]);
    void flushChanges().catch(() => undefined);
  };

  return {
    keys: async () => (await promised(store(FILES, "readonly").getAllKeys())).map(String),
    files: async () => (await promised(store(FILES, "readonly").getAll())) as StoredFile[],
    getFile: async (key) => ((await promised(store(FILES, "readonly").get(key))) as StoredFile | undefined) ?? null,
    putFile: async (file) => {
      await promised(store(FILES, "readwrite").put(file));
    },
    deleteFile: async (key) => {
      await promised(store(FILES, "readwrite").delete(key));
    },
    getIndex: async () => {
      const row = (await promised(store(META, "readonly").get(INDEX_ID))) as { index?: MaterialsIndex } | undefined;
      return row?.index ?? null;
    },
    putIndex: (index) => writeIndex(index),
    mergeIndex: (index, replace = true) => writeIndex(index, replace),
    flushChanges,
    clear: async () => {
      await withChangesLock(async () => {
        const storage = window.localStorage;
        const previous = storage.getItem(CHANGES_KEY);
        const changes = parseChanges(previous);
        // If the log cannot be updated, keep the directory and recoverable outbox as they were.
        saveChanges(storage, { ...changes, entries: changes.entries.filter((entry) => entry.kind !== "file-new") });
        try {
          const transaction = db.transaction([FILES, META], "readwrite");
          const saved = committed(transaction);
          transaction.objectStore(FILES).clear();
          transaction.objectStore(META).clear();
          await saved;
        } catch (error) {
          if (previous === null) storage.removeItem(CHANGES_KEY);
          else storage.setItem(CHANGES_KEY, previous);
          throw error;
        }
        window.dispatchEvent(new window.Event(CHANGES_CHANGED));
      });
    },
  };
}
