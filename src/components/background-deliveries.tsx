"use client";

import { useEffect, useRef } from "react";
import { useCalendar } from "@/components/calendar-provider";
import { DELIVERY_EVENT } from "@/components/helper-deliveries";
import { BACKGROUND_CHANGED, BACKGROUND_PROTOCOL, parseBackgroundOffer } from "@/lib/background-sync";
import { openGradesStore } from "@/lib/grades-store";
import { openMaterialsStore } from "@/lib/materials-store";
import type { GradesStore } from "@/lib/grades";
import type { MaterialsStore } from "@/lib/materials";

/** An offer is acknowledged only after all of its successful sources have been saved. */
export function BackgroundDeliveries({ openGrades = openGradesStore, openMaterials = openMaterialsStore }: {
  openGrades?: () => Promise<GradesStore>;
  openMaterials?: () => Promise<MaterialsStore>;
}) {
  const { applyBackgroundPayload } = useCalendar();
  const apply = useRef(applyBackgroundPayload);
  useEffect(() => { apply.current = applyBackgroundPayload; }, [applyBackgroundPayload]);
  useEffect(() => {
    let active = true;
    let saving = false;
    const post = (message: Record<string, unknown>) => window.postMessage({ protocol: BACKGROUND_PROTOCOL, target: "relay", ...message }, window.location.origin);
    const receive = async (event: MessageEvent) => {
      const data = event.data;
      if (saving || event.source !== window || event.origin !== window.location.origin || data?.protocol !== BACKGROUND_PROTOCOL || data.target !== "app" || data.kind !== "offer") return;
      const offer = parseBackgroundOffer(data);
      if (!offer) return;
      saving = true;
      try {
        const { snapshot, changes } = offer;
        await apply.current(snapshot.tasks, changes, snapshot.status);
        if (snapshot.grades) {
          const store = await openGrades();
          if (!store.receiveBackground) throw new Error("Background grades cannot be saved");
          await store.receiveBackground(snapshot.grades, changes, snapshot.status);
          window.dispatchEvent(new window.CustomEvent(DELIVERY_EVENT, { detail: { kind: "grades", state: { phase: "done", courses: snapshot.grades.courses.length, items: snapshot.grades.courses.reduce((total, course) => total + course.items.length, 0) } } }));
        }
        if (snapshot.materials) {
          const store = await openMaterials();
          if (!store.receiveBackground) throw new Error("Background materials cannot be saved");
          await store.receiveBackground(snapshot.materials, changes, snapshot.status);
          window.dispatchEvent(new window.CustomEvent(DELIVERY_EVENT, { detail: { kind: "materials", state: { phase: "done", expected: 0, stored: 0, failed: 0 } } }));
        }
        if (active) {
          post({ kind: "ack", leaseId: offer.leaseId, revision: snapshot.revision });
          window.dispatchEvent(new window.Event(BACKGROUND_CHANGED));
        }
      } catch {
        // The extension retains the lease and cached payload; a focus/ready can replay it safely.
      } finally { saving = false; }
    };
    window.addEventListener("message", receive);
    const ready = () => post({ kind: "ready" });
    ready();
    window.addEventListener("focus", ready);
    return () => {
      active = false;
      window.removeEventListener("message", receive);
      window.removeEventListener("focus", ready);
    };
  }, [openGrades, openMaterials]);
  return null;
}
