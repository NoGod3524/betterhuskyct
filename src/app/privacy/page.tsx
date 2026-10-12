import type { Metadata } from "next";

import { PrivacySection } from "@/components/privacy-section";

export const metadata: Metadata = {
  title: "Privacy · BetterHuskyCT",
  description: "What the BetterHuskyCT helper reads, what it never does, and where the data goes.",
};

export default function PrivacyPage() {
  return <PrivacySection />;
}
