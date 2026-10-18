import { CHANGE_KINDS, diffBackgroundSnapshot } from "./background-diff.js";
import { parseChanges } from "../../src/lib/changes.ts";

export const BACKGROUND_PROTOCOL = "betterhuskyct/background@1";
export const BACKGROUND_KEY = "backgroundSync.v1";
export const BACKGROUND_ALARM = "betterhuskyct-background";
const APP = "https://betterhuskyct.vercel.app";
const LOGIN = "https://lms.uconn.edu/";
const LOGIN_NOTICE = "betterhuskyct-login", CHANGES_NOTICE = "betterhuskyct-changes";
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const emptyChanges = () => ({ version: 1, entries: [], baselines: [] });
const defaults = () => ({ version: 1, settings: { enabled: true, notifications: false, locale: null,
  kinds: Object.fromEntries(CHANGE_KINDS.map((kind) => [kind, true])) }, snapshot: null, pendingChanges: emptyChanges(),
  basket: null, colors: null, lastAttempt: null, lastSuccess: null, needsLogin: false, loginNotified: false,
  lastError: null, runToken: null, lease: null, lastAckRevision: null, settingsRevision: 0 });

export function validBackgroundSnapshot(value) {
  if (!value || value.version !== 1 || typeof value.revision !== "string" || !value.revision || value.revision.length > 100 ||
    typeof value.at !== "string" || !Number.isFinite(Date.parse(value.at)) || !value.tasks || value.tasks.version !== 1 ||
    !Array.isArray(value.tasks.feeds) || !Array.isArray(value.tasks.announcements) || !value.status ||
    typeof value.status.dueDates !== "boolean" || typeof value.status.todo !== "boolean" || !Array.isArray(value.status.courses)) return false;
  try { return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_SNAPSHOT_BYTES; } catch { return false; }
}

