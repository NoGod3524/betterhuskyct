import type { Metadata } from "next";

import { ChangesSection } from "@/components/changes-section";

export const metadata: Metadata = {
  title: "Changes · BetterHuskyCT",
  description: "Recent changes to your HuskyCT grades, announcements, deadlines and course files.",
};

export default function ChangesPage() {
  return <ChangesSection />;
}
