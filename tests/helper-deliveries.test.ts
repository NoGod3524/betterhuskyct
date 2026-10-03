import assert from "node:assert/strict";
import { after, test } from "node:test";

import { GRADES_PROTOCOL, memoryGradesStore } from "../src/lib/grades.ts";
import { memoryMaterialsStore } from "../src/lib/materials.ts";
import { installDom } from "./support/dom.ts";

/**
 * The receivers live in the shell, so a delivery must land even when no Grades
 * or Materials page is open: that is where a "Collect everything" press can
 * find the student.
 */
const dom = installDom();
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { HelperDeliveries, DELIVERY_EVENT } = await import("../src/components/helper-deliveries.tsx");

const { window } = dom;
after(() => dom.uninstall());

const READING = {
  version: 1 as const,
  term: "Fall 2026",
  takenAt: "2026-09-28T18:00:00.000Z",
  courses: [{ id: "_203765_1", code: "MATH 1070Q", items: [] }],
};

test("a grades delivery is stored and announced with no Grades page open", async () => {
  const store = memoryGradesStore();
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () =>
    root.render(
      createElement(HelperDeliveries, {
        openGrades: async () => store,
        openMaterials: async () => memoryMaterialsStore(),
      }),
    ),
  );

  const announced: unknown[] = [];
  // `unknown`: the page's window has its own Event class, not the global one.
  const onDelivery = (event: unknown): void => {
    announced.push((event as CustomEvent).detail);
  };
  window.addEventListener(DELIVERY_EVENT, onDelivery);

  const replies: unknown[] = [];
  await act(async () => {
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: { protocol: GRADES_PROTOCOL, kind: "grades", grades: READING },
        origin: "https://lms.uconn.edu",
        source: { postMessage: (reply: unknown) => replies.push(reply) } as never,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  window.removeEventListener(DELIVERY_EVENT, onDelivery);
  assert.deepEqual(replies, [{ protocol: GRADES_PROTOCOL, kind: "stored", ok: true }]);
  assert.equal((await store.get())?.courses[0]?.code, "MATH 1070Q");
  assert.ok(announced.some((detail) => (detail as { kind: string }).kind === "grades"));
  await act(async () => root.unmount());
});
