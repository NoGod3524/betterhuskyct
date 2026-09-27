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
  return {
    text: () => container.textContent ?? "",
    unmount: () => act(async () => root.unmount()),
  };
}

test("stored materials are listed by course and folder, with what has not arrived marked", async () => {
  const view = await render(await seeded());
  const text = view.text();

  assert.ok(text.includes("MATH 1070Q"));
  assert.ok(text.includes("Week 1 - Section 4.1"));
  assert.ok(text.includes("Section 4.1 PDF.pdf"));
  assert.ok(text.includes("1.6 MB"), "the stored file's size is missing");
  assert.ok(text.includes(t("en", "materials.missing")), "a file not yet received is not marked");
  assert.ok(text.includes("Section 4.1 - Lecture"));
  assert.ok(text.includes("Cengage WebAssign"));
  assert.ok(text.includes(t("en", "materials.summary", { received: 1, files: 2 })));
  await view.unmount();
});

test("with nothing stored, the page says how to get materials here", async () => {
  const view = await render(null);
  assert.ok(view.text().includes(t("en", "materials.emptyTitle")));
  await view.unmount();
});
