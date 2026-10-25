/** Edge Update API v1.1. Operation success means submitted, never store publication.
 * The journal is required even for manual runs. See tools/extension/EDGE-PUBLISHING.md.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { githubStateStore, isVersion, type Evidence, type Phase, type Release, type StateStore } from "./edge-release-state.ts";

const API = "https://api.addons.microsoftedge.microsoft.com";
const CLEARANCE_MS = 30 * 60_000;
export type Settings = {
  productId: string; clientId?: string; apiKey?: string; zip: Uint8Array;
  version: string; sourceSha: string; runUrl: string; notes: string;
  mode?: "status" | "publish" | "reconcile"; evidence?: Evidence;
};
export type Deps = {
  store: StateStore; fetch?: typeof fetch; wait?: (ms: number) => Promise<void>;
  every?: number; tries?: number; budgetMs?: number; now?: () => number;
  random?: () => number; log?: (line: string) => void;
};
export type Result = { phase: Phase | "unreconciled"; version: string; zipSha256: string; uploadOperationId?: string; publishOperationId?: string; submissionId?: string; errorCode?: string };
export type Operation = { status: "InProgress" | "Succeeded" | "Failed"; message?: string | null; errorCode?: string | null };

/** Location is documented as an ID; also accept an exact same-origin operation URL. */
export function operationId(location: string | null, endpoint: string): string {
  if (!location) throw new Error("Accepted request has no operation ID");
  if (/^[a-zA-Z0-9-]+$/.test(location)) return location;
  const url = new URL(location, API);
  const prefix = `${endpoint}/operations/`;
  const id = url.pathname.slice(prefix.length);
  if (url.origin !== API || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix) || !/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid operation location");
  return id;
}

