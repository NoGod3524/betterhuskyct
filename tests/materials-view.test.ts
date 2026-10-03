import assert from "node:assert/strict";
import { after, test } from "node:test";

import { memoryGradesStore } from "../src/lib/grades.ts";
import { t } from "../src/lib/i18n.ts";
import { memoryMaterialsStore, type MaterialsStore } from "../src/lib/materials.ts";
import { installDom } from "./support/dom.ts";

/**
 * The Materials page, rendered with the real provider around it and a store in
 * memory in place of IndexedDB.
 */
const dom = installDom();
const { createElement, act, Fragment } = await import("react");
const { createRoot } = await import("react-dom/client");
const { HelperDeliveries } = await import("../src/components/helper-deliveries.tsx");
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
  // The receivers sit in the shell in the app, so they are mounted here too.
  await act(async () =>
    root.render(
      createElement(CalendarProvider, {
        initialNow: new Date().toISOString(),
        children: createElement(
          Fragment,
          null,
          createElement(HelperDeliveries, { openMaterials: openStore, openGrades: async () => memoryGradesStore() }),
          createElement(MaterialsSection, { openStore }),
        ),
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

// --- getting the files onto the computer ----------------------------------------------------

const browser = window as unknown as { showDirectoryPicker?: unknown };

test("with no file arrived there is nothing to export, so no export buttons", async () => {
  const empty = memoryMaterialsStore();
  await empty.putIndex({
    version: 1,
    term: "Fall 2026",
    updatedAt: "2026-09-27T12:00:00.000Z",
    courses: [{ id: "_1_1", code: "MATH 1070Q", files: [{ key: MISSING_URL, path: [], title: "Syllabus.pdf" }], links: [], tools: [] }],
  });
  const view = await render(empty);

  assert.ok(!view.text().includes(t("en", "materials.exportZip")));
  assert.ok(!view.text().includes(t("en", "materials.exportFolder")));
  await view.unmount();
});

test("a browser that cannot write to a folder is offered the ZIP, and pressing it downloads one", async () => {
  delete browser.showDirectoryPicker;
  const made: Blob[] = [];
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob: Blob) => (made.push(blob), "blob:test");
  URL.revokeObjectURL = () => undefined;
  const clicked: string[] = [];
  const view = await render(await seeded());
  const realClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    clicked.push(this.download);
  };

  assert.ok(!view.text().includes(t("en", "materials.exportFolder")), "a folder button without a folder picker");
  await view.click(t("en", "materials.exportZip"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  window.HTMLAnchorElement.prototype.click = realClick;
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;

  assert.deepEqual(clicked, ["HuskyCT Fall 2026.zip"]);
  assert.equal(made.length, 1);
  assert.equal(made[0].type, "application/zip");
  // The one file that arrived is in it; the page says one listed file did not.
  assert.ok(view.text().includes(t("en", "materials.zipped", { name: "HuskyCT Fall 2026.zip", count: 1 })));
  assert.ok(view.text().includes(t("en", "materials.exportMissing", { count: 1 })));
  await view.unmount();
});

test("a browser that can write to a folder saves there, and says what it did", async () => {
  const written = new Map<string, string>();
  const dir = (path: string): unknown => ({
    kind: "directory",
    name: path || "picked",
    async getDirectoryHandle(name: string) {
      return dir(path + "/" + name);
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const full = path + "/" + name;
      if (!options?.create && !written.has(full)) throw new Error("NotFoundError");
      return {
        kind: "file",
        async getFile() {
          return { size: (written.get(full) ?? "").length };
        },
        async createWritable() {
          let data: Blob | string = "";
          return {
            async write(next: Blob | string) {
              data = next;
            },
            async close() {
              written.set(full, typeof data === "string" ? data : await data.text());
            },
          };
        },
      };
    },
  });
  browser.showDirectoryPicker = async () => dir("");
  const view = await render(await seeded());

  await view.click(t("en", "materials.exportFolder"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  delete browser.showDirectoryPicker;

  assert.deepEqual([...written.keys()].sort(), [
    "/HuskyCT Fall 2026/MATH 1070Q/Week 1 - Section 4.1/Section 4.1 PDF.pdf",
    "/HuskyCT Fall 2026/links and videos.html",
  ]);
  assert.equal(written.get("/HuskyCT Fall 2026/MATH 1070Q/Week 1 - Section 4.1/Section 4.1 PDF.pdf"), "%PDF");
  assert.ok(view.text().includes(t("en", "materials.exported", { saved: 1, skipped: 0, failed: 0, folder: "HuskyCT Fall 2026" })));
  await view.unmount();
});

test("closing the folder picker without choosing leaves the page as it was", async () => {
  browser.showDirectoryPicker = async () => {
    throw new Error("AbortError");
  };
  const view = await render(await seeded());

  await view.click(t("en", "materials.exportFolder"));
  delete browser.showDirectoryPicker;

  assert.ok(view.text().includes(t("en", "materials.exportPick")), "the hint about the Desktop was not shown");
  assert.ok(!view.text().includes(t("en", "materials.exportFailed")));
  await view.unmount();
});
