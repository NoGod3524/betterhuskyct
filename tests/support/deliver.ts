import type { Window } from "happy-dom";

import { serialiseSyncPayload, type SyncPayload } from "../../src/lib/sync.ts";
import { TASKS_PROTOCOL } from "../../src/lib/tasks-sync.ts";

/**
 * Hands the app a payload the way the helper does: a `sync` message posted from HuskyCT.
 * Resolves once the app has answered whether it stored it, so a test can read the result at once.
 */
export function deliverSync(window: Window, payload: SyncPayload): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2000);
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: { protocol: TASKS_PROTOCOL, kind: "sync", payload: JSON.parse(serialiseSyncPayload(payload)) },
        origin: "https://lms.uconn.edu",
        source: {
          postMessage: (reply: unknown) => {
            clearTimeout(timer);
            resolve(reply);
          },
        } as never,
      }),
    );
  });
}
