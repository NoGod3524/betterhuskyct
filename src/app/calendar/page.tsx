import type { Metadata } from "next";

import { ConnectSection } from "@/components/connect-section";

export const metadata: Metadata = {
  title: "Import calendar · BetterHuskyCT",
  description: "Connect your HuskyCT / Blackboard ICS calendar feed.",
};

export default function CalendarPage() {
  return <ConnectSection />;
}
