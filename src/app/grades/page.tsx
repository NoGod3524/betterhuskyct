import type { Metadata } from "next";

import { GradesSection } from "@/components/grades-section";

export const metadata: Metadata = {
  title: "Grades · BetterHuskyCT",
  description: "Each course's gradebook and the points so far, kept in this browser and delivered by the browser helper.",
};

export default function GradesPage() {
  return <GradesSection />;
}
