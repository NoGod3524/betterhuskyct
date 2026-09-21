import type { Metadata } from "next";

import { InsightsSection } from "@/components/insights-section";

export const metadata: Metadata = {
  title: "Insights · BetterHuskyCT",
  description: "Completion rate, workload by course, and the next 4 weeks at a glance.",
};

export default function InsightsPage() {
  return <InsightsSection />;
}
