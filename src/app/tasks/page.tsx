import type { Metadata } from "next";

import { TodoSection } from "@/components/todo-section";

export const metadata: Metadata = {
  title: "To-do · BetterHuskyCT",
  description: "Every deadline still to hand in, with what HuskyCT says is already done set apart.",
};

export default function TasksPage() {
  return <TodoSection />;
}
