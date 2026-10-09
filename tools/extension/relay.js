// Runs in the extension's own world. The helper itself runs in the page's world, where HuskyCT
// lets it do what HuskyCT's own code does, and cannot reach chrome.* from there. This file is
// the way through: it carries the helper's storage to chrome.storage and its tab requests to
// the background, and tells the helper when another tab changed something.
const PROTOCOL = "betterhuskyct/ext@1";
const PREFIX = "gm:";

function send(message) {
  try {
    void chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    // The extension was updated or removed while this page stayed open.
  }
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (event.source !== window || !data || data.protocol !== PROTOCOL || data.from !== "page") return;
  try {
    if (data.kind === "set" && typeof data.key === "string") {
      void chrome.storage.local.set({ [PREFIX + data.key]: data.value }).catch(() => {});
    } else if (data.kind === "open" || data.kind === "close") {
      send({ kind: data.kind, id: data.id, url: data.url, options: data.options });
    }
  } catch {
    // Same as above.
  }
});

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const name of Object.keys(changes)) {
      if (!name.startsWith(PREFIX)) continue;
      const value = changes[name].newValue;
      window.postMessage(
        { protocol: PROTOCOL, from: "ext", kind: "changed", key: name.slice(PREFIX.length), value: value === undefined ? null : value },
        window.location.origin,
      );
    }
  });
} catch {
  // As above.
}

// The page's world is set up by the background once it has this tab's storage in hand.
send({ kind: "ready" });