/** One small write queue covers settings, leases and completed runs; HTTP work stays outside it. */
export function createBackgroundSync(api, options = {}) {
  const now = options.now || (() => new Date());
  const uuid = options.uuid || (() => crypto.randomUUID());
  let queue = Promise.resolve(), activeRun = null;
  const trustedAccess = api.storage.local.setAccessLevel
    ? api.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }) : Promise.resolve();
  const enqueue = (work) => {
    const result = queue.then(async () => { await trustedAccess; return work(); });
    queue = result.catch(() => undefined);
    return result;
  };
  const read = async () => {
    const raw = (await api.storage.local.get(BACKGROUND_KEY))[BACKGROUND_KEY];
    const state = raw?.version === 1 ? { ...defaults(), ...raw } : defaults();
    state.settings = { ...defaults().settings, ...state.settings,
      kinds: { ...defaults().settings.kinds, ...state.settings?.kinds } };
    state.pendingChanges = parseChanges(JSON.stringify(state.pendingChanges), now());
    if (state.snapshot && !validBackgroundSnapshot(state.snapshot)) state.snapshot = null;
    return state;
  };
  const update = (change) => enqueue(async () => {
    const state = await read();
    const result = await change(state);
    await api.storage.local.set({ [BACKGROUND_KEY]: state });
    return result;
  });
  const status = () => enqueue(async () => {
    const state = await read();
    return { ok: true, settings: state.settings, lastAttempt: state.lastAttempt, lastSuccess: state.lastSuccess,
      needsLogin: state.needsLogin, lastError: state.lastError, running: Boolean(activeRun && state.runToken),
      pending: state.pendingChanges.entries.length, cachedAt: state.snapshot?.at || null };
  });
  const schedule = () => enqueue(async () => {
    const state = await read();
    if (state.settings.enabled && !state.needsLogin) {
      if (await api.alarms.get(BACKGROUND_ALARM)) return;
      const previous = Date.parse(state.lastAttempt || state.lastSuccess || "");
      // Worker restarts ensure an alarm exists; they never push an existing deadline back.
      const when = Number.isFinite(previous) ? Math.max(now().valueOf() + 60_000, previous + 360 * 60_000) : now().valueOf() + 60_000;
      await api.alarms.create(BACKGROUND_ALARM, { when, periodInMinutes: 360 });
    } else await api.alarms.clear(BACKGROUND_ALARM);
  });
  const chinese = (state) => (state.settings.locale || options.language || globalThis.navigator?.language || "en").startsWith("zh");
  const notify = async (entries, login, revision) => {
    if (!(await api.permissions.contains({ permissions: ["notifications"] }))) return;
    await enqueue(async () => {
      const state = await read();
      if (!state.settings.notifications || state.settingsRevision !== revision || (login && (!state.needsLogin || state.loginNotified))) return;
      const eligible = entries.filter((entry) => state.settings.kinds[entry.kind]);
      if (!login && eligible.length === 0) return;
      const zh = chinese(state);
      await api.notifications.create(login ? LOGIN_NOTICE : CHANGES_NOTICE, { type: "basic", iconUrl: "icons/icon-128.png",
        title: login ? (zh ? "请登录 HuskyCT" : "Sign in to HuskyCT") : (zh ? `HuskyCT 有 ${eligible.length} 条变化` : `${eligible.length} HuskyCT changes`),
        message: login ? (zh ? "后台同步已暂停。点击后自行登录，之后会恢复。" : "Background sync is paused. Click to sign in yourself, then syncing can resume.")
          : eligible.slice(0, 3).map((entry) => `${entry.courseCode ? entry.courseCode + ": " : ""}${entry.title}`).join("\n").slice(0, 600),
      });
      if (login) { state.loginNotified = true; await api.storage.local.set({ [BACKGROUND_KEY]: state }); }
    });
  };
  const collect = async (basket, colors, token) => {
    if (!(await api.offscreen.hasDocument())) await api.offscreen.createDocument({ url: "offscreen.html", reasons: ["DOM_PARSER"],
      justification: "Read and parse HuskyCT course metadata with the student's existing browser session." });
    let timer;
    try {
      if ((await enqueue(read)).runToken !== token) throw new Error("cancelled");
      return await Promise.race([
        api.runtime.sendMessage({ protocol: BACKGROUND_PROTOCOL, target: "offscreen", kind: "run", basket, colors }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("background timeout")), options.timeoutMs || 8 * 60_000); }),
      ]);
    } finally {
      clearTimeout(timer);
      await api.offscreen.closeDocument().catch(() => undefined);
    }
  };
  const run = (source = "manual") => {
    if (activeRun) return activeRun;
    activeRun = (async () => {
      const token = uuid();
      const seed = await update((state) => {
        if (source !== "manual" && (!state.settings.enabled || (state.needsLogin && source !== "login-check"))) return null;
        state.runToken = token; state.lastAttempt = now().toISOString(); state.lastError = null;
        return { basket: state.basket, colors: state.colors, revision: state.settingsRevision };
      });
      if (!seed) return { ok: false, reason: "paused" };
      let result;
      try { result = await collect(seed.basket, seed.colors, token); } catch { result = { ok: false, reason: "failed" }; }
      const completed = await update((state) => {
        if (state.runToken !== token) return { ok: false, reason: "cancelled", added: [] };
        state.runToken = null;
        if (!result?.ok || !validBackgroundSnapshot(result.snapshot)) {
          const reason = result?.reason === "signedout" ? "signedout" : result?.reason === "too-large" ? "too-large" : "failed";
          state.lastError = reason;
          if (reason === "signedout") state.needsLogin = true;
          return { ok: false, reason, added: [] };
        }
        const diff = diffBackgroundSnapshot(state.snapshot, result.snapshot, state.pendingChanges, now());
        if (!validBackgroundSnapshot(diff.snapshot)) { state.lastError = "too-large"; return { ok: false, reason: "too-large", added: [] }; }
        state.snapshot = diff.snapshot; state.pendingChanges = diff.changes;
        state.basket = result.basket ?? state.basket; state.colors = result.colors ?? state.colors;
        state.lastSuccess = now().toISOString(); state.lastError = null; state.needsLogin = false; state.loginNotified = false;
        return { ok: true, added: diff.added };
      });
      await schedule();
      if (completed.ok) {
        await api.tabs.query({ url: [APP + "/*"] }).then((tabs) => Promise.all(tabs.map((tab) =>
          api.tabs.sendMessage(tab.id, { protocol: BACKGROUND_PROTOCOL, target: "relay", kind: "available" }, { frameId: 0 }).catch(() => undefined),
        ))).catch(() => undefined);
      }
      await notify(completed.added || [], completed.reason === "signedout", seed.revision).catch(() => undefined);
      return { ok: completed.ok, ...(completed.reason ? { reason: completed.reason } : {}) };
    })().catch(() => ({ ok: false, reason: "failed" })).finally(() => { activeRun = null; });
    return activeRun;
  };
  const popupSender = (sender) => sender.id === api.runtime.id && sender.url === api.runtime.getURL("popup.html");
  const appSender = (sender) => {
    try { return sender.id === api.runtime.id && typeof sender.tab?.id === "number" && sender.frameId === 0 && new URL(sender.url).origin === APP; }
    catch { return false; }
  };
  const huskyctSender = (sender) => sender.id === api.runtime.id && typeof sender.tab?.id === "number" && sender.frameId === 0 &&
    /^https:\/\/(?:lms|huskyct)\.uconn\.edu\//.test(sender.url || "");
  const offer = (lease) => {
    const result = { ok: true, leaseId: lease.id, snapshot: lease.snapshot, changes: lease.changes };
    return new TextEncoder().encode(JSON.stringify(result)).length <= 16 * 1024 * 1024 ? result : { ok: false, reason: "too-large" };
  };
  const handle = async (message, sender) => {
    if (!message || message.protocol !== BACKGROUND_PROTOCOL || !["worker", "background"].includes(message.target)) return undefined;
    if (message.kind === "heartbeat" && sender.id === api.runtime.id && sender.url === api.runtime.getURL("offscreen.html")) return { ok: true };
    const app = appSender(sender), popup = popupSender(sender);
    if (["gm-read", "gm-write"].includes(message.kind)) {
      if (!app && !popup && !huskyctSender(sender)) return { ok: false, reason: "forbidden" };
      if (message.kind === "gm-read") return enqueue(async () => {
        const all = await api.storage.local.get(null);
        return { ok: true, values: Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith("gm:") && key.length > 3 && key.length <= 240)
          .map(([key, value]) => [key.slice(3), value])) };
      });
      if (typeof message.key !== "string" || !message.key.startsWith("gm:") || message.key.length <= 3 || message.key.length > 240) return { ok: false, reason: "invalid" };
      try { if (new TextEncoder().encode(JSON.stringify(message.value)).length > 16 * 1024 * 1024) return { ok: false, reason: "too-large" }; }
      catch { return { ok: false, reason: "invalid" }; }
      return enqueue(async () => { await api.storage.local.set({ [message.key]: message.value }); return { ok: true }; });
    }
    if (!app && !popup) return { ok: false, reason: "forbidden" };
    if (message.kind === "status") return status();
    if (message.kind === "run-now") { void run("manual"); return { ok: true }; }
    if (message.kind === "open-settings") {
      try {
        if (!api.action?.openPopup) throw new Error("popup unavailable");
        await api.action.openPopup();
      } catch { await api.tabs.create({ url: api.runtime.getURL("popup.html") }); }
      return { ok: true };
    }
    if (message.kind === "settings") {
      const patch = message.settings;
      if (!patch || typeof patch !== "object") return { ok: false, reason: "invalid" };
      if (patch.notifications === true && !(await api.permissions.contains({ permissions: ["notifications"] }))) return { ok: false, reason: "permission" };
      await update((state) => {
        for (const key of ["enabled", "notifications"]) if (typeof patch[key] === "boolean") state.settings[key] = patch[key];
        if (["en", "zh-CN", null].includes(patch.locale)) state.settings.locale = patch.locale;
        for (const kind of CHANGE_KINDS) if (typeof patch.kinds?.[kind] === "boolean") state.settings.kinds[kind] = patch.kinds[kind];
        if (patch.enabled === false || patch.notifications === false) state.settingsRevision++;
        if (patch.enabled === false) state.runToken = null;
      });
      if (patch.enabled === false) await api.offscreen.closeDocument().catch(() => undefined);
      await schedule();
      if (patch.enabled === true) void run("enabled");
      return status();
    }
    if (message.kind === "claim") {
      if (!app) return { ok: false, reason: "forbidden" };
      return update((state) => {
        const owner = sender.tab.id;
        if (state.lease && state.lease.expires > now().valueOf()) {
          if (state.lease.owner !== owner) return { ok: false, reason: "leased" };
          return offer(state.lease);
        }
        state.lease = null;
        if (!state.snapshot || (state.snapshot.revision === state.lastAckRevision && state.pendingChanges.entries.length === 0)) return { ok: true, snapshot: null };
        state.lease = { id: uuid(), owner, expires: now().valueOf() + 60_000, snapshot: state.snapshot, changes: state.pendingChanges,
          ids: state.pendingChanges.entries.map((entry) => entry.id) };
        return offer(state.lease);
      });
    }
    if (message.kind === "ack") {
      if (!app) return { ok: false, reason: "forbidden" };
      return update((state) => {
        const lease = state.lease;
        if (!lease || lease.owner !== sender.tab.id || lease.id !== message.leaseId || lease.snapshot.revision !== message.revision) return { ok: false, reason: "invalid-lease" };
        const delivered = new Set(lease.ids);
        state.pendingChanges.entries = state.pendingChanges.entries.filter((entry) => !delivered.has(entry.id));
        state.lastAckRevision = lease.snapshot.revision; state.lease = null;
        return { ok: true };
      });
    }
    return { ok: false, reason: "invalid" };
  };
  const install = () => {
    api.alarms.onAlarm.addListener((alarm) => { if (alarm.name === BACKGROUND_ALARM) void run("alarm"); });
    api.runtime.onStartup.addListener(() => { void schedule().catch(() => undefined); });
    api.runtime.onInstalled.addListener(() => { void schedule().catch(() => undefined); });
    api.tabs.onUpdated.addListener((_id, change, tab) => {
      if (change.status !== "complete" || !/^https:\/\/(?:lms|huskyct)\.uconn\.edu\//.test(tab.url || "")) return;
      void enqueue(read).then((state) => { if (state.needsLogin && state.settings.enabled) void run("login-check"); });
    });
    api.tabs.onRemoved.addListener((id) => { void update((state) => { if (state.lease?.owner === id) state.lease = null; }).catch(() => undefined); });
    api.notifications?.onClicked?.addListener((id) => {
      if (id === LOGIN_NOTICE || id === CHANGES_NOTICE) void api.tabs.create({ url: id === LOGIN_NOTICE ? LOGIN : APP + "/changes" });
    });
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const gm = Object.entries(changes).filter(([key]) => key.startsWith("gm:") && key.length > 3 && key.length <= 240);
      if (!gm.length) return;
      void api.tabs.query({ url: [APP + "/*", "https://lms.uconn.edu/*", "https://huskyct.uconn.edu/*"] }).then((tabs) => {
        for (const tab of tabs) for (const [key, change] of gm) {
          void api.tabs.sendMessage(tab.id, { protocol: BACKGROUND_PROTOCOL, target: "relay", kind: "gm-changed",
            key: key.slice(3), value: change.newValue === undefined ? null : change.newValue }, { frameId: 0 }).catch(() => undefined);
        }
      }).catch(() => undefined);
    });
    void schedule().catch(() => undefined);
  };
  return { handle, run, install, enqueue };
}
