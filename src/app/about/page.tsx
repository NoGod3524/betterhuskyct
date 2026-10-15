import type { Metadata } from "next";

import { AboutSection } from "@/components/about-section";

export const metadata: Metadata = {
  title: "About · BetterHuskyCT",
  description: "What BetterHuskyCT promises and what it does not: free, open source, and your data stays in your browser.",
};

export default function AboutPage() {
  return <AboutSection />;
}
