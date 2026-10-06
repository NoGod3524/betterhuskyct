"use client";

import { useEffect } from "react";

import { helperMessage } from "@/lib/helper-bridge";
import { createGradesReceiver, type GradesReceiveState, type GradesStore } from "@/lib/grades";
import { openGradesStore } from "@/lib/grades-store";
import { createMaterialsReceiver, type MaterialsStore, type ReceiveState } from "@/lib/materials";
import { openMaterialsStore } from "@/lib/materials-store";

/** Fired on the window whenever a delivery moves, so an open page can refresh its list. */
export const DELIVERY_EVENT = "betterhuskyct:delivery";

export type DeliveryDetail = { kind: "grades"; state: GradesReceiveState } | { kind: "materials"; state: ReceiveState };

function announce(detail: DeliveryDetail) {
  // `window.CustomEvent`, not the bare one: a page's own window is the one that dispatches.
  window.dispatchEvent(new window.CustomEvent<DeliveryDetail>(DELIVERY_EVENT, { detail }));
}

/**
 * Listens for the helper's gradebooks and course files on every page, not
 * only on the Grades and Materials pages.
 *
 * A "Collect everything" press sends its results from whatever page the
 * student is on, and a page that is not mounted cannot answer. So the receivers
 * live here, in the shell, and write to the same stores the pages read; a page
 * that is open hears the change through `DELIVERY_EVENT` and refreshes.
 */
export function HelperDeliveries({
  openGrades = openGradesStore,
  openMaterials = openMaterialsStore,
}: {
  openGrades?: () => Promise<GradesStore>;
  openMaterials?: () => Promise<MaterialsStore>;
}) {
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;

    Promise.all([openGrades(), openMaterials()])
      .then(([gradesStore, materialsStore]) => {
        if (cancelled) return;
        const receiveGrades = createGradesReceiver({
          store: gradesStore,
          onChange: (state) => announce({ kind: "grades", state }),
        });
        const receiveMaterials = createMaterialsReceiver({
          store: materialsStore,
          onChange: (state) => {
            // Asked once, when the files start to arrive: a store the browser
            // may clear under pressure is no place to keep a term's files.
            if (state.phase === "receiving") navigator.storage?.persist?.().catch(() => undefined);
            announce({ kind: "materials", state });
          },
        });
        const listener = (event: MessageEvent) => {
          // From HuskyCT directly, or through the helper's bridge from a tab behind this one.
          const { origin, data, source } = helperMessage(event, window);
          // Each receiver answers only its own protocol, so both can hear every message.
          void receiveGrades({ origin, data, source: source as Window | null });
          void receiveMaterials({ origin, data, source: source as Window | null });
        };
        window.addEventListener("message", listener);
        stop = () => window.removeEventListener("message", listener);
      })
      .catch(() => undefined); // no storage here: the pages say so on their own

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [openGrades, openMaterials]);

  return null;
}
