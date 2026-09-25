import assert from "node:assert/strict";
import test from "node:test";

import {
  SummaryError,
  newestFirst,
  summarizeCourse,
  summarizerFrom,
  summaryAvailability,
  summarySignature,
  type SummarizerApi,
  type SummarizerOptions,
} from "../src/lib/announcement-summary.ts";
import type { Announcement } from "../src/lib/announcements.ts";

function announcement(n: number, patch: Partial<Announcement> = {}): Announcement {
  return {
    id: `a${n}`,
    courseId: "course-1",
    courseCode: "MATH 1070Q",
    title: `Announcement ${n}`,
    body: `Body of announcement ${n}.`,
    posted: `Posted on 9/${n}/26`,
    // Later n = newer.
    announced: new Date(Date.UTC(2026, 8, n)).toISOString(),
    ...patch,
  };
}

/**
 * A stand-in for Chrome's `Summarizer`. Usage is measured by a function the test
 * picks, so the quota can be made to bite exactly where a test wants it to.
 */
function fakeSummarizer(
  options: {
    availability?: Awaited<ReturnType<SummarizerApi["availability"]>>;
    quota?: number;
    usage?: (input: string) => number;
    output?: string;
    createFails?: boolean;
    summarizeFails?: boolean;
    progress?: number[];
  } = {},
) {
  const calls = {
    availability: [] as Array<Partial<SummarizerOptions> | undefined>,
    create: [] as SummarizerOptions[],
    summarize: [] as Array<{ input: string; context?: string }>,
    destroyed: 0,
  };

  const api: SummarizerApi = {
    async availability(requested) {
      calls.availability.push(requested);
      return options.availability ?? "available";
    },
    async create(requested) {
      assert.ok(requested, "create was called without options");
      calls.create.push(requested);
      if (options.createFails) throw new Error("NotAllowedError");

      const monitor = new EventTarget();
      requested.monitor?.(monitor);
      for (const loaded of options.progress ?? []) {
        monitor.dispatchEvent(Object.assign(new Event("downloadprogress"), { loaded }));
      }

      return {
        inputQuota: options.quota ?? 10_000,
        async measureInputUsage(input) {
          return (options.usage ?? ((text: string) => text.length))(input);
        },
        async summarize(input, summarizeOptions) {
          calls.summarize.push({ input, context: summarizeOptions?.context });
          if (options.summarizeFails) throw new Error("the model gave up");
          return options.output ?? "* The midterm moves to October 14.";
        },
        destroy() {
          calls.destroyed += 1;
        },
      };
    },
  };

  return { api, calls };
}

test("no Summarizer in the browser means unsupported, not an error", async () => {
  assert.equal(summarizerFrom({}), null);
  assert.equal(summarizerFrom({ Summarizer: {} }), null, "an object without the API's methods is not the API");
  assert.equal(await summaryAvailability(null), "unsupported");
});

test("availability is asked for the English summaries this app makes", async () => {
  const { api, calls } = fakeSummarizer({ availability: "downloadable" });

  assert.equal(summarizerFrom({ Summarizer: api }), api);
  assert.equal(await summaryAvailability(api), "downloadable");
  assert.equal(calls.availability[0]?.outputLanguage, "en");
  assert.deepEqual(calls.availability[0]?.expectedInputLanguages, ["en"]);
});

test("a browser whose availability check throws counts as unavailable", async () => {
  const api: SummarizerApi = {
    async availability() {
      throw new Error("NotSupportedError");
    },
    async create() {
      throw new Error("unreachable");
    },
  };

  assert.equal(await summaryAvailability(api), "unavailable");
});

