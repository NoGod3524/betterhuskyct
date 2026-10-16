import { isRecord } from "./is-record.ts";
import { isCalendarTask } from "./calendar-task.ts";
import { isAnnouncement } from "./announcements.ts";
import { parseSyncPayloadValue, type SyncPayload } from "./sync.ts";
import { parseGradesSnapshot, type GradesSnapshot } from "./grades.ts";
import { parseMaterialsIndex, type MaterialsIndex } from "./materials.ts";
import { parseReadReport, type ReadReport } from "./sync-status.ts";
import { MAX_CHANGES, parseChanges, type ChangesStore } from "./changes.ts";

export const BACKGROUND_PROTOCOL = "betterhuskyct/background@1";
export const BACKGROUND_CHANGED = "huskypilot:background-imported";
export const BACKGROUND_MAX_BYTES = 8 * 1024 * 1024;
export const BACKGROUND_OFFER_MAX_BYTES = 16 * 1024 * 1024;
export type BackgroundSnapshot = { version: 1; revision: string; at: string; tasks: SyncPayload; grades: GradesSnapshot | null; materials: MaterialsIndex | null; status: ReadReport };
export type BackgroundOffer = { leaseId: string; snapshot: BackgroundSnapshot; changes: ChangesStore };
export type BackgroundStatus = {
  ok: true;
  settings: { enabled: boolean; notifications: boolean; locale: "en" | "zh-CN" | null; kinds: Record<string, boolean> };
  lastAttempt: string | null; lastSuccess: string | null; needsLogin: boolean;
  lastError: string | null; running: boolean; pending: number; cachedAt: string | null;
};

const iso = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;

/** Reject prototypes, getters and executable values before serialising an untrusted envelope. */
function jsonData(value: unknown, depth = 0, budget = { nodes: 150_000 }): boolean {
  if (--budget.nodes < 0 || depth > 24) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  return Object.entries(Object.getOwnPropertyDescriptors(value)).every(([key, descriptor]) =>
    !["__proto__", "prototype", "constructor"].includes(key) && "value" in descriptor && jsonData(descriptor.value, depth + 1, budget));
}

/** A damaged source must not become a successful empty import and consume its extension lease. */
export function parseBackgroundOffer(value: unknown): BackgroundOffer | null {
  try {
    if (!jsonData(value)) return null;
    if (new TextEncoder().encode(JSON.stringify(value)).length > BACKGROUND_OFFER_MAX_BYTES || !isRecord(value) || !identifier(value.leaseId) || !isRecord(value.snapshot)) return null;
    const raw = value.snapshot;
    if (new TextEncoder().encode(JSON.stringify(raw)).length > BACKGROUND_MAX_BYTES) return null;
    if (raw.version !== 1 || !identifier(raw.revision) || !iso(raw.at) || !isRecord(raw.tasks)) return null;
    const tasks = parseSyncPayloadValue(raw.tasks);
    if (!tasks || !Array.isArray(raw.tasks.feeds) || !Array.isArray(raw.tasks.announcements)) return null;
    if (!raw.tasks.feeds.every(feed => isRecord(feed) && iso(feed.importedAt) && Array.isArray(feed.events) && feed.events.every(isCalendarTask))) return null;
    if (!raw.tasks.announcements.every(isAnnouncement) || tasks.announcements.length !== raw.tasks.announcements.length) return null;
    if (tasks.feeds.length !== raw.tasks.feeds.filter(feed => isRecord(feed) && Array.isArray(feed.events) && feed.events.length > 0).length) return null;
    const grades = raw.grades === null ? null : parseGradesSnapshot(raw.grades);
    const materials = raw.materials === null ? null : parseMaterialsIndex(raw.materials);
    const status = parseReadReport(raw.status);
    if ((raw.grades !== null && !grades) || (raw.materials !== null && !materials) || !status) return null;
    if (!isRecord(value.changes) || value.changes.version !== 1 || !Array.isArray(value.changes.entries) || value.changes.entries.length > MAX_CHANGES || !Array.isArray(value.changes.baselines)) return null;
    if (!value.changes.baselines.every(scope => typeof scope === "string" && scope.length > 0 && scope.length <= 200)) return null;
    const ids = new Set<string>();
    for (const row of value.changes.entries) {
      const checked = parseChanges(JSON.stringify({ version: 1, entries: [row], baselines: [] }), new Date("0001-01-01T00:00:00.000Z"));
      if (checked.entries.length !== 1 || ids.has(checked.entries[0].id)) return null;
      ids.add(checked.entries[0].id);
    }
    const changes = parseChanges(JSON.stringify(value.changes));
    if ((!grades && historyForSource(changes, "grades").entries.length > 0)
      || (!materials && historyForSource(changes, "materials").entries.length > 0)) return null;
    return { leaseId: value.leaseId, snapshot: { version: 1, revision: raw.revision, at: raw.at, tasks, grades, materials, status }, changes };
  } catch { return null; }
}

export function historyForSource(history: ChangesStore, source: "tasks" | "grades" | "materials"): ChangesStore {
  return { version: 1,
    entries: history.entries.filter(entry => source === "materials" ? entry.kind === "file-new" : source === "grades"
      ? entry.kind === "grade" || (entry.kind === "done-by-huskyct" && !entry.ref?.id)
      : entry.kind !== "file-new" && entry.kind !== "grade" && (entry.kind !== "done-by-huskyct" || Boolean(entry.ref?.id))),
    baselines: history.baselines.filter(scope => source === "grades" ? scope.startsWith("grades:") : source === "materials" ? scope.startsWith("files:") : scope.startsWith("deadlines:") || scope.startsWith("announcements:")),
  };
}

export function parseBackgroundStatus(value: unknown): BackgroundStatus | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.settings)) return null;
  const settings = value.settings;
  if (typeof settings.enabled !== "boolean" || typeof settings.notifications !== "boolean" || !["en", "zh-CN", null].includes(settings.locale as string | null) || !isRecord(settings.kinds) || !Object.values(settings.kinds).every(item => typeof item === "boolean")) return null;
  if (![value.lastAttempt, value.lastSuccess, value.cachedAt].every(item => item === null || iso(item))) return null;
  if (typeof value.needsLogin !== "boolean" || typeof value.running !== "boolean" || !Number.isSafeInteger(value.pending) || (value.pending as number) < 0 || (value.lastError !== null && typeof value.lastError !== "string")) return null;
  return value as BackgroundStatus;
}

/** The app never reaches chrome.* or requests notification permission itself. */
export function requestBackground(kind: "status" | "settings" | "run-now" | "open-settings", settings?: Record<string, unknown>, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const listen = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window || event.origin !== window.location.origin || data?.protocol !== BACKGROUND_PROTOCOL || data.target !== "app" || data.kind !== "response" || data.requestId !== requestId) return;
      window.removeEventListener("message", listen);
      clearTimeout(timer);
      resolve(data.response);
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", listen);
      reject(new Error("Background helper unavailable"));
    }, timeoutMs);
    window.addEventListener("message", listen);
    window.postMessage({ protocol: BACKGROUND_PROTOCOL, target: "relay", kind, requestId, ...(settings ? { settings } : {}) }, window.location.origin);
  });
}
