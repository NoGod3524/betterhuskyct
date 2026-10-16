// Runs in the extension's own world. The helper itself runs in the page's world, where HuskyCT
// lets it do what HuskyCT's own code does, and cannot reach chrome.* from there. This file is
// the way through: it carries the helper's storage to chrome.storage and its tab requests to
// the background, and tells the helper when another tab changed something.
const PROTOCOL = "betterhuskyct/ext@1";
const PREFIX = "gm:";
const BACKGROUND = "betterhuskyct/background@1";
const APP = window.location.origin === "https://betterhuskyct.vercel.app";
let claimBackground = () => {};

function send(message) {
  try {
    void chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    // The extension was updated or removed while this page stayed open.
  }
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (event.source !== window || event.origin !== window.location.origin || !data || data.protocol !== PROTOCOL || data.from !== "page") return;
  try {
    if (data.kind === "set" && typeof data.key === "string") {
      send({ protocol: BACKGROUND, target: "worker", kind: "gm-write", key: PREFIX + data.key, value: data.value });
    } else if (data.kind === "open" || data.kind === "close") {
      send({ kind: data.kind, id: data.id, url: data.url, options: data.options });
    }
  } catch {
    // Same as above.
  }
});

try {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.protocol === BACKGROUND && message.target === "relay" && message.kind === "available" && APP) claimBackground();
    if (message?.protocol === BACKGROUND && message.target === "relay" && message.kind === "gm-changed" && typeof message.key === "string") {
      window.postMessage(
        { protocol: PROTOCOL, from: "ext", kind: "changed", key: message.key, value: message.value === undefined ? null : message.value },
        window.location.origin,
      );
    }
  });
} catch {
  // As above.
}

// The page's world is set up by the background once it has this tab's storage in hand.
send({ kind: "ready" });

if (APP) {
  let claiming = false;
  let claimAgain = false;
  let offered = null;
  const post = (message) => window.postMessage({ protocol: BACKGROUND, target: "app", ...message }, window.location.origin);
  const request = (message) => chrome.runtime.sendMessage({ protocol: BACKGROUND, target: "worker", ...message });
  async function claim() {
    if (claiming) { claimAgain = true; return; }
    claiming = true;
    try {
      const response = await request({ kind: "claim" });
      if (response?.ok && response.snapshot && typeof response.leaseId === "string") {
        offered = { leaseId: response.leaseId, revision: response.snapshot.revision };
        post({ kind: "offer", leaseId: response.leaseId, snapshot: response.snapshot, changes: response.changes });
      }
    } catch { /* An update can invalidate this content script; the app's request times out. */ }
    finally {
      claiming = false;
      if (claimAgain) { claimAgain = false; void claim(); }
    }
  }
  claimBackground = () => { void claim(); };
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window || event.origin !== window.location.origin || data?.protocol !== BACKGROUND || data.target !== "relay") return;
    if (data.kind === "ready") { void claim(); return; }
    if (data.kind === "ack") {
      if (!offered || data.leaseId !== offered.leaseId || data.revision !== offered.revision) return;
      void request({ kind: "ack", leaseId: data.leaseId, revision: data.revision }).then(response => {
        if (response?.ok) { offered = null; void claim(); }
      }).catch(() => {});
      return;
    }
    if (!["status", "settings", "run-now", "open-settings"].includes(data.kind) || typeof data.requestId !== "string" || data.requestId.length > 200) return;
    void request({ kind: data.kind, ...(data.kind === "settings" ? { settings: data.settings } : {}) }).then(response => {
      post({ kind: "response", requestId: data.requestId, response });
      if (data.kind === "run-now" && response?.ok) void claim();
    }).catch(() => post({ kind: "response", requestId: data.requestId, response: { ok: false, reason: "unavailable" } }));
  });
  window.addEventListener("focus", () => { void claim(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void claim(); });
  void claim();
}
