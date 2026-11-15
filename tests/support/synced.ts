import type { Window } from "happy-dom";

import { saveSubscriptions } from "../../src/lib/subscriptions.ts";

/**
 * Makes this browser one that has synced: one saved feed with one deadline. Until then the app
 * shows its demo, and the Courses pages show examples in place of an empty page.
 */
export function markSynced(window: Window): void {
  saveSubscriptions(window.localStorage as unknown as Storage, [
    {
      id: "synced",
      name: "HuskyCT to-do",
      courseId: null,
      importedAt: "2026-09-16T11:00:00.000Z",
      events: [
        {
          id: "a:2026-09-18T23:59:00.000Z",
          title: "Section 4.1 Homework",
          course: "MATH 1070Q",
          start: "2026-09-18T23:59:00.000Z",
          dateKey: null,
          end: null,
          allDay: false,
          location: null,
          kind: "assignment",
        },
      ],
    },
  ]);
}
