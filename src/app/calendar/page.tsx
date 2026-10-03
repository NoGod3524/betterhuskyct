import type { Metadata } from "next";

import { CalendarMonthView } from "@/components/calendar-month-view";
import { ConnectSection } from "@/components/connect-section";

export const metadata: Metadata = {
  title: "Calendar · BetterHuskyCT",
  description: "A visual, editable calendar built from your HuskyCT / Blackboard feeds.",
};

export default function CalendarPage() {
  return (
    <>
      <ConnectSection />
      <CalendarMonthView />
    </>
  );
}
