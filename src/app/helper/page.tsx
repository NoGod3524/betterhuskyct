import type { Metadata } from "next";

import { HelperSection } from "@/components/helper-section";

export const metadata: Metadata = {
  title: "Helper · BetterHuskyCT",
  description:
    "Install the browser helper and send your HuskyCT deadlines straight to this dashboard — no file to download and nothing to import.",
};

export default function HelperPage() {
  return <HelperSection />;
}
