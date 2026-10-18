import { AiPlanBanner } from "@/components/ai-plan-panel";
import { ConnectSection } from "@/components/connect-section";
import { HeroSection } from "@/components/hero-section";
import { TasksSection } from "@/components/tasks-section";
import { ChangesSection } from "@/components/changes-section";
import { SyncStatusDetails } from "@/components/sync-status-view";

export default function OverviewPage() {
  return (
    <>
      <HeroSection />
      <SyncStatusDetails />
      <ChangesSection preview />
      <AiPlanBanner />
      <TasksSection />
      <ConnectSection />
    </>
  );
}
