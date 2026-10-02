import { parseStoredGrades, type GradesStore } from "@/lib/grades";

/**
 * The grades in this browser's localStorage. A term of gradebooks is a few
 * kilobytes, where the course files need IndexedDB. Everything stays here.
 */
const STORAGE_KEY = "huskypilot.grades.v1";

/**
 * Fired on the window when the grades are written or cleared, so the parts of the
 * app that depend on them (which deadlines are done) read them again. The `storage`
 * event covers other tabs; it never fires in the tab that wrote.
 */
export const GRADES_CHANGED = "huskypilot:grades-changed";

/** Fails (rejects) when the browser blocks storage, so the page can say so. */
export async function openGradesStore(): Promise<GradesStore> {
  const storage = window.localStorage;
  // Blocked storage may only show itself on use.
  storage.getItem(STORAGE_KEY);
  return {
    get: async () => {
      try {
        return parseStoredGrades(JSON.parse(storage.getItem(STORAGE_KEY) || "null"));
      } catch {
        return null;
      }
    },
    put: async (snapshot) => {
      storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      window.dispatchEvent(new window.Event(GRADES_CHANGED));
    },
    clear: async () => {
      storage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new window.Event(GRADES_CHANGED));
    },
  };
}
