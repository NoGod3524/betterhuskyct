import assert from "node:assert/strict";
import { after, test } from "node:test";

import { t } from "../src/lib/i18n.ts";
import { memoryMaterialsStore, type MaterialsStore } from "../src/lib/materials.ts";
import { installDom } from "./support/dom.ts";

/**
 * The Materials page, rendered with the real provider around it and a store in
 * memory in place of IndexedDB.
 */
const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MaterialsSection } = await import("../src/components/materials-section.tsx");
const { CalendarProvider } = await import("../src/components/calendar-provider.tsx");

const { window } = dom;
after(() => dom.uninstall());

const FILE_URL = "https://lms.uconn.edu/bbcswebdav/pid-1-dt-content-rid-1_1/xid-1_1";
const MISSING_URL = "https://lms.uconn.edu/bbcswebdav/pid-2-dt-content-rid-2_1/xid-2_1";

async function seeded(): Promise<MaterialsStore> {
  const store = memoryMaterialsStore();
  await store.putIndex({
    version: 1,
    term: "Fall 2026",
    updatedAt: "2026-09-27T12:00:00.000Z",
    courses: [
      {
        id: "_203765_1",
        code: "MATH 1070Q",
        files: [
          { key: FILE_URL, path: ["Week 1 - Section 4.1"], title: "Section 4.1 PDF.pdf" },
          { key: MISSING_URL, path: [], title: "Syllabus.pdf" },
        ],
        links: [{ path: ["Week 1 - Section 4.1"], title: "Section 4.1 - Lecture", url: "https://www.youtube.com/embed/abc", kind: "video" }],
        tools: [{ path: [], title: "Cengage WebAssign" }],
      },
    ],
  });
  await store.putFile({
    key: FILE_URL,
    name: "Section 4.1 PDF.pdf",
    type: "application/pdf",
    size: 1689443,
    blob: new Blob(["%PDF"]),
    savedAt: "2026-09-27T12:00:00.000Z",
  });
  return store;
}

async function render(store: MaterialsStore | null) {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const openStore = async () => store ?? memoryMaterialsStore();
  await act(async () =>
    root.render(
      createElement(CalendarProvider, {
        initialNow: new Date().toISOString(),
        children: createElement(MaterialsSection, { openStore }),
      }),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label));
  return {
    text: () => container.textContent ?? "",
    click: async (label: string) => {
      const target = button(label);
      assert.ok(target, `no button "${label}"`);
      await act(async () => (target as unknown as HTMLButtonElement).click());
    },
    unmount: () => act(async () => root.unmount()),
  };
}

test("each course starts closed, with a line saying what is in it", async () => {
  window.localStorage.clear();
  const view = await render(await seeded());
  const text = view.text();

  assert.ok(text.includes("MATH 1070Q"));
  assert.ok(text.includes(t("en", "materials.courseSummary", { files: 2, videos: 1, links: 1 })));
  assert.ok(text.includes(t("en", "materials.courseMissing", { count: 1 })));
  assert.ok(!text.includes("Section 4.1 PDF.pdf"), "a closed course showed its files");
  assert.ok(text.includes(t("en", "materials.summary", { received: 1, files: 2 })));
  await view.unmount();
});

test("opening a course shows its own files and its folders; opening a folder shows what is in it", async () => {
  window.localStorage.clear();
  const view = await render(await seeded());

  await view.click("MATH 1070Q" + t("en", "materials.courseSummary", { files: 2, videos: 1, links: 1 }).slice(0, 5));
  // The course's own files are right there, marked when not yet received.
  assert.ok(view.text().includes("Syllabus.pdf"));
  assert.ok(view.text().includes(t("en", "materials.missing")), "a file not yet received is not marked");
  assert.ok(view.text().includes("Week 1 - Section 4.1"));
  assert.ok(!view.text().includes("Section 4.1 PDF.pdf"), "a closed folder showed its files");

  await view.click("Week 1 - Section 4.1");
  assert.ok(view.text().includes("Section 4.1 PDF.pdf"));
  assert.ok(view.text().includes("1.6 MB"), "the stored file's size is missing");
  await view.unmount();
});

test("expand all opens everything, and what is open is remembered", async () => {
  window.localStorage.clear();
  const first = await render(await seeded());
  await first.click(t("en", "materials.expandAll"));
  assert.ok(first.text().includes("Section 4.1 PDF.pdf"));
  assert.ok(first.text().includes("Section 4.1 - Lecture"));
  assert.ok(first.text().includes("Cengage WebAssign"));
  await first.unmount();

  const again = await render(await seeded());
  assert.ok(again.text().includes("Section 4.1 PDF.pdf"), "the open courses were forgotten");
  await again.click(t("en", "materials.collapseAll"));
  assert.ok(!again.text().includes("Section 4.1 PDF.pdf"));
  await again.unmount();
});

test("while the saved courses are being read the page shows placeholders, not the empty state", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const base = await seeded();
  const slow: MaterialsStore = {
    ...base,
    getIndex: async () => {
      await gate;
      return base.getIndex();
    },
  };
  const view = await render(slow);

  assert.ok(view.text().includes(t("en", "common.loading")), "no placeholder while reading");
  assert.ok(!view.text().includes(t("en", "materials.emptyTitle")), "the empty state flashed before the courses arrived");

  await act(async () => {
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  assert.ok(!view.text().includes(t("en", "common.loading")));
  assert.ok(view.text().includes("MATH 1070Q"));
  await view.unmount();
});

test("with nothing stored, the page says how to get materials here", async () => {
  const view = await render(null);
  assert.ok(view.text().includes(t("en", "materials.emptyTitle")));
  await view.unmount();
});
