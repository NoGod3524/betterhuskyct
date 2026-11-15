import type { Metadata } from "next";

import { CoursesSection } from "@/components/courses-section";

export const metadata: Metadata = {
  title: "Courses · BetterHuskyCT",
  description: "Every course, with what is new and what is due next in each.",
};

export default function CoursesPage() {
  return <CoursesSection />;
}
