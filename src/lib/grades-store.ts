import { markChangesSeen, mergeGrades, parseStoredGrades, type GradesSnapshot, type GradesStore } from "@/lib/grades";
import { historyForSource } from "./background-sync.ts";
import { recordGradeChanges } from "./change-producers.ts";
import { CHANGES_CHANGED, CHANGES_KEY, mergeChangeStores, parseChanges, saveChanges, withChangesLock, type ChangesStore } from "./changes.ts";
import { writeStorageBatch } from "./storage-batch.ts";

/**
 * The grades in this browser's localStorage. A term of gradebooks is a few
 * kilobytes, where the course files need IndexedDB. Everything stays here.
 */
export const GRADES_STORAGE_KEY = "huskypilot.grades.v1";
const STORAGE_KEY = GRADES_STORAGE_KEY;

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
  const read = () => {
    const raw = storage.getItem(STORAGE_KEY);
    try {
      return parseStoredGrades(JSON.parse(raw || "null"));
    } catch {
      return null;
    }
  };
  const write = (snapshot: GradesSnapshot, changes?: ChangesStore) => {
    writeStorageBatch(storage, (staged) => {
      staged.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      if (changes) saveChanges(staged, changes);
    });
    window.dispatchEvent(new window.Event(GRADES_CHANGED));
    if (changes) window.dispatchEvent(new window.Event(CHANGES_CHANGED));
  };
  const put = (snapshot: GradesSnapshot, before = read()) => {
    write(snapshot, recordGradeChanges(parseChanges(storage.getItem(CHANGES_KEY)), before, snapshot, new Date()));
  };
  return {
    get: async () => read(),
    put: async (snapshot) => withChangesLock(() => put(snapshot)),
    receive: async (incoming) => withChangesLock(() => {
      const before = read();
      put(mergeGrades(before, incoming), before);
    }),
    receiveBackground: async (incoming, history, report) => withChangesLock(() => {
      const before = read();
      const courses = new Map((before?.courses ?? []).map(course => [course.id, course]));
      const older = before && Date.parse(before.takenAt) > Date.parse(incoming.takenAt);
      const accepted = incoming.courses.filter(course => !courses.has(course.id)
        || (!older && (!report || report.courses.some(status => status.id === course.id && status.grades))));
      const snapshot = { ...mergeGrades(before, { ...incoming, courses: accepted }), takenAt: older ? before.takenAt : incoming.takenAt };
      write(snapshot, mergeChangeStores(parseChanges(storage.getItem(CHANGES_KEY)), historyForSource(history, "grades"), new Date()));
    }),
    markSeen: async () => withChangesLock(() => {
      const latest = read();
      if (latest) write(markChangesSeen(latest));
    }),
    clear: async () => withChangesLock(() => {
      const changes = parseChanges(storage.getItem(CHANGES_KEY));
      writeStorageBatch(storage, (staged) => {
        staged.removeItem(STORAGE_KEY);
        saveChanges(staged, { ...changes,
          entries: changes.entries.filter((entry) => entry.kind !== "grade" && !(entry.kind === "done-by-huskyct" && !entry.ref?.id)),
          baselines: changes.baselines.filter((scope) => !scope.startsWith("grades:")),
        });
      });
      window.dispatchEvent(new window.Event(GRADES_CHANGED));
      window.dispatchEvent(new window.Event(CHANGES_CHANGED));
    }),
  };
}