export async function publishToEdge(settings: Settings, deps: Deps): Promise<Result> {
  const request = deps.fetch ?? fetch;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const log = deps.log ?? console.log;
  const tries = deps.tries ?? 60;
  const every = deps.every ?? 5000;
  const deadline = now() + (deps.budgetMs ?? 10 * 60_000);
  const mode = settings.mode ?? "status";
  if (!isVersion(settings.version) || !/^[a-f0-9]{40}$/.test(settings.sourceSha) || !/^[a-zA-Z0-9-]+$/.test(settings.productId)) throw new Error("Invalid release identity");
  if (settings.notes.length >= 2000) throw new Error("Certification notes must be shorter than 2,000 characters");
  const zipSha256 = createHash("sha256").update(settings.zip).digest("hex");
  let snapshot = await deps.store.load();
  if (snapshot.journal.productId !== settings.productId) throw new Error("Wrong product journal");
  let release = snapshot.journal.releases[settings.version];
  if (release && (release.zipSha256 !== zipSha256 || release.sourceSha !== settings.sourceSha)) throw new Error("Version identity conflict: source or ZIP differs from the recorded version");
  const result = (): Result => ({ phase: release?.phase ?? "unreconciled", version: settings.version, zipSha256, ...(release && {
    uploadOperationId: release.uploadOperationId, publishOperationId: release.publishOperationId,
    submissionId: release.submissionId, errorCode: release.errorCode,
  }) });
  async function save(patch: Partial<Release>) {
    const journal = structuredClone(snapshot.journal);
    release = { ...release, ...patch, updatedAt: new Date(now()).toISOString(), runUrl: settings.runUrl } as Release;
    journal.releases[settings.version] = release;
    if (release.phase === "published") { if (journal.activeVersion === settings.version) delete journal.activeVersion; }
    else journal.activeVersion = settings.version;
    snapshot = await deps.store.save(snapshot, journal);
  }
  function freshClearance() {
    const at = Date.parse(release?.clearedAt ?? "");
    return Number.isFinite(at) && now() >= at && now() - at <= CLEARANCE_MS;
  }

  if (mode === "reconcile") {
    const evidence = settings.evidence;
    const at = Date.parse(evidence?.observedAt ?? "");
    if (!evidence || !["clear", "in-review", "published"].includes(evidence.state) || !isVersion(evidence.version) || !Number.isFinite(at) || now() < at || now() - at > CLEARANCE_MS || !/^https:\/\/partner\.microsoft\.com\//.test(evidence.reference) || /[?#]/.test(evidence.reference)) throw new Error("Reconciliation needs fresh Partner Center state, version, time and reference");
    if (evidence.submissionId !== undefined && !/^\d+$/.test(evidence.submissionId)) throw new Error("Invalid submission ID evidence");
    if ((evidence.state === "clear" || evidence.state === "published") && evidence.version !== settings.version) throw new Error("Evidence must identify the target version");
    const active = snapshot.journal.activeVersion;
    if (active && active !== settings.version) throw new Error(`Reconcile active version ${active} before changing the target version`);
    if (release && ["upload-pending", "submit-pending"].includes(release.phase)) throw new Error("Resume the known operation with status before reconciling");
    if (evidence.state === "clear" && release?.phase === "published") throw new Error("A published version cannot be reset for resubmission");
    if (evidence.state === "in-review" && evidence.version === settings.version && !evidence.submissionId) throw new Error("Adopting a submission needs its submission ID");
    const phase = evidence.state === "published" ? "published" : evidence.state === "clear" ? "ready" : evidence.version === settings.version ? "submitted" : "blocked";
    // Explicit reconciliation is the only way to reset an ambiguous operation. Keep the evidence,
    // while the Git history retains previous operation IDs and failures for investigation.
    await save({ version: settings.version, sourceSha: settings.sourceSha, zipSha256, phase,
      evidence: { state: evidence.state, version: evidence.version, observedAt: evidence.observedAt, reference: evidence.reference, submissionId: evidence.submissionId },
      clearedAt: evidence.state === "clear" ? evidence.observedAt : undefined,
      operationStep: undefined, uploadOperationId: undefined, publishOperationId: undefined,
      submissionId: evidence.version === settings.version ? evidence.submissionId : undefined,
      errorCode: phase === "blocked" ? "InProgressSubmission" : undefined });
    return result();
  }

  const active = snapshot.journal.activeVersion;
  if (active && active !== settings.version) {
    log(`Blocked by recorded release ${active}; reconcile its store state first.`);
    return { ...result(), phase: "blocked", errorCode: "ActiveRelease" };
  }
  // A read/authentication failure does not lose a known receipt. Only explicit status may
  // recover an unknown operation; it still cannot follow recovery with a new POST.
  if (release?.phase === "unknown" && mode === "status") {
    if (release.operationStep === "submit" && release.publishOperationId) await save({ phase: "submit-pending" });
    else if (release.operationStep === "upload" && release.uploadOperationId) await save({ phase: "upload-pending" });
  }
  if (!release || ["submitted", "published", "blocked", "unknown", "failed"].includes(release.phase)) return result();
  if (["upload-intent", "submit-intent"].includes(release.phase)) {
    await save({ phase: "unknown", errorCode: "UncertainPostOutcome" });
    return result();
  }
  // Status mode can recover GET operations, but cannot upload or submit anything.
  const needsRemote = ["upload-pending", "submit-pending"].includes(release.phase) || mode === "publish";
  if (needsRemote && (!settings.clientId || !settings.apiKey)) throw new Error("Edge authentication is required for this operation");
  const headers = { Authorization: `ApiKey ${settings.apiKey}`, "X-ClientID": settings.clientId ?? "" };
  const base = `/v1/products/${encodeURIComponent(settings.productId)}/submissions`;

  async function post(step: "upload" | "submit") {
    if (!freshClearance()) { await save({ phase: "blocked", errorCode: "ClearanceExpired" }); return; }
    await save({ phase: step === "upload" ? "upload-intent" : "submit-intent", operationStep: step, errorCode: undefined });
    const endpoint = step === "upload" ? `${base}/draft/package` : base;
    let response: Response;
    try {
      response = await request(`${API}${endpoint}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000),
        headers: { ...headers, "Content-Type": step === "upload" ? "application/zip" : "text/plain" },
        body: step === "upload" ? settings.zip as BodyInit : settings.notes });
    } catch {
      await save({ phase: "unknown", errorCode: "UncertainPostOutcome" }); return;
    }
    if (response.status !== 202) {
      // A gateway/server failure could hide an accepted write. Never retry POST automatically.
      await save({ phase: response.status >= 500 || response.status === 408 ? "unknown" : "failed", errorCode: `PostHTTP${response.status}` }); return;
    }
    let id: string;
    try { id = operationId(response.headers.get("location"), endpoint); }
    catch { await save({ phase: "unknown", errorCode: "MissingOrInvalidOperationId" }); return; }
    await save(step === "upload" ? { phase: "upload-pending", uploadOperationId: id } : { phase: "submit-pending", publishOperationId: id });
  }

  async function poll(step: "upload" | "submit") {
    const id = step === "upload" ? release.uploadOperationId : release.publishOperationId;
    if (!id) { await save({ phase: "unknown", errorCode: "MissingOperationId" }); return; }
    const endpoint = step === "upload" ? `${base}/draft/package` : base;
    for (let look = 0; look < tries && now() < deadline; look++) {
      let response: Response | undefined;
      let retryAfter = 0;
      try { response = await request(`${API}${endpoint}/operations/${encodeURIComponent(id)}`, { headers, redirect: "error", signal: AbortSignal.timeout(30_000) }); }
      catch { /* GET is safe to retry; keep the durable pending operation. */ }
      if (response) {
        if ([429, 408].includes(response.status) || response.status >= 500) {
          const header = response.headers.get("retry-after");
          retryAfter = header ? (/^\d+$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - now())) : 0;
          if (!Number.isFinite(retryAfter)) retryAfter = 0;
        } else if (response.status !== 200 && response.status !== 202) {
          await save({ phase: "unknown", operationStep: step, errorCode: `GetHTTP${response.status}` }); return;
        } else {
          let operation: Operation;
          try { operation = await response.json() as Operation; }
          catch { await save({ phase: "unknown", operationStep: step, errorCode: "InvalidOperationResponse" }); return; }
          if (!operation || !["InProgress", "Succeeded", "Failed"].includes(operation.status)) {
            await save({ phase: "unknown", operationStep: step, errorCode: "InvalidOperationStatus" }); return;
          }
          if (operation.status === "Succeeded") {
            const submissionId = typeof operation.message === "string" ? /Successfully created submission with ID (\d+)/.exec(operation.message)?.[1] : undefined;
            await save(step === "upload" ? { phase: "uploaded", errorCode: undefined } : { phase: "submitted", submissionId, errorCode: undefined }); return;
          }
          if (operation.status === "Failed") {
            const known = ["InProgressSubmission", "UnpublishInProgress", "NoModulesUpdated", "SubmissionValidationError", "ModuleStateUnPublishable", "CreateNotAllowed", "InvalidVersion", "InvalidPackage", "PackageValidationFailed"];
            const code = typeof operation.errorCode === "string" && known.includes(operation.errorCode) ? operation.errorCode : "OperationFailed";
            await save({ phase: ["InProgressSubmission", "UnpublishInProgress"].includes(code) ? "blocked" : "failed", errorCode: code }); return;
          }
        }
      }
      if (look >= tries - 1) break;
      const delay = Math.max(retryAfter, Math.min(60_000, every * 2 ** Math.min(look, 10)) * (0.8 + random() * 0.4));
      if (now() + delay >= deadline) break;
      await wait(delay);
    }
    log(`Operation remains pending; resume its GET later (${step}).`);
  }

  if (mode === "publish" && release.phase === "ready") await post("upload");
  if (release.phase === "upload-pending") await poll("upload");
  if (mode === "publish" && release.phase === "uploaded") await post("submit");
  if (release.phase === "submit-pending") await poll("submit");
  return result();
}

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main() {
  const mode = process.env.EDGE_MODE ?? "status";
  if (!["status", "publish", "reconcile"].includes(mode)) throw new Error("Unknown EDGE_MODE");
  const zip = readFileSync(process.argv[2] ?? "public/betterhuskyct-extension.zip");
  const manifestBytes = unzipSync(zip)["manifest.json"];
  if (!manifestBytes) throw new Error("ZIP has no manifest");
  const version = (JSON.parse(strFromU8(manifestBytes)) as { version: string }).version;
  const sourceSha = setting("EDGE_SOURCE_SHA");
  const productId = setting("EDGE_PRODUCT_ID");
  const repository = setting("GITHUB_REPOSITORY");
  const store = githubStateStore({ repository, token: setting("GH_TOKEN"), productId, seedSha: setting("GITHUB_SHA") });
  const standing = readFileSync(new URL("../tools/extension/certification-notes.txt", import.meta.url), "utf8").trim();
  const outcome = await publishToEdge({ productId, clientId: process.env.EDGE_CLIENT_ID, apiKey: process.env.EDGE_API_KEY,
    zip, version, sourceSha, runUrl: `https://github.com/${repository}/actions/runs/${setting("GITHUB_RUN_ID")}/attempts/${setting("GITHUB_RUN_ATTEMPT")}`,
    notes: `Version ${version}.\n\n${standing}`, mode: mode as Settings["mode"],
    evidence: mode === "reconcile" ? JSON.parse(setting("EDGE_EVIDENCE")) as Evidence : undefined,
  }, { store });
  console.log(JSON.stringify(outcome));
  // A green run means the requested mode completed, not that the extension is in the store.
  if (mode === "publish" && !["submitted", "published"].includes(outcome.phase)) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Edge operation stopped. Check the durable journal and reconcile before retrying; no POST will be retried automatically."); process.exitCode = 1; });
}
