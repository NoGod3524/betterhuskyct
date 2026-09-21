import type { Metadata } from "next";

import { TasksSection } from "@/components/tasks-section";

export const metadata: Metadata = {
  title: "Tasks · BetterHuskyCT",
  description: "Everything due in the next 7 days, grouped by Today, Tomorrow, and This week.",
};

export default function TasksPage() {
  return <TasksSection />;
}
