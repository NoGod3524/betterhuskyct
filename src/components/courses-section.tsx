"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { ListSkeleton } from "@/components/list-skeleton";
import { openSyncCenter } from "@/components/sync-center";
import { dueLabel } from "@/components/todo-section";
import { useCourseList, type CourseSummary } from "@/components/use-course-list";
import { coursePath } from "@/lib/course-key";
import { formatPoints } from "@/lib/grades";
import { t } from "@/lib/i18n";

function CourseCard({ course }: { course: CourseSummary }) {
  const { locale } = useCalendar();
  const facts = [
    t(locale, "courses.open", { count: course.open }),
    course.announcements > 0 ? t(locale, "courses.announcements", { count: course.announcements }) : null,
    course.files > 0 ? t(locale, "courses.files", { count: course.files }) : null,
    course.percent !== null ? t(locale, "grades.percent", { percent: formatPoints(course.percent) }) : null,
  ].filter(Boolean);
  return (
    <Link href={coursePath(course.key)} className="card group flex items-start gap-3 p-4 transition hover:border-[var(--line-strong)]">
      <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-[var(--blue)]" style={course.color ? { backgroundColor: course.color } : undefined} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-display text-base font-semibold">{course.key}</span>
          {course.unread > 0 ? (
            <span className="rounded-full bg-[var(--warning-soft)] px-1.5 text-[11px] font-semibold tabular-nums text-[var(--warning)]" aria-label={t(locale, "changes.unreadCount", { count: course.unread })}>
              {course.unread}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-xs text-[var(--muted)]">{facts.join(" · ")}</span>
        {course.next ? (
          <span className="mt-2 block truncate text-sm">
            <span className="text-[var(--muted)]">{t(locale, "courses.next")} </span>
            {course.next.title}
            <span className="text-[var(--muted)]"> · {dueLabel(course.next, locale)}</span>
          </span>
        ) : null}
      </span>
      <ChevronRight size={16} className="mt-1 shrink-0 text-[var(--muted)] transition group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

/** Every course, one card each: what is new, what is due next, and the way into its own page. */
export function CoursesSection() {
  const { locale, hasSavedImport } = useCalendar();
  const { ready, courses } = useCourseList();

  return (
    <section className="mt-6" aria-labelledby="courses-heading">
      <h1 id="courses-heading" className="font-display text-2xl font-semibold">
        {t(locale, "nav.courses")}
        {ready && !hasSavedImport && courses.length > 0 ? (
          <span className="ml-2 rounded-md bg-[var(--accent-soft)] px-2 py-0.5 align-middle text-xs font-medium text-[var(--accent-ink)]">{t(locale, "actions.demoPreview")}</span>
        ) : null}
      </h1>
      <p className="mt-1.5 text-sm text-[var(--muted)]">{t(locale, "courses.intro")}</p>

      {!ready ? (
        <ListSkeleton label={t(locale, "common.loading")} />
      ) : courses.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--line-strong)] p-6">
          <p className="text-sm font-semibold">{t(locale, "courses.emptyTitle")}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{t(locale, "courses.emptyBody")}</p>
          <button type="button" onClick={openSyncCenter} className="tap-link mt-3 inline-flex text-sm font-semibold text-[var(--link)] hover:underline">
            {t(locale, "grades.emptyCta")}
          </button>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {courses.map((course) => (
            <CourseCard key={course.key} course={course} />
          ))}
        </div>
      )}
    </section>
  );
}
