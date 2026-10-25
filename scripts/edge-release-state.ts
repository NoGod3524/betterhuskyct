/** Durable product-wide journal. The state branch is never a release trigger. */
export type Phase = "ready" | "upload-intent" | "upload-pending" | "uploaded" | "submit-intent" | "submit-pending" | "submitted" | "blocked" | "unknown" | "failed" | "published";
export type Release = {
  version: string;
  zipSha256: string;
  sourceSha: string;
  phase: Phase;
  updatedAt: string;
  runUrl: string;
  clearedAt?: string;
  uploadOperationId?: string;
  publishOperationId?: string;
  submissionId?: string;
  errorCode?: string;
  evidence?: Evidence;
};
export type Evidence = {
  state: "clear" | "in-review" | "published";
  version: string;
  observedAt: string;
  reference: string;
  submissionId?: string;
};
export type Journal = { schema: 1; productId: string; activeVersion?: string; releases: Record<string, Release> };
export type Snapshot = { journal: Journal; sha?: string };
export type StateStore = {
  load(): Promise<Snapshot>;
  /** Compare-and-swap. A conflict or an uncertain write MUST stop the caller. */
  save(snapshot: Snapshot, journal: Journal): Promise<Snapshot>;
};

const phases: Phase[] = ["ready", "upload-intent", "upload-pending", "uploaded", "submit-intent", "submit-pending", "submitted", "blocked", "unknown", "failed", "published"];
export const isVersion = (value: string) => /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value);
export function validateJournal(value: unknown, productId: string): Journal {
  if (!value || typeof value !== "object") throw new Error("Invalid Edge journal");
  const j = value as Journal;
  if (j.schema !== 1 || j.productId !== productId || !j.releases || typeof j.releases !== "object" || Array.isArray(j.releases)) throw new Error("Invalid Edge journal identity");
  for (const [version, r] of Object.entries(j.releases)) {
    if (!isVersion(version) || !r || r.version !== version || !phases.includes(r.phase) || !/^[a-f0-9]{64}$/.test(r.zipSha256) || !/^[a-f0-9]{40}$/.test(r.sourceSha) || !Number.isFinite(Date.parse(r.updatedAt)) || typeof r.runUrl !== "string") throw new Error("Invalid Edge release record");
    for (const id of [r.uploadOperationId, r.publishOperationId]) {
      if (id !== undefined && !/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid operation ID in Edge journal");
    }
    if ((r.phase === "upload-pending" && !r.uploadOperationId) || (r.phase === "submit-pending" && !r.publishOperationId)) throw new Error("Missing pending operation ID");
    if (r.phase !== "published" && j.activeVersion !== version) throw new Error("Unresolved release is missing its product lock");
  }
  if (j.activeVersion !== undefined && (!Object.hasOwn(j.releases, j.activeVersion) || j.releases[j.activeVersion].phase === "published")) throw new Error("Invalid active Edge release");
  return j;
}

/** Uses the existing Actions token, never Edge credentials. No write is retried. */
export function githubStateStore(options: {
  repository: string; token: string; productId: string; seedSha: string;
  branch?: string; fetch?: typeof fetch;
}): StateStore {
  const request = options.fetch ?? fetch;
  const branch = options.branch ?? "edge-release-state";
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repository) || !/^[\w.-]+$/.test(branch) || !/^[a-zA-Z0-9-]+$/.test(options.productId) || !/^[a-f0-9]{40}$/.test(options.seedSha)) throw new Error("Invalid journal configuration");
  const root = `https://api.github.com/repos/${options.repository}`;
  const path = `edge-release-state/${options.productId}.json`;
  const headers = { Authorization: `Bearer ${options.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
  async function call(url: string, init: RequestInit = {}) {
    try { return await request(url, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error("Edge journal request uncertain; stop and reload state before retrying"); }
  }
  return {
    async load() {
      const response = await call(`${root}/contents/${path}?ref=${encodeURIComponent(branch)}`);
      if (response.status === 404) return { journal: { schema: 1, productId: options.productId, releases: {} } };
      if (response.status !== 200) throw new Error(`Cannot read Edge journal: HTTP ${response.status}`);
      const data = await response.json() as { sha: string; content: string; encoding: string };
      if (data.encoding !== "base64" || !/^[a-f0-9]{40}$/.test(data.sha)) throw new Error("Invalid journal response");
      return { journal: validateJournal(JSON.parse(Buffer.from(data.content, "base64").toString("utf8")), options.productId), sha: data.sha };
    },
    async save(snapshot, journal) {
      validateJournal(journal, options.productId);
      if (!snapshot.sha) {
        const branchResponse = await call(`${root}/git/ref/heads/${branch}`);
        if (branchResponse.status === 404) {
          const created = await call(`${root}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: options.seedSha }) });
          if (created.status !== 201) throw new Error(`Cannot initialize Edge state branch: HTTP ${created.status}; reload before retrying`);
        } else if (branchResponse.status !== 200) throw new Error(`Cannot read Edge state branch: HTTP ${branchResponse.status}`);
      }
      const response = await call(`${root}/contents/${path}`, { method: "PUT", body: JSON.stringify({
        branch, sha: snapshot.sha,
        message: `Record Edge ${journal.activeVersion ?? "publication"} state`,
        content: Buffer.from(JSON.stringify(journal, null, 2) + "\n").toString("base64"),
      }) });
      if (response.status !== 200 && response.status !== 201) throw new Error(`Cannot save Edge journal: HTTP ${response.status}; reload before retrying`);
      const data = await response.json() as { content?: { sha?: string } };
      if (!data.content?.sha || !/^[a-f0-9]{40}$/.test(data.content.sha)) throw new Error("Journal write outcome uncertain; reload before retrying");
      return { journal: structuredClone(journal), sha: data.content.sha };
    },
  };
}
