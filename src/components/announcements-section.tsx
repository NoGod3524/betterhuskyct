"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { AnnouncementSummary, type SummaryCourse } from "@/components/announcement-summary";
import { useCalendar } from "@/components/calendar-provider";
import { announceSeenChanged, useAnnouncementsSeenAt } from "@/components/use-seen";
import { chipStyle } from "@/lib/course-colors";
import type { Announcement } from "@/lib/announcements";
import { normaliseCourseCode } from "@/lib/courses";
import { intlLocale, t } from "@/lib/i18n";
import { markAnnouncementsSeen, unseenAnnouncements } from "@/lib/seen";

/**
 * A body is shown two lines deep, with a button for the rest once it is longer
 * than this; and the list shows this many before it asks first.
 *
 * A term of announcements with full bodies is a long page, and the useful part
 * of most of them is the first line. Cutting each one short keeps a scan
 * possible; the reader who wants the rest asks for it.
 */
const CLAMP_LENGTH = 160;
const COLLAPSED_COUNT = 12;

/** The filter key for announcements filed under no course. */
const NO_COURSE = "__none";

/**
 * The one key both the filter chips and the filter itself use: the course code.
 *
 * They used to compute it separately — the chips from `courseId ?? "__none"`,
 * the filter from `courseId` alone — so "No course" matched nothing and showed
 * an empty list.
 *
 * And it used to be the local course id, which an announcement only has when
 * the course list on the import page holds exactly one course with its code.
 * Someone who never filled that list in — or has a lecture and a discussion
 * under one code — saw every announcement under "No course", each one still
 * labelled with the course it came from. The code is what every announcement
 * from the helper carries, so it is what groups them; "No course" is left for
 * the ones that really have none.
 */
