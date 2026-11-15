"use client";

import { useEffect, useRef, useState } from "react";

import type { CalendarTask } from "@/lib/calendar-types";
import { t, type Locale } from "@/lib/i18n";
import { reminderSignature, restoreReminderState, saveReminderState, shouldNotify, type ReminderState } from "@/lib/reminders";

type Say = { setError: (message: string | null) => void; setNotice: (message: string | null) => void };

/**
 * The page's own nudge about work due soon: whether it is on, and what it last nudged about.
 *
 * It nudges at most once per set of due tasks, and only while the app is open: without a push
 * server a web page cannot wake itself up in the background. The extension's notifications are
 * its own, and arrive with the page closed.
 */
export function useReminders(locale: Locale, dueSoon: CalendarTask[], { setError, setNotice }: Say) {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  // What was already nudged about is bookkeeping for storage, not rendered state.
  const log = useRef<{ lastSignature: string | null; lastNotifiedAt: string | null }>({ lastSignature: null, lastNotifiedAt: null });

  // Read after the first render, as the rest of what this browser remembers is.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const restored = restoreReminderState(window.localStorage);
        log.current = { lastSignature: restored.lastSignature, lastNotifiedAt: restored.lastNotifiedAt };
        setEnabled(restored.enabled);
      } catch {
        // Blocked storage: reminders stay off, and the provider says storage failed.
      }
      setPermission("Notification" in window ? Notification.permission : "unsupported");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function save(next: boolean) {
    setEnabled(next);
    saveReminderState(window.localStorage, { enabled: next, ...log.current });
  }

  async function toggleReminders() {
    if (enabled) {
      save(false);
      return;
    }
    if (!("Notification" in window)) {
      setError(t(locale, "reminders.unsupported"));
      return;
    }
    let answer = Notification.permission;
    if (answer === "default") answer = await Notification.requestPermission();
    setPermission(answer);
    if (answer !== "granted") {
      setError(t(locale, "reminders.denied"));
      return;
    }
    save(true);
    setError(null);
    setNotice(t(locale, "reminders.enabledNotice"));
  }

  useEffect(() => {
    if (!enabled || permission !== "granted" || dueSoon.length === 0) return;

    const signature = reminderSignature(dueSoon);
    const current: ReminderState = { enabled: true, ...log.current };
    if (!shouldNotify(current, signature, new Date())) return;

    const title = t(locale, "reminders.notificationTitle");
    const options = {
      body: t(locale, "reminders.notificationBody", { count: dueSoon.length }),
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "huskypilot-due",
    };
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.ready
        .then((registration) => registration.showNotification(title, options))
        .catch(() => undefined);
    } else {
      new Notification(title, options);
    }

    log.current = { lastSignature: signature, lastNotifiedAt: new Date().toISOString() };
    saveReminderState(window.localStorage, { enabled: true, ...log.current });
  }, [enabled, permission, dueSoon, locale]);

  return { remindersEnabled: enabled, toggleReminders };
}
