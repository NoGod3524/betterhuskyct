import type { MaterialsIndex, MaterialsStore, StoredFile } from "@/lib/materials";

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

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
    putIndex: async (index) => {
      await promised(store(META, "readwrite").put({ id: INDEX_ID, index }));
    },
    clear: async () => {
      await promised(store(FILES, "readwrite").clear());
      await promised(store(META, "readwrite").clear());
    },
  };
}
