import type { GradesSnapshot, GradesStore } from "../../src/lib/grades.ts";
import type { MaterialsIndex, MaterialsStore, StoredFile } from "../../src/lib/materials.ts";

/** The app's stores, kept in memory, for tests: IndexedDB in the page. */
export function memoryGradesStore(): GradesStore {
  let snapshot: GradesSnapshot | null = null;
  return {
    get: async () => snapshot,
    put: async (next) => {
      snapshot = next;
    },
    clear: async () => {
      snapshot = null;
    },
  };
}

export function memoryMaterialsStore(): MaterialsStore {
  const files = new Map<string, StoredFile>();
  let index: MaterialsIndex | null = null;
  return {
    keys: async () => [...files.keys()],
    files: async () => [...files.values()],
    getFile: async (key) => files.get(key) ?? null,
    putFile: async (file) => {
      files.set(file.key, file);
    },
    deleteFile: async (key) => {
      files.delete(key);
    },
    getIndex: async () => index,
    putIndex: async (next) => {
      index = next;
    },
    clear: async () => {
      files.clear();
      index = null;
    },
  };
}
