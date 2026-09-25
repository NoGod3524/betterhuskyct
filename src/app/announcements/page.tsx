import type { Metadata } from "next";

import { AnnouncementsSection } from "@/components/announcements-section";
import { providersFromEnv } from "@/lib/summary-models";

export const metadata: Metadata = {
  title: "Announcements · BetterHuskyCT",
  description:
    "What your HuskyCT course pages have said, newest first, collected by the browser helper.",
};

export default function AnnouncementsPage() {
  // Read on the server, where the keys live; only whether any exists reaches
  // the page. Without one there is no summary button to fail. The page is
  // prerendered, so adding a key takes effect on the next deploy.
  return <AnnouncementsSection summariesEnabled={providersFromEnv(process.env).length > 0} />;
}