function courseKeyOf(entry: Announcement, codeForId: (courseId: string) => string | null): string {
  const code = entry.courseCode ?? (entry.courseId ? codeForId(entry.courseId) : null);
  const normalised = code ? normaliseCourseCode(code).toUpperCase() : "";
  return normalised || NO_COURSE;
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
export function AnnouncementsSection({
  summariesEnabled = false,
}: {
  /** Whether this server can summarise: it has a model key. Off, the panel is not shown at all. */
  summariesEnabled?: boolean;
}) {
  const { locale, announcements, courses, clearAnnouncements, courseColorFor } = useCalendar();
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  // What arrived since the student last left this page is marked new while they are on it, and
  // counted as seen when they leave.
  const seenAt = useAnnouncementsSeenAt();
  const unseen = useMemo(() => unseenAnnouncements(announcements, seenAt), [announcements, seenAt]);
  useEffect(
    () => () => {
      markAnnouncementsSeen(window.localStorage, new Date());
      announceSeenChanged();
    },
    [],
  );

  function toggleOpen(id: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const courseNameFor = useMemo(() => {
    const byId = new Map(courses.map((course) => [course.id, course.code]));
    return (courseId: string) => byId.get(courseId) ?? null;
  }, [courses]);

  const visible = useMemo(
    () =>
      courseFilter
        ? announcements.filter((entry) => courseKeyOf(entry, courseNameFor) === courseFilter)
        : announcements,
    [announcements, courseFilter, courseNameFor],
  );

  /**
   * Which courses actually have something, so the filter never offers a course
   * that leads to an empty page.
   */
  const filterOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of announcements) {
      const key = courseKeyOf(entry, courseNameFor);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [announcements, courseNameFor]);

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
    return { label: key, modelLabel: key };
  }

  function labelFor(entry: Announcement): string {
    const key = courseKeyOf(entry, courseNameFor);
    return key === NO_COURSE ? t(locale, "announcements.uncoursed") : key;
  }

  return (
    <section className="mt-10" aria-labelledby="announcements-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t(locale, "announcements.eyebrow")}</p>
          <h2
            id="announcements-heading"
            className="font-display mt-1 text-2xl font-semibold"
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
            className="btn btn-quiet"
          >
            {t(locale, "announcements.clear")}
          </button>
        ) : null}
      </div>

      {announcements.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--line-strong)] p-6">
          <p className="text-sm font-semibold">
            {t(locale, "announcements.emptyTitle")}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t(locale, "announcements.emptyBody")}
          </p>
          <Link
            href="/helper"
            className="tap-link mt-3 inline-flex text-sm font-semibold text-[var(--link)] hover:underline"
          >
            {t(locale, "announcements.emptyCta")}
          </Link>
        </div>
      ) : (
        <div className="mt-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-6">
          {/* The courses: a row of chips on a phone, a list beside the announcements on a wide screen. */}
          <div
            role="group"
            aria-label={t(locale, "announcements.allCourses")}
            className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 lg:sticky lg:top-20 lg:flex-col lg:gap-0.5 lg:overflow-visible"
          >
            <CourseButton active={courseFilter === null} onClick={() => setCourseFilter(null)} count={announcements.length}>
              {t(locale, "announcements.allCourses")}
            </CourseButton>
            {filterOptions.map(([key, count]) => (
              <CourseButton
                key={key}
                active={courseFilter === key}
                onClick={() => setCourseFilter(key)}
                count={count}
                color={key === NO_COURSE ? null : courseColorFor(key)}
              >
                {key === NO_COURSE ? t(locale, "announcements.uncoursed") : key}
              </CourseButton>
            ))}
          </div>

          <div className="mt-4 min-w-0 lg:mt-0">
            {summariesEnabled ? (
              <AnnouncementSummary
                key={courseFilter ?? "__all"}
                locale={locale}
                course={summaryCourseFor(courseFilter)}
                announcements={visible}
              />
            ) : null}

            <p className="mt-4 text-xs text-[var(--muted)] first:mt-0">
              {t(locale, "announcements.count", { count: visible.length })}
            </p>
            <ul className="card mt-2 divide-y divide-[var(--line)] overflow-hidden">
              {shown.map((entry) => {
                const open = openIds.has(entry.id);
                const key = courseKeyOf(entry, courseNameFor);
                const color = key === NO_COURSE ? null : courseColorFor(key);
                return (
                  <li key={entry.id} className="px-4 py-4 sm:px-5">
                    <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                      <span
                        className="truncate rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--accent-ink)]"
                        style={color ? chipStyle(color) : undefined}
                      >
                        {labelFor(entry)}
                      </span>
                      {unseen.has(entry.id) ? <span className="shrink-0 rounded bg-[var(--warning-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--warning)]">{t(locale, "seen.new")}</span> : null}
                      <span className="ml-auto shrink-0 tabular-nums">
                        {entry.posted
                          ? t(locale, "announcements.posted", { value: entry.posted })
                          : t(locale, "announcements.collected", {
                              value: dateFormat.format(new Date(entry.announced)),
                            })}
                      </span>
                    </div>

                    <h3 className="mt-2 text-[15px] font-semibold leading-6">{entry.title}</h3>

                    {entry.body ? (
                      <p className={`mt-1 whitespace-pre-line text-sm leading-6 text-[var(--muted)] ${open ? "" : "line-clamp-2"}`}>
                        {entry.body}
                      </p>
                    ) : null}
                    {entry.body && entry.body.length > CLAMP_LENGTH ? (
                      <button
                        type="button"
                        onClick={() => toggleOpen(entry.id)}
                        aria-expanded={open}
                        className="tap-link mt-1 text-xs font-medium text-[var(--link)] hover:underline"
                      >
                        {t(locale, open ? "announcements.collapse" : "announcements.expand")}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {visible.length > COLLAPSED_COUNT ? (
              <button type="button" onClick={() => setExpanded((value) => !value)} className="btn btn-quiet mt-4">
                {expanded
                  ? t(locale, "announcements.showLess")
                  : t(locale, "announcements.showMore")}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

/** One course in the list beside the announcements: its colour, its name and how many it has. */
function CourseButton({
  active,
  onClick,
  count,
  color = null,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  color?: string | null;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-left text-sm transition lg:w-full ${
        active
          ? "bg-[var(--nav-active-bg)] font-medium text-[var(--nav-active)]"
          : "text-[var(--nav)] hover:bg-[var(--nav-hover)] hover:text-[var(--ink)]"
      }`}
    >
      {color ? <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden /> : null}
      <span className="truncate">{children}</span>
      <span className="ml-auto pl-1 text-xs tabular-nums text-[var(--muted)]">{count}</span>
    </button>
  );
}
