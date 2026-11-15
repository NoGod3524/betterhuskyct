"use client";

import { useEffect, useState } from "react";

import {
  buildCustomEvent,
  MAX_CUSTOM_EVENTS,
  editCustomEvent as applyCustomEventEdit,
  isCustomEventId,
  removeCustomEvent as dropCustomEvent,
  restoreCustomEvents,
  saveCustomEvents,
  type CustomEvent as CustomCalendarEvent,
  type CustomEventInput,
} from "@/lib/custom-events";
import {
  deleteEvent as deleteOverlayEvent,
  EMPTY_OVERLAY,
  EVENT_OVERLAY_STORAGE_KEY,
  noteFor as overlayNoteFor,
  restoreEvent as restoreOverlayEvent,
  restoreEventOverlay,
  saveEventOverlay,
  setEventEdit,
  type EventEdit,
  type EventOverlay,
} from "@/lib/event-overlay";
import { t, type Locale } from "@/lib/i18n";
import { dismissNotice, restoreMoveLog, saveMoveLog, type MoveLog } from "@/lib/moved-deadlines";
import { writeStorageBatch, type StorageWriter } from "@/lib/storage-batch";

/**
 * What the student changed on the calendar by hand: corrections to imported events, events of
 * their own, and the notices about deadlines the teacher moved. See `event-overlay.ts` and
 * `custom-events.ts` for why a correction and an own event are kept apart.
 */
export function useEventEdits(
  locale: Locale,
  save: (write: () => void) => boolean,
  setError: (message: string | null) => void,
) {
  const [eventOverlay, setEventOverlay] = useState<EventOverlay>(EMPTY_OVERLAY);
  const [customEvents, setCustomEvents] = useState<CustomCalendarEvent[]>([]);
  const [moveLog, setMoveLog] = useState<MoveLog>({});

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setEventOverlay(restoreEventOverlay(window.localStorage));
        setMoveLog(restoreMoveLog(window.localStorage));
        setCustomEvents(restoreCustomEvents(window.localStorage));
      } catch {
        // Blocked storage: nothing edited, and the provider says storage failed.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function readOverlay(event: StorageEvent) {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (event.key !== null && event.key !== EVENT_OVERLAY_STORAGE_KEY) return;
      setEventOverlay(restoreEventOverlay(window.localStorage));
    }
    window.addEventListener("storage", readOverlay);
    return () => window.removeEventListener("storage", readOverlay);
  }, []);

  function commitOverlay(next: EventOverlay) {
    if (!save(() => saveEventOverlay(window.localStorage, next))) throw new Error(t(locale, "errors.saveFailed"));
    setEventOverlay(next);
  }

  function commitCustomEvents(next: CustomCalendarEvent[], saveRelated?: (staged: StorageWriter) => void) {
    if (next.length > MAX_CUSTOM_EVENTS) {
      const message = t(locale, "events.full", { max: MAX_CUSTOM_EVENTS });
      setError(message);
      throw new Error(message);
    }
    if (!save(() => writeStorageBatch(window.localStorage, (staged) => {
      saveCustomEvents(staged, next);
      saveRelated?.(staged);
    }))) throw new Error(t(locale, "errors.saveFailed"));
    setCustomEvents(next);
  }

  /**
   * One form for both kinds of event: an own one is edited in place, since the student owns the
   * whole record; a correction to an imported one goes into the overlay instead, so the next
   * collection still finds it. `taskId` decides which by its own namespace.
   */
  function editEvent(taskId: string, edit: EventEdit) {
    if (isCustomEventId(taskId)) commitCustomEvents(applyCustomEventEdit(restoreCustomEvents(window.localStorage), taskId, edit));
    else commitOverlay(setEventEdit(restoreEventOverlay(window.localStorage), taskId, edit));
  }

  function deleteEvent(taskId: string) {
    if (isCustomEventId(taskId)) commitCustomEvents(dropCustomEvent(restoreCustomEvents(window.localStorage), taskId));
    else commitOverlay(deleteOverlayEvent(restoreEventOverlay(window.localStorage), taskId));
  }

  /** Back to exactly what HuskyCT sent. Meaningless for an own event: there is no original. */
  function restoreEvent(taskId: string) {
    if (!isCustomEventId(taskId)) commitOverlay(restoreOverlayEvent(restoreEventOverlay(window.localStorage), taskId));
  }

  function addCustomEvents(inputs: CustomEventInput[], saveRelated?: (staged: StorageWriter) => void) {
    if (inputs.length === 0 && !saveRelated) return;
    const events = new Map(restoreCustomEvents(window.localStorage).map((event) => [event.id, event]));
    for (const input of inputs) {
      const event = buildCustomEvent(input);
      if (!events.has(event.id)) events.set(event.id, event);
    }
    commitCustomEvents([...events.values()], saveRelated);
  }

  function addCustomEvent(input: CustomEventInput): string {
    const event = buildCustomEvent(input);
    addCustomEvents([{ ...input, id: event.id }]);
    return event.id;
  }

  function dismissMoveNotice(taskId: string) {
    const next = dismissNotice(restoreMoveLog(window.localStorage), taskId);
    if (save(() => saveMoveLog(window.localStorage, next))) setMoveLog(next);
  }

  return {
    eventOverlay,
    setEventOverlay,
    customEvents,
    moveLog,
    setMoveLog,
    editEvent,
    deleteEvent,
    restoreEvent,
    restoreAllEvents: () => commitOverlay(EMPTY_OVERLAY),
    eventNoteFor: (taskId: string): string | null =>
      isCustomEventId(taskId) ? (customEvents.find((event) => event.id === taskId)?.note ?? null) : overlayNoteFor(eventOverlay, taskId),
    isEventEdited: (taskId: string) => Boolean(eventOverlay.edits[taskId]) || eventOverlay.deletedIds.includes(taskId),
    addCustomEvent,
    addCustomEvents,
    dismissMoveNotice,
  };
}