test("a course's announcements are summarised newest first, with the course as context", async () => {
  const { api, calls } = fakeSummarizer();
  // Given oldest first, as nothing guarantees the caller's order.
  const summary = await summarizeCourse(api, [announcement(1), announcement(3), announcement(2)], {
    courseLabel: "MATH 1070Q",
  });

  assert.deepEqual(summary, { text: "* The midterm moves to October 14.", included: 3, omitted: 0 });

  const { input, context } = calls.summarize[0];
  assert.ok(
    input.indexOf("Announcement 3") < input.indexOf("Announcement 2") &&
      input.indexOf("Announcement 2") < input.indexOf("Announcement 1"),
    "announcements were not given newest first",
  );
  assert.ok(input.includes("Posted on 9/3/26") && input.includes("Body of announcement 3."));
  assert.equal(context, "Course: MATH 1070Q");

  const created = calls.create[0];
  assert.equal(created.type, "key-points");
  assert.equal(created.format, "plain-text", "markdown would need rendering; plain text is shown as text");
  assert.equal(created.outputLanguage, "en");
  assert.match(created.sharedContext ?? "", /deadline/i);
  assert.equal(calls.destroyed, 1, "the model was not released");
});

test("when the quota is full, the oldest announcements are the ones left out", async () => {
  // Each announcement costs 100 units; the quota holds two.
  const { api, calls } = fakeSummarizer({
    quota: 250,
    usage: (input) => (input.match(/Announcement \d/g) ?? []).length * 100,
  });

  const summary = await summarizeCourse(api, [1, 2, 3, 4, 5].map((n) => announcement(n)), {
    courseLabel: "MATH 1070Q",
  });

  assert.equal(summary.included, 2);
  assert.equal(summary.omitted, 3);
  const { input } = calls.summarize[0];
  assert.ok(input.includes("Announcement 5") && input.includes("Announcement 4"));
  assert.ok(!input.includes("Announcement 3"), "an older announcement was kept over a newer one");
});

test("if not even the newest announcement fits, it says so rather than summarising nothing", async () => {
  const { api, calls } = fakeSummarizer({ quota: 10, usage: () => 1_000 });

  await assert.rejects(
    summarizeCourse(api, [announcement(1)], { courseLabel: "MATH 1070Q" }),
    (error) => error instanceof SummaryError && error.problem === "too-long",
  );
  assert.equal(calls.summarize.length, 0);
  assert.equal(calls.destroyed, 1, "the model was not released after the failure");
});

test("a model that cannot be created is reported as unavailable", async () => {
  const { api } = fakeSummarizer({ createFails: true });

  await assert.rejects(
    summarizeCourse(api, [announcement(1)], { courseLabel: "MATH 1070Q" }),
    (error) => error instanceof SummaryError && error.problem === "unavailable",
  );
});

test("a failed or empty summary is reported as failed, and the model is still released", async () => {
  for (const options of [{ summarizeFails: true }, { output: "   " }]) {
    const { api, calls } = fakeSummarizer(options);
    await assert.rejects(
      summarizeCourse(api, [announcement(1)], { courseLabel: "MATH 1070Q" }),
      (error) => error instanceof SummaryError && error.problem === "failed",
    );
    assert.equal(calls.destroyed, 1);
  }
});

test("download progress is passed on as a fraction", async () => {
  const { api } = fakeSummarizer({ availability: "downloadable", progress: [0.25, 0.8, 1.5] });
  const seen: number[] = [];

  await summarizeCourse(api, [announcement(1)], {
    courseLabel: "MATH 1070Q",
    onDownloadProgress: (fraction) => seen.push(fraction),
  });

  assert.deepEqual(seen, [0.25, 0.8, 1], "progress past 1 should be clamped");
});

test("a summary's signature changes when the course gains an announcement, not when order changes", () => {
  const two = [announcement(1), announcement(2)];

  assert.equal(summarySignature(two), summarySignature([...two].reverse()));
  assert.notEqual(summarySignature(two), summarySignature([...two, announcement(3)]));
  assert.deepEqual(
    newestFirst(two).map((entry) => entry.id),
    ["a2", "a1"],
  );
});
