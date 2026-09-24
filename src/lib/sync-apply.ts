import { mergeSyncPayload, type LocalState, type MergedState } from "./sync-merge.ts";
import type { SyncPayload } from "./sync.ts";

/**
 * What accepting a sync link does to this device — decided here, written by the
 * caller.
 *
 * `mergeSyncPayload` decides what the merged data is. This decides which local
 * data goes *into* it and what the screen shows afterwards, which is where the
 * demo went wrong: while the demo is on screen, the ticks in memory are the
 * demo's, and merging those wrote demo ids into the real saved set.
 */
export type SyncApplyInput = Omit<LocalState, "completedIds"> & {
  /** True when imported calendars, not the demo, are what the screen shows. */
  showingImported: boolean;
  /** The ticks in memory — the demo's while the demo is showing. */
  ticksOnScreen: Set<string>;
  /** The real ticks as saved, whichever view is showing. */
  savedTicks: Set<string>;
};

export type SyncApplyPlan = {
  merged: MergedState;
  /** Always the real set: this is what gets saved as the imported ticks. */
  ticksToSave: Set<string>;
  /**
   * What the screen's ticks become, or `null` to leave them as they are.
   *
   * Only a link that leaves a real calendar to show switches the view; one
   * with no calendars leaves the demo, and the demo's ticks, alone.
   */
  ticksOnScreen: Set<string> | null;
  /** Whether the imported calendars should replace the demo on screen. */
  showImported: boolean;
};

export function planSyncApply(input: SyncApplyInput, payload: SyncPayload): SyncApplyPlan {
  const { showingImported, ticksOnScreen, savedTicks, ...local } = input;

  const merged = mergeSyncPayload(
    { ...local, completedIds: showingImported ? ticksOnScreen : savedTicks },
    payload,
  );
  const showImported = merged.subscriptions.length > 0;

  return {
    merged,
    ticksToSave: merged.completedIds,
    ticksOnScreen: showImported ? merged.completedIds : null,
    showImported,
  };
}
