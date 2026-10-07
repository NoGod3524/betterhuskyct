/**
 * Course materials — every course's files, videos, links and tools — kept in
 * this browser, so the app can stand in for HuskyCT's content pages.
 *
 * The files never touch a server. They arrive one of two ways, and both end in
 * the same store:
 *
 * - **Sent by the helper.** After "Collect course materials" on HuskyCT, the
 *   helper opens this app's Materials page and posts each file to it, tab to
 *   tab, with `postMessage`. The files are read on HuskyCT's side because only
 *   that page has HuskyCT's session; this app never talks to HuskyCT itself.
 * - **Imported from a folder** the helper saved them into, for a browser where
 *   the tabs cannot reach each other, or files saved before this existed.
 *
 * What the helper sends is untrusted input from another origin, so every
 * message is checked here — its origin, its shape, its sizes — before anything
 * is stored, and a message that does not fit is dropped whole.
 */

/** Bumped only if the messages change shape; both sides check it. */
export const MATERIALS_PROTOCOL = "betterhuskyct/materials@1";

/** The only pages allowed to send materials: HuskyCT's own. */
export const HUSKYCT_ORIGINS: ReadonlySet<string> = new Set(["https://lms.uconn.edu", "https://huskyct.uconn.edu"]);

const MAX_COURSES = 60;
const MAX_ITEMS_PER_COURSE = 3000;
const MAX_TEXT = 400;
const MAX_PATH_DEPTH = 12;
const MAX_FILE_BYTES = 512 * 1024 * 1024;

export type MaterialFileRef = {
  /** HuskyCT's address for the file (or `folder:` + its path, when imported). */
  key: string;
  path: string[];
  title: string;
};

export type MaterialLink = { path: string[]; title: string; url: string; kind: "video" | "link" };

/**
 * Something that only opens from HuskyCT: an LTI tool, a publisher's homework.
 * `url` is HuskyCT's launch address for it, when the helper could read one;
 * without it the tool links to its course's content page.
 */
export type MaterialTool = { path: string[]; title: string; url?: string };

export type MaterialsCourse = {
  /** HuskyCT's course id when known, so a tool can link back to its course. */
  id: string;
  code: string | null;
  files: MaterialFileRef[];
  links: MaterialLink[];
  tools: MaterialTool[];
};

export type MaterialsIndex = {
  version: 1;
  term: string | null;
  updatedAt: string;
  courses: MaterialsCourse[];
};

export type StoredFile = {
  key: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  savedAt: string;
};

export type IncomingMessage =
  | { kind: "hello" }
  | { kind: "index"; index: MaterialsIndex; sending: number }
  | { kind: "file"; key: string; name: string; type: string; blob: Blob }
  | { kind: "done"; complete: boolean };

// --- checking what arrives -------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, limit = MAX_TEXT): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= limit ? value : null;
}

function path(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_PATH_DEPTH) return null;
  const parts = value.map((part) => text(part));
  return parts.every((part): part is string => part !== null) ? parts : null;
}

/** A file's key: HuskyCT's own file address, or one made up for a folder import. */
export function isMaterialKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 1000 &&
    (/^https:\/\/(lms|huskyct)\.uconn\.edu\/bbcswebdav\/[\w\-./%]+$/.test(value) || /^folder:[^\u0000]{1,900}$/.test(value))
  );
}

function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const TOOL_LAUNCH_PATH = "/webapps/blackboard/execute/blti/launchLink";

/**
 * Blackboard's launch address for an LTI tool on HuskyCT — the one address a
 * tool may carry, so a tool never becomes a link to somewhere else.
 */
export function isToolLaunchUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return (
      HUSKYCT_ORIGINS.has(url.origin) &&
      url.pathname === TOOL_LAUNCH_PATH &&
      /^_\d+_\d+$/.test(url.searchParams.get("course_id") ?? "") &&
      /^_\d+_\d+$/.test(url.searchParams.get("content_id") ?? "")
    );
  } catch {
    return false;
  }
}

function list<T>(value: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS_PER_COURSE) return null;
  const items: T[] = [];
  for (const item of value) {
    const parsed = read(item);
    if (parsed === null) return null;
    items.push(parsed);
  }
  return items;
}

