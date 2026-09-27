import type { Metadata } from "next";

import { MaterialsSection } from "@/components/materials-section";

export const metadata: Metadata = {
  title: "Materials · BetterHuskyCT",
  description: "Every course's files, videos and links, kept in this browser and delivered by the browser helper.",
};

export default function MaterialsPage() {
  return <MaterialsSection />;
}
