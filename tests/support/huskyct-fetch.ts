/**
 * HuskyCT's data as a page there gets it: answered only at HuskyCT's own address. Its pages carry a
 * `<base>` pointing at Blackboard's file store, so a bare path goes there, and the store answers
 * every path with an S3 AccessDenied (measured on 2026-10-06). A stand-in that answered bare paths
 * would hide exactly that mistake, so this one answers them the same way, and hands `serve` the
 * path of anything asked at HuskyCT itself.
 */
export function atHuskyct<Rest extends unknown[]>(serve: (path: string, ...rest: Rest) => Promise<Response>) {
  return (url: string, ...rest: Rest): Promise<Response> => {
    const match = /^https:\/\/(?:lms|huskyct)\.uconn\.edu(\/.*)$/.exec(String(url));
    if (!match) return Promise.resolve(new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }));
    return serve(match[1], ...rest);
  };
}

/**
 * Puts the stand-in in front of the window's fetch for good: whatever a test assigns to
 * `window.fetch`, before or after the helper is loaded, is reached only through it.
 */
export function onlyAtHuskyct(window: object) {
  type Serve = (path: string, ...rest: unknown[]) => Promise<Response>;
  let serve = (window as { fetch?: unknown }).fetch as Serve | undefined;
  Object.defineProperty(window, "fetch", {
    configurable: true,
    get: () => (serve ? atHuskyct(serve) : undefined),
    set: (value: Serve) => {
      serve = value;
    },
  });
}
