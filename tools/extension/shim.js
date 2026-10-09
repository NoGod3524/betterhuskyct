// Runs in the page's world just before the helper, and gives it the four userscript-manager
// functions it asks for. Reads are answered from a copy taken at load, so they stay
// synchronous; writes go through relay.js to chrome.storage, and a change made in another tab
// comes back the same way.
(() => {
  const PROTOCOL = "betterhuskyct/ext@1";
  const cache = new Map(Object.entries(globalThis.__bhcExtBoot || {}));
  delete globalThis.__bhcExtBoot;
  const listeners = new Map();
  const origin = window.location.origin;
  const post = (message) => window.postMessage(Object.assign({ protocol: PROTOCOL, from: "page" }, message), origin);
  const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  let counter = 0;

  globalThis.GM_getValue = (key, fallback) => (cache.has(key) ? copy(cache.get(key)) : fallback);

  globalThis.GM_setValue = (key, value) => {
    cache.set(key, copy(value));
    post({ kind: "set", key, value: copy(value) });
  };

  globalThis.GM_addValueChangeListener = (key, run) => {
    if (!listeners.has(key)) listeners.set(key, []);
    listeners.get(key).push(run);
    return key + ":" + listeners.get(key).length;
  };

  globalThis.GM_openInTab = (url, options) => {
    counter += 1;
    const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + "-" + counter;
    const opts = options && typeof options === "object" ? { active: options.active } : {};
    post({ kind: "open", id, url, options: opts });
    return { close: () => post({ kind: "close", id }) };
  };

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.protocol !== PROTOCOL || data.from !== "ext" || data.kind !== "changed") return;
    const before = cache.has(data.key) ? cache.get(data.key) : undefined;
    // This tab's own write comes back as well, and is not news.
    if (JSON.stringify(before) === JSON.stringify(data.value === null ? undefined : data.value)) return;
    cache.set(data.key, copy(data.value));
    for (const run of listeners.get(data.key) || []) run(data.key, copy(before), copy(data.value), true);
  });
})();
