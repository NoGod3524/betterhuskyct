import type { Metadata } from "next";

import { CalendarMonthView } from "@/components/calendar-month-view";

export const metadata: Metadata = {
  title: "Calendar · BetterHuskyCT",
  description: "A visual, editable calendar built from your HuskyCT / Blackboard feeds.",
};

export default function CalendarPage() {
  return (
    <>
      <CalendarMonthView />
    </>
  );
}
