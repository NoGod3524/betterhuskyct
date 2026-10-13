import type { Metadata } from "next";

import { BackupSection } from "@/components/backup-section";
import packageJson from "../../../package.json";

export const metadata: Metadata = {
  title: "Backup · BetterHuskyCT",
  description: "Save everything BetterHuskyCT keeps in this browser as one file, and load it back.",
};

export default function BackupPage() {
  return <BackupSection version={packageJson.version} />;
}
