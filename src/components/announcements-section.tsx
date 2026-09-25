"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { AnnouncementSummary, type SummaryCourse } from "@/components/announcement-summary";
import { useCalendar } from "@/components/calendar-provider";
import type { Announcement } from "@/lib/announcements";
import { intlLocale, t } from "@/lib/i18n";

/**
 * How many bodies are expanded before the list asks first.
 *
 * A term of announcements with full bodies is a long page, and the useful part
 * of most of them is the first line. Cutting each one short keeps a scan
 * possible; the reader who wants the rest asks for it.
 */
const CLAMP_LENGTH = 240;
const COLLAPSED_COUNT = 12;

/** The filter key for announcements filed under no course. */
const NO_COURSE = "__none";

/**
 * The one key both the filter chips and the filter itself use.
 *
 * They used to compute it separately — the chips from `courseId ?? "__none"`,
 * the filter from `courseId` alone — so "No course" matched nothing and showed
 * an empty list.
 */
function courseKeyOf(entry: Announcement): string {
  return entry.courseId ?? NO_COURSE;
}

/**
 * What the courses have said, grouped by course and newest first.
 *
 * Read-only on purpose. An announcement is prose — "the midterm moves to the
 * 14th" — and pulling dates out of prose would mean guessing, which is how a
 * wrong deadline ends up in a list the user trusts. The deadlines that arrive
 * alongside these keep coming from the to-do list, where they were structured
 * to begin with.
 */
export function AnnouncementsSection() {
  const { locale, announcements, courses, clearAnnouncements } = useCalendar();
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const courseNameFor = useMemo(() => {
    const byId = new Map(courses.map((course) => [course.id, course.code]));
    return (courseId: string) => byId.get(courseId) ?? null;
  }, [courses]);

  const visible = useMemo(
    () =>
      courseFilter
        ? announcements.filter((entry) => courseKeyOf(entry) === courseFilter)
        : announcements,
    [announcements, courseFilter],
  );

  /**
   * Which courses actually have something, so the filter never offers a course
   * that leads to an empty page.
   */
  const filterOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of announcements) {
      const key = courseKeyOf(entry);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [announcements]);

  const shown = expanded ? visible : visible.slice(0, COLLAPSED_COUNT);

  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(intlLocale(locale), {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  /** The course a summary is for: only once one is picked, since a summary is per course. */
  function summaryCourseFor(key: string | null): SummaryCourse | null {
    if (key === null) return null;
    if (key === NO_COURSE) {
      return {
        label: t(locale, "announcements.uncoursed"),
        modelLabel: "announcements not filed under a course",
      };
    }
    const code = courseNameFor(key) ?? key;
    return { label: code, modelLabel: code };
  }

  function labelFor(entry: Announcement): string {
    if (entry.courseId) {
      return courseNameFor(entry.courseId) ?? t(locale, "announcements.uncoursed");
    }
    return entry.courseCode ?? t(locale, "announcements.uncoursed");
  }

  return (
    <section className="mt-10" aria-labelledby="announcements-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t(locale, "announcements.eyebrow")}</p>
          <h2
            id="announcements-heading"
            className="font-display mt-1 text-2xl font-semibold tracking-[-0.025em]"
          >
            {t(locale, "announcements.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            {t(locale, "announcements.description")}
          </p>
        </div>

        {announcements.length > 0 ? (
          <button
            type="button"
            onClick={clearAnnouncements}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#cdd9e6] bg-white px-3 text-sm font-semibold text-[#4e647b] transition hover:border-[#9fb7d1] hover:text-[#244e7a]"
          >
            {t(locale, "announcements.clear")}
          </button>
        ) : null}
      </div>

      {announcements.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[#d7e1ec] bg-[#fafcff] p-5">
          <p className="text-sm font-semibold text-[#31506f]">
            {t(locale, "announcements.emptyTitle")}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t(locale, "announcements.emptyBody")}
          </p>
          <Link
            href="/helper"
            className="mt-3 inline-flex text-sm font-semibold text-[var(--blue)] hover:underline"
          >
            {t(locale, "announcements.emptyCta")}
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCourseFilter(null)}
              className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold transition ${
                courseFilter === null
                  ? "bg-[var(--navy)] text-white"
                  : "border border-[#cdd9e6] bg-white text-[#4e647b] hover:border-[#9fb7d1]"
              }`}
            >
              {t(locale, "announcements.allCourses")}
            </button>
            {filterOptions.map(([key, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setCourseFilter(key)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
                  courseFilter === key
                    ? "bg-[var(--navy)] text-white"
                    : "border border-[#cdd9e6] bg-white text-[#4e647b] hover:border-[#9fb7d1]"
                }`}
              >
                {key === NO_COURSE
                  ? t(locale, "announcements.uncoursed")
                  : (courseNameFor(key) ?? key)}
                <span className="opacity-70">{count}</span>
              </button>
            ))}
            <span className="text-xs text-[var(--muted)]">
              {t(locale, "announcements.count", { count: visible.length })}
            </span>
          </div>

          <AnnouncementSummary
            key={courseFilter ?? "__all"}
            locale={locale}
            course={summaryCourseFor(courseFilter)}
            announcements={visible}
          />

          <ul className="mt-4 space-y-3">
            {shown.map((entry) => (
              <li
                key={entry.id}
                className="rounded-[20px] border border-[var(--line)] bg-white p-5 shadow-[0_8px_30px_rgba(31,58,92,0.05)]"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="inline-flex items-center rounded-full bg-[#eef4ff] px-2.5 py-0.5 text-[11px] font-semibold text-[#244e7a]">
                    {labelFor(entry)}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {entry.posted
                      ? t(locale, "announcements.posted", { value: entry.posted })
                      : t(locale, "announcements.collected", {
                          value: dateFormat.format(new Date(entry.announced)),
                        })}
                  </span>
                </div>

                <h3 className="font-display mt-2 text-base font-semibold text-[#172b41]">
                  {entry.title}
                </h3>

                {entry.body ? (
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#31506f]">
                    {entry.body.length > CLAMP_LENGTH && !expanded
                      ? `${entry.body.slice(0, CLAMP_LENGTH)}…`
                      : entry.body}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          {visible.length > COLLAPSED_COUNT ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-4 inline-flex h-9 items-center rounded-lg border border-[#cdd9e6] bg-white px-3 text-sm font-semibold text-[#4e647b] transition hover:border-[#9fb7d1] hover:text-[#244e7a]"
            >
              {expanded
                ? t(locale, "announcements.showLess")
                : t(locale, "announcements.showMore")}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
