const PREFIX = "gm:";
const HUSKYCT = "https://lms.uconn.edu/";

/** The helper's storage as it is now, without the prefix, for the page to start from. */
async function snapshot() {
  const all = await chrome.storage.local.get(null);
  const boot = {};
  for (const name of Object.keys(all)) if (name.startsWith(PREFIX)) boot[name.slice(PREFIX.length)] = all[name];
  return boot;
}

async function inject(tabId) {
  const target = { tabId, frameIds: [0] };
  const boot = await snapshot();
  await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    func: (value) => {
      globalThis.__bhcExtBoot = value;
    },
    args: [boot],
  });
  await chrome.scripting.executeScript({ target, world: "MAIN", files: ["shim.js", "huskyct-helper.js"] });
}

// Tabs this extension opened for a sync, which are the only ones it will close again.
async function opened() {
  return (await chrome.storage.session.get("opened")).opened || {};
}

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab && sender.tab.id;
  if (typeof tabId !== "number" || !message) return;
  if (message.kind === "ready") {
    inject(tabId).catch(() => {});
  } else if (message.kind === "open" && typeof message.url === "string" && message.url.startsWith(HUSKYCT) && typeof message.id === "string") {
    const active = !message.options || message.options.active !== false;
    chrome.tabs
      .create({ url: message.url, active, openerTabId: tabId })
      .then(async (tab) => {
        const map = await opened();
        map[message.id] = tab.id;
        await chrome.storage.session.set({ opened: map });
      })
      .catch(() => {});
  } else if (message.kind === "close" && typeof message.id === "string") {
    opened()
      .then(async (map) => {
        const id = map[message.id];
        if (typeof id !== "number") return;
        delete map[message.id];
        await chrome.storage.session.set({ opened: map });
        await chrome.tabs.remove(id);
      })
      .catch(() => {});
  }
});
