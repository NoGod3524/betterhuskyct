import type { Metadata } from "next";

import { PlanSection } from "@/components/plan-section";

export const metadata: Metadata = {
  title: "Plan · BetterHuskyCT",
  description:
    "What to work on next, and which deadlines no longer fit in the days remaining.",
};

export default function PlanPage() {
  return <PlanSection />;
}
