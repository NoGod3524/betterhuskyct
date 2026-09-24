/**
 * Keeping "now" moving while the app is open.
 *
 * It used to be read once on load, so an installed app left open overnight kept
 * yesterday's "today", its plan never saw a deadline pass, and the due-soon
 * reminder never fired for a task that entered its window after the page opened
 * — the one case a reminder exists for.
 *
 * This is the subscription itself, taken out of the provider so it can be
 * tested without a DOM: the caller hands in `window` (or anything shaped like
 * it) and gets back the function that undoes every part of it.
 */

/** A minute is fine enough for anything the app shows. */
export const CLOCK_TICK_MS = 60_000;

type Listenable = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

/** The parts of `window` the clock touches. `window` itself satisfies it. */
export type ClockHost = Listenable & {
  setInterval(handler: () => void, timeout: number): number;
  clearInterval(id: number | undefined): void;
  document: Listenable & { visibilityState: string };
};

/**
 * Calls `onTick` every minute, and at once when the page comes back.
 *
 * Phones suspend timers in background tabs, so returning to the tab — focus, or
 * the document becoming visible — ticks immediately rather than waiting up to a
 * minute for the next interval. Returns the cleanup: the interval and both
 * listeners go, so an unmounted provider is not kept ticking.
 */
export function watchClock(onTick: () => void, host: ClockHost): () => void {
  const onVisible = () => {
    if (host.document.visibilityState === "visible") onTick();
  };

  const timer = host.setInterval(onTick, CLOCK_TICK_MS);
  host.document.addEventListener("visibilitychange", onVisible);
  host.addEventListener("focus", onTick);

  return () => {
    host.clearInterval(timer);
    host.document.removeEventListener("visibilitychange", onVisible);
    host.removeEventListener("focus", onTick);
  };
}