function readCourse(value: unknown): MaterialsCourse | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 100);
  const code = value.code === null ? null : text(value.code, 40);
  if (!id || (value.code !== null && code === null)) return null;

  const files = list(value.files, (item) => {
    if (!isRecord(item)) return null;
    const title = text(item.title);
    const at = path(item.path);
    return isMaterialKey(item.key) && title && at ? { key: item.key, path: at, title } : null;
  });
  const links = list(value.links, (item): MaterialLink | null => {
    if (!isRecord(item)) return null;
    const title = text(item.title);
    const at = path(item.path);
    const kind = item.kind === "video" ? "video" : item.kind === "link" ? "link" : null;
    return title && at && kind && isWebUrl(item.url) ? { path: at, title, url: item.url, kind } : null;
  });
  const tools = list(value.tools, (item) => {
    if (!isRecord(item)) return null;
    const title = text(item.title);
    const at = path(item.path);
    if (!title || !at) return null;
    return item.url !== undefined && isToolLaunchUrl(item.url) ? { path: at, title, url: item.url } : { path: at, title };
  });
  if (!files || !links || !tools) return null;
  return { id, code, files, links, tools };
}

export function parseMaterialsIndex(value: unknown): MaterialsIndex | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (!Array.isArray(value.courses) || value.courses.length > MAX_COURSES) return null;
  const courses: MaterialsCourse[] = [];
  for (const course of value.courses) {
    const parsed = readCourse(course);
    if (!parsed) return null;
    courses.push(parsed);
  }
  const term = value.term === null ? null : text(value.term, 60);
  if (value.term !== null && term === null) return null;
  const updatedAt = text(value.updatedAt, 40);
  if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) return null;
  return { version: 1, term, updatedAt, courses };
}

/**
 * A message from the helper, or null. Strict: a message that is not exactly
 * one of the four kinds, carrying exactly the right fields, is ignored.
 */
export function parseMaterialsMessage(data: unknown): IncomingMessage | null {
  if (!isRecord(data) || data.protocol !== MATERIALS_PROTOCOL) return null;
  switch (data.kind) {
    case "hello":
      return { kind: "hello" };
    case "index": {
      const index = parseMaterialsIndex(data.index);
      const sending = typeof data.sending === "number" && Number.isInteger(data.sending) && data.sending >= 0 ? data.sending : null;
      return index && sending !== null ? { kind: "index", index, sending } : null;
    }
    case "file": {
      const name = text(data.name, 255);
      const type = typeof data.type === "string" && data.type.length <= 200 ? data.type : null;
      const blob = data.blob;
      if (!isMaterialKey(data.key) || !name || type === null) return null;
      if (typeof Blob === "undefined" || !(blob instanceof Blob) || blob.size > MAX_FILE_BYTES) return null;
      return { kind: "file", key: data.key, name, type, blob };
    }
    case "done":
      return typeof data.complete === "boolean" ? { kind: "done", complete: data.complete } : null;
    default:
      return null;
  }
}

// --- the store ---------------------------------------------------------------------

/** Where files and the index live. IndexedDB in the page; memory in tests. */
export type MaterialsStore = {
  keys(): Promise<string[]>;
  files(): Promise<StoredFile[]>;
  getFile(key: string): Promise<StoredFile | null>;
  putFile(file: StoredFile): Promise<void>;
  deleteFile(key: string): Promise<void>;
  getIndex(): Promise<MaterialsIndex | null>;
  putIndex(index: MaterialsIndex): Promise<void>;
  clear(): Promise<void>;
};

/**
 * A newer walk's courses replace the same courses in the stored index; courses
 * it did not reach are kept. A walk stopped halfway, or a folder holding one
 * course, never empties the others.
 */
export function mergeMaterialsIndex(current: MaterialsIndex | null, incoming: MaterialsIndex): MaterialsIndex {
  const incomingKeys = new Set(incoming.courses.map(courseKey));
  const kept = (current?.courses ?? []).filter((course) => !incomingKeys.has(courseKey(course)));
  return {
    version: 1,
    term: incoming.term ?? current?.term ?? null,
    updatedAt: incoming.updatedAt,
    courses: [...incoming.courses, ...kept].sort((a, b) => (a.code ?? a.id).localeCompare(b.code ?? b.id)),
  };
}

/** A course is the same course by its code when it has one, else by its id. */
function courseKey(course: MaterialsCourse): string {
  return course.code ? "code:" + course.code.toUpperCase() : "id:" + course.id;
}

