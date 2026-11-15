"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AnnouncementsSection } from "@/components/announcements-section";
import { useCalendar } from "@/components/calendar-provider";
import { ChangesSection } from "@/components/changes-section";
import { GradesSection } from "@/components/grades-section";
import { ListSkeleton } from "@/components/list-skeleton";
import { MaterialsSection } from "@/components/materials-section";
import { TodoSection } from "@/components/todo-section";
import { useCourseList, type CourseSummary } from "@/components/use-course-list";
import { COURSE_TABS, courseSlug, isCourseTab, type CourseTab } from "@/lib/course-key";
import { t, type TranslationKey } from "@/lib/i18n";

const TAB_LABELS: Record<CourseTab, TranslationKey> = {
  activity: "course.tab.activity",
  tasks: "course.tab.tasks",
  announcements: "nav.announcements",
  materials: "nav.materials",
  grades: "nav.grades",
};

function badgeFor(tab: CourseTab, course: CourseSummary): number {
  if (tab === "activity") return course.unread;
  if (tab === "tasks") return course.open;
  return 0;
}

/**
 * One course on one page: what changed in it, its work, announcements, files and grades, as tabs.
 * The tab is in the address (?tab=grades), so a change can link straight to it and Back works.
 */
export function CoursePage({ slug, summariesEnabled }: { slug: string; summariesEnabled: boolean }) {
  const { locale } = useCalendar();
  const { ready, courses } = useCourseList();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("tab");
  const tab: CourseTab = isCourseTab(requested) ? requested : "activity";
  const course = courses.find((entry) => courseSlug(entry.key) === slug) ?? null;

  const back = (
    <Link href="/courses" className="tap-link inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
      <ArrowLeft size={14} aria-hidden />
      {t(locale, "nav.courses")}
    </Link>
  );

  if (!ready) {
    return (
      <div className="mt-6">
        {back}
        <ListSkeleton label={t(locale, "common.loading")} />
      </div>
    );
  }
  if (!course) {
    return (
      <div className="mt-6">
        {back}
        <div className="mt-4 rounded-xl border border-dashed border-[var(--line-strong)] p-6">
          <p className="text-sm font-semibold">{t(locale, "course.notFound")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {back}
      <h1 className="font-display mt-2 flex items-center gap-2.5 text-2xl font-semibold">
        <span className="size-3 shrink-0 rounded-full bg-[var(--blue)]" style={course.color ? { backgroundColor: course.color } : undefined} aria-hidden />
        {course.key}
      </h1>

      <div role="tablist" aria-label={course.key} className="-mx-1 mt-4 overflow-x-auto px-1 [scrollbar-width:none]">
        <div className="flex w-max gap-1 rounded-lg bg-[var(--subtle)] p-0.5 text-sm font-medium">
          {COURSE_TABS.map((name) => {
            const active = name === tab;
            const badge = badgeFor(name, course);
            return (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => router.replace(name === "activity" ? pathname : `${pathname}?tab=${name}`, { scroll: false })}
                className={`tap-link inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
                  active ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {t(locale, TAB_LABELS[name])}
                {badge > 0 ? <span className="text-xs tabular-nums text-[var(--muted)]">{badge}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" key={tab}>
        {tab === "activity" ? (
          <ChangesSection course={course.key} />
        ) : tab === "tasks" ? (
          <TodoSection course={course.key} />
        ) : tab === "announcements" ? (
          <AnnouncementsSection course={course.key} summariesEnabled={summariesEnabled} />
        ) : tab === "materials" ? (
          <MaterialsSection course={course.key} />
        ) : (
          <GradesSection course={course.key} />
        )}
      </div>
    </div>
  );
}
