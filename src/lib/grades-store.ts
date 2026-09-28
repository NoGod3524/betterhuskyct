import { parseGradesSnapshot, type GradesStore } from "@/lib/grades";

/**
 * The grades in this browser's localStorage. A term of gradebooks is a few
 * kilobytes, where the course files need IndexedDB. Everything stays here.
 */
const STORAGE_KEY = "huskypilot.grades.v1";

/** Fails (rejects) when the browser blocks storage, so the page can say so. */
export async function openGradesStore(): Promise<GradesStore> {
  const storage = window.localStorage;
  // Blocked storage may only show itself on use.
  storage.getItem(STORAGE_KEY);
  return {
    get: async () => {
      try {
        return parseGradesSnapshot(JSON.parse(storage.getItem(STORAGE_KEY) || "null"));
      } catch {
        return null;
      }
    },
    put: async (snapshot) => {
      storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    },
    clear: async () => {
      storage.removeItem(STORAGE_KEY);
    },
  };
}
