import type { Announcement } from "./announcements.ts";
import type { Subscription } from "./subscriptions.ts";
import type { ReadReport } from "./sync-status.ts";
import { eventUid, mergeSyncPayload, type LocalState, type MergedState } from "./sync-merge.ts";
import type { SyncPayload } from "./sync.ts";

/**
 * What a sync does to this device — decided here, written by the
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

/**
 * A background run's payload, less what this device has already read more recently.
 *
 * A cached run can arrive after a newer manual sync, or after an older lease expires. A successful
 * source may still send retained rows, so only a task's own reading time can establish freshness:
 * an older helper that sends none may add tasks but not replace them. An announcement replaces the
 * one here only when its course was read this time and the reading is no older.
 */
export function withoutStaleRows(
  payload: SyncPayload,
  saved: { subscriptions: Subscription[]; announcements: Announcement[] },
  report?: ReadReport,
): SyncPayload {
  const latest = new Map(saved.subscriptions.flatMap((subscription) => subscription.events.map((task) => [eventUid(task), { task, at: subscription.importedAt }] as const)));
  const staleIds = new Set<string>();
  const feeds = payload.feeds.map((feed) => ({ ...feed, events: feed.events.filter((task) => {
    const kept = latest.get(eventUid(task));
    const stale = kept && (!task.observedAt || (report && !report.dueDates && !report.todo)
      || Date.parse(kept.task.observedAt ?? kept.at) > Date.parse(task.observedAt));
    if (stale) staleIds.add(task.id);
    return !stale;
  }) })).filter((feed) => feed.events.length > 0);
  const announcements = payload.announcements.filter((item) => {
    const kept = saved.announcements.find((entry) => entry.id === item.id);
    const read = !report || report.courses.some((course) => course.announcements && (item.sourceCourseId ? course.id === item.sourceCourseId : course.code === item.courseCode));
    return !kept || (read && Date.parse(kept.announced) <= Date.parse(item.announced));
  });
  const doneByHuskyct = Object.fromEntries(Object.entries(payload.doneByHuskyct).filter(([id]) => !staleIds.has(id)));
  return { ...payload, feeds, announcements, doneByHuskyct };
}
