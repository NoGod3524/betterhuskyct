import { useSyncExternalStore } from "react";

const NEVER_CHANGES = () => () => {};
const IN_BROWSER = () => true;
const ON_SERVER = () => false;

/**
 * False while the server renders and true in the browser. A time is in the reader's zone, which
 * the server does not know, so what shows one waits for this: the server leaves it out and the
 * browser puts it in, with no mismatch between the two.
 */
export function useInBrowser(): boolean {
  return useSyncExternalStore(NEVER_CHANGES, IN_BROWSER, ON_SERVER);
}
