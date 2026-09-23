import type { Metadata } from "next";

import { AnnouncementsSection } from "@/components/announcements-section";

export const metadata: Metadata = {
  title: "Announcements · BetterHuskyCT",
  description:
    "What your HuskyCT course pages have said, newest first, collected by the browser helper.",
};

export default function AnnouncementsPage() {
  return <AnnouncementsSection />;
}
