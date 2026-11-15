import type { Metadata } from "next";

import { SettingsSection } from "@/components/settings-section";

export const metadata: Metadata = {
  title: "Settings · BetterHuskyCT",
  description: "Language, theme, due reminders and syncing for BetterHuskyCT in this browser.",
};

export default function SettingsPage() {
  return <SettingsSection />;
}
