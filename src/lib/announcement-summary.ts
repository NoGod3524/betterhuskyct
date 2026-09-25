import type { Announcement } from "./announcements.ts";

/**
 * Summarising a course's announcements with the browser's own model.
 *
 * Chrome's Summarizer API runs Gemini Nano on the device: no key, no server, and
 * — per Chrome's documentation — "no data is sent to Google or any third party".
 * That is the only way to add summaries without breaking what the app promises
 * about announcements: they arrive from the helper and never leave the browser.
 *
 * The cost of that choice is reach. It exists in desktop Chrome and Edge 138+
 * on machines with enough storage and memory, and nowhere else — so everything
 * here reports what is possible rather than assuming it.
 *
 * The API is taken as a parameter rather than read from `globalThis`, so the
 * whole flow can be tested with a stand-in model.
 */

/** Where summaries can run, from "never here" to "ready now". */
export type SummaryAvailability =
  | "unsupported" // no Summarizer API in this browser at all
  | "unavailable" // the API exists, but this device or language cannot use it
  | "downloadable" // usable after a one-time model download
  | "downloading"
  | "available";

type ModelAvailability = "unavailable" | "downloadable" | "downloading" | "available";

/** The options this module passes; the API accepts more. */
export type SummarizerOptions = {
  type: "key-points";
  format: "plain-text";
  length: "medium";
  expectedInputLanguages: string[];
  expectedContextLanguages: string[];
  outputLanguage: string;
  sharedContext?: string;
  monitor?: (monitor: EventTarget) => void;
};

/** The members of a created summarizer this module uses. */
export type SummarizerModel = {
  readonly inputQuota: number;
  summarize(input: string, options?: { context?: string }): Promise<string>;
  measureInputUsage(input: string, options?: { context?: string }): Promise<number>;
  destroy(): void;
};

/** `Summarizer` itself — not yet in TypeScript's DOM library. */
export type SummarizerApi = {
  availability(options?: Partial<SummarizerOptions>): Promise<ModelAvailability>;
  create(options?: SummarizerOptions): Promise<SummarizerModel>;
};

/**
 * The model only reads and writes a few languages, and Chinese is not one of
 * them yet. Announcements at UConn are English, so input is English; the
 * summary is English too, whatever language the app is showing.
 */
const LANGUAGES: Pick<
  SummarizerOptions,
  "expectedInputLanguages" | "expectedContextLanguages" | "outputLanguage"
> = {
  expectedInputLanguages: ["en"],
  expectedContextLanguages: ["en"],
  outputLanguage: "en",
};

const SHARED_CONTEXT =
  "Announcements an instructor posted to one university course, newest first. " +
  "The reader is a student in that course who wants what they must do or know: " +
  "deadlines and due-date changes, exam dates and rooms, cancelled or moved classes, " +
  "and anything they are asked to prepare or submit.";

export function summarizerFrom(host: object): SummarizerApi | null {
  const candidate = (host as { Summarizer?: unknown }).Summarizer;
  if (!candidate || (typeof candidate !== "function" && typeof candidate !== "object")) {
    return null;
  }
  const api = candidate as Partial<SummarizerApi>;
  return typeof api.availability === "function" && typeof api.create === "function"
    ? (api as SummarizerApi)
    : null;
}

export async function summaryAvailability(api: SummarizerApi | null): Promise<SummaryAvailability> {
  if (!api) return "unsupported";
  try {
    return await api.availability({ type: "key-points", format: "plain-text", length: "medium", ...LANGUAGES });
  } catch {
    // A browser that ships the API but throws when asked is, for the reader, a
    // browser where it does not work.
    return "unavailable";
  }
}

/** One announcement as the model reads it. */
function announcementText(announcement: Announcement): string {
  return [
    announcement.title,
    announcement.posted ? `(${announcement.posted})` : null,
    announcement.body || null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Newest first, so a cut made to fit the model drops the oldest news. */
export function newestFirst(announcements: Announcement[]): Announcement[] {
  return [...announcements].sort((left, right) =>
    left.announced === right.announced ? 0 : left.announced < right.announced ? 1 : -1,
  );
}

export function summaryInput(announcements: Announcement[]): string {
  return announcements.map(announcementText).join("\n\n---\n\n");
}

/** Why a summary could not be made. The caller owns the wording. */
export type SummaryProblem = "unavailable" | "too-long" | "failed";

export class SummaryError extends Error {
  readonly problem: SummaryProblem;

  constructor(problem: SummaryProblem) {
    super(problem);
    this.name = "SummaryError";
    this.problem = problem;
  }
}

export type CourseSummary = {
  text: string;
  /** How many announcements, newest first, the summary read. */
  included: number;
  /** Older ones left out because the model's input quota was full. */
  omitted: number;
};

/**
 * The longest newest-first run of announcements the model will accept.
 *
 * Measured with the model's own counter rather than guessed from characters:
 * the quota is in the model's units, and it differs between devices.
 */
async function fitToQuota(
  model: SummarizerModel,
  announcements: Announcement[],
  context: string,
): Promise<Announcement[]> {
  let included = announcements;
  while (included.length > 0) {
    const usage = await model.measureInputUsage(summaryInput(included), { context });
    if (usage <= model.inputQuota) return included;
    // Dropping one at a time is fine at this scale: a course has tens of
    // announcements, and each measurement is local.
    included = included.slice(0, -1);
  }
  return included;
}

/**
 * Summarises one course's announcements into key points.
 *
 * Call it straight from a click: when the model still has to be downloaded,
 * Chrome only allows that in response to the user, so nothing is awaited before
 * `create`.
 */
export async function summarizeCourse(
  api: SummarizerApi,
  announcements: Announcement[],
  options: { courseLabel: string; onDownloadProgress?: (fraction: number) => void },
): Promise<CourseSummary> {
  let model: SummarizerModel;
  try {
    model = await api.create({
      type: "key-points",
      format: "plain-text",
      length: "medium",
      ...LANGUAGES,
      sharedContext: SHARED_CONTEXT,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          const loaded = (event as Event & { loaded?: number }).loaded;
          if (typeof loaded === "number") options.onDownloadProgress?.(Math.min(1, Math.max(0, loaded)));
        });
      },
    });
  } catch {
    throw new SummaryError("unavailable");
  }

  try {
    const context = `Course: ${options.courseLabel}`;
    const ordered = newestFirst(announcements);
    const included = await fitToQuota(model, ordered, context);
    if (included.length === 0) throw new SummaryError("too-long");

    const text = (await model.summarize(summaryInput(included), { context })).trim();
    if (!text) throw new SummaryError("failed");

    return { text, included: included.length, omitted: ordered.length - included.length };
  } catch (error) {
    throw error instanceof SummaryError ? error : new SummaryError("failed");
  } finally {
    model.destroy();
  }
}

/**
 * What a summary was made from, so a stored one is reused only while the
 * course's announcements are still the same.
 */
export function summarySignature(announcements: Announcement[]): string {
  return announcements
    .map((announcement) => announcement.id)
    .sort()
    .join("|");
}