/** Stored files no course lists any more — removed by the instructor, or superseded. */
export async function pruneMaterials(store: MaterialsStore): Promise<number> {
  const index = await store.getIndex();
  const wanted = new Set((index?.courses ?? []).flatMap((course) => course.files.map((file) => file.key)));
  let removed = 0;
  for (const key of await store.keys()) {
    if (!wanted.has(key)) {
      await store.deleteFile(key);
      removed++;
    }
  }
  return removed;
}

// --- receiving from the helper ------------------------------------------------------

export type ReceiveState = {
  phase: "idle" | "connected" | "receiving" | "done";
  expected: number;
  stored: number;
  failed: number;
};

type Source = { postMessage(message: unknown, targetOrigin: string): void };
export type MaterialsEvent = { origin: string; data: unknown; source: Source | null };

/**
 * Answers the helper, one message at a time. Only HuskyCT's origins are heard,
 * and every reply goes back to the exact origin that asked.
 *
 * `hello` is answered with the keys already stored, so the helper sends only
 * what is new; each file is acknowledged once it is stored, so the helper
 * sends the next only then and neither tab holds a term's files in memory.
 */
export function createMaterialsReceiver(options: {
  store: MaterialsStore;
  now?: () => Date;
  onChange?: (state: ReceiveState) => void;
}) {
  const now = options.now ?? (() => new Date());
  let state: ReceiveState = { phase: "idle", expected: 0, stored: 0, failed: 0 };
  const update = (patch: Partial<ReceiveState>) => {
    state = { ...state, ...patch };
    options.onChange?.(state);
  };

  return async function receive(event: MaterialsEvent): Promise<void> {
    if (!HUSKYCT_ORIGINS.has(event.origin) || !event.source) return;
    const message = parseMaterialsMessage(event.data);
    if (!message) return;
    const source = event.source;
    const reply = (payload: Record<string, unknown>) =>
      source.postMessage({ protocol: MATERIALS_PROTOCOL, ...payload }, event.origin);

    switch (message.kind) {
      case "hello":
        reply({ kind: "ready", have: await options.store.keys() });
        if (state.phase === "idle" || state.phase === "done") update({ phase: "connected", expected: 0, stored: 0, failed: 0 });
        return;
      case "index":
        await options.store.putIndex(mergeMaterialsIndex(await options.store.getIndex(), message.index));
        update({ phase: "receiving", expected: message.sending, stored: 0, failed: 0 });
        return;
      case "file":
        try {
          await options.store.putFile({
            key: message.key,
            name: message.name,
            type: message.type,
            size: message.blob.size,
            blob: message.blob,
            savedAt: now().toISOString(),
          });
          reply({ kind: "stored", key: message.key, ok: true });
          update({ stored: state.stored + 1 });
        } catch {
          reply({ kind: "stored", key: message.key, ok: false });
          update({ failed: state.failed + 1 });
        }
        return;
      case "done":
        if (message.complete) await pruneMaterials(options.store);
        update({ phase: "done" });
        return;
    }
  };
}

// --- showing ------------------------------------------------------------------------------

export type FolderNode<T> = {
  name: string;
  path: string[];
  /** The files directly in this folder. */
  items: T[];
  children: FolderNode<T>[];
  /** Every file in this folder and the folders under it. */
  total: number;
};

/**
 * A course's files as a folder tree, in the course's own order. A flat list
 * repeats every parent — "Weekly Lectures, Problem-Solving Tips and HW Links /
 * Week 1 - Section 4.1" — on every line; a tree names each folder once.
 */
export function folderTree<T extends { path: string[] }>(items: T[]): FolderNode<T> {
  const root: FolderNode<T> = { name: "", path: [], items: [], children: [], total: 0 };
  for (const item of items) {
    let node = root;
    node.total++;
    item.path.forEach((name, depth) => {
      let child = node.children.find((candidate) => candidate.name === name);
      if (!child) {
        child = { name, path: item.path.slice(0, depth + 1), items: [], children: [], total: 0 };
        node.children.push(child);
      }
      child.total++;
      node = child;
    });
    node.items.push(item);
  }
  return root;
}

/** Every folder under a node, the node's own children first. */
export function foldersIn<T>(node: FolderNode<T>): FolderNode<T>[] {
  return node.children.flatMap((child) => [child, ...foldersIn(child)]);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** HuskyCT's page for a course, when its id is HuskyCT's. */
export function huskyctCourseUrl(course: MaterialsCourse): string | null {
  return /^_\d+_\d+$/.test(course.id) ? `https://lms.uconn.edu/ultra/courses/${course.id}/outline` : null;
}
