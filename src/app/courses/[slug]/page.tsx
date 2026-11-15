import type { Metadata } from "next";
import { Suspense } from "react";

import { CoursePage } from "@/components/course-page";
import { providersFromEnv } from "@/lib/summary-models";

export const metadata: Metadata = {
  title: "Course · BetterHuskyCT",
  description: "One course's changes, work, announcements, files and grades.",
};

export default async function CourseRoute({ params }: PageProps<"/courses/[slug]">) {
  const { slug } = await params;
  // Read on the server, where the keys live; only whether any exists reaches the page.
  const summariesEnabled = providersFromEnv(process.env).length > 0;
  return (
    <Suspense>
      <CoursePage slug={slug} summariesEnabled={summariesEnabled} />
    </Suspense>
  );
}
