// The offscreen page has a DOM and runtime messaging, but no chrome.storage access.
// Its basket and colours exist in memory for one run; the service worker owns persistence.
(() => {
  const PROTOCOL = "betterhuskyct/background@1";
  const MAX_BYTES = 8 * 1024 * 1024;
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  window.__bhcHelperRuntime = { headless: true, origin: "https://lms.uconn.edu", credentials: "include", storage };
  const ready = new Promise((resolve) => {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", resolve, { once: true });
    else resolve();
  });
  const sizeOf = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  let running = null;

  async function collect(message) {
    await ready;
    const helper = window.__huskyctHelper;
    if (!helper) return { ok: false, reason: "failed" };
    if (sizeOf({ basket: message.basket, colors: message.colors }) > MAX_BYTES) return { ok: false, reason: "too-large" };
    values.clear();
    if (message.basket) storage.setItem(helper.BASKET_KEY, JSON.stringify(message.basket));
    if (message.colors) storage.setItem(helper.COLORS_KEY, JSON.stringify(message.colors));
    const at = new Date().toISOString();
    const result = await helper.syncLight();
    if (result.reason === "signedout") return { ok: false, reason: "signedout" };
    // The foreground helper calls a sync useful when announcements or grades arrived. Background
    // delivery can also preserve a successful deadlines-only or materials-only reading.
    const status = result.status;
    if (!status || !(result.ok || status.dueDates || status.todo || status.courses.some((course) => course.files))) return { ok: false, reason: "failed" };

    const basket = helper.readBasket(storage);
    const colors = helper.readColors(storage);
    const contents = helper.basketContents(basket);
    const tasks = helper.syncPayload(contents.records, new Date(at), contents.announcements, helper.colorsByCode(storage, basket));
    const snapshot = {
      version: 1, revision: crypto.randomUUID(), at,
      tasks: { ...tasks, doneByHuskyct: {}, reopened: [] },
      grades: result.grades ? { ...helper.gradesSnapshotFrom(result.grades), takenAt: at } : null,
      // Metadata only: fetching course-file Blobs still belongs to a user's foreground Sync.
      materials: result.materials ? { ...helper.materialsIndexFrom(result.materials), updatedAt: at } : null,
      status: result.status,
    };
    const response = { ok: true, snapshot, basket, colors };
    return sizeOf(response) > MAX_BYTES ? { ok: false, reason: "too-large" } : response;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab || !message || message.protocol !== PROTOCOL || message.target !== "offscreen" || message.kind !== "run") return false;
    if (!running) {
      // Progress-free courses can take longer than a service worker's idle timeout.
      const heartbeat = setInterval(() => {
        void chrome.runtime.sendMessage({ protocol: PROTOCOL, target: "background", kind: "heartbeat" }).catch(() => {});
      }, 20_000);
      running = collect(message).catch(() => ({ ok: false, reason: "failed" })).finally(() => {
        clearInterval(heartbeat);
        running = null;
      });
    }
    void running.then(sendResponse);
    return true;
  });
})();
