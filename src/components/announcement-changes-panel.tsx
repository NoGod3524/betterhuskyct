"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";

import { useAiPlan } from "@/components/ai-plan-provider";
import { formatDay } from "@/components/announcement-actions-panel";
import { useCalendar } from "@/components/calendar-provider";
import { updateDecisions, useDecisions, useVersionStore } from "@/components/use-announcement-state";
import { dayKey, type DayParts } from "@/lib/announcement-dates";
import { extractCandidates } from "@/lib/announcement-actions";
import { isUnreviewed, linkNotices, markLinkChecked, markLinkMoved, markReviewed, type LinkNotice } from "@/lib/announcement-decisions";
import { isNotable, latestChange } from "@/lib/announcement-versions";
import type { Announcement } from "@/lib/announcements";
import { intlLocale, t, type Locale, type TranslationKey } from "@/lib/i18n";
import { dueInstant } from "@/lib/quick-add";

const partsOf = (key: string): DayParts => {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
};

/**
 * What changed in an announcement since this browser first saved it, shown against the earlier text,
 * and what that means for the tasks the student made from it. Nothing is changed for them: a task
 * is moved only when they press the button for the new day.
 */
export function ChangePanel({ announcement, locale }: { announcement: Announcement; locale: Locale }) {
  const versions = useVersionStore();
  const decisions = useDecisions();
  const { tasks, editEvent } = useCalendar();
  const plan = useAiPlan();
  const [showDiff, setShowDiff] = useState(false);

  const change = useMemo(() => latestChange(announcement.id, versions[announcement.id], announcement.posted), [announcement, versions]);
  const notices = useMemo(() => linkNotices(decisions, [announcement], versions), [decisions, announcement, versions]);
  if (!change) return null;

  const unreviewed = isUnreviewed(change, decisions);
  const when = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  const live = notices.filter((notice) => notice.added.taskKind === "undated" ? plan?.undated.some((todo) => todo.id === notice.added.taskId) : tasks.some((task) => task.id === notice.added.taskId));

  function move(notice: LinkNotice, day: string) {
    const task = tasks.find((entry) => entry.id === notice.added.taskId);
    if (!task) return;
    const start = new Date(task.start);
    const time = task.allDay ? "" : `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
    editEvent(task.id, { start: dueInstant(day, time), allDay: task.allDay });
    // The sentence that now names that day is what a later change is compared with.
    const sentence = extractCandidates(announcement).find((candidate) => candidate.date && dayKey(candidate.date) === day)?.sentence ?? notice.added.sentence;
    updateDecisions((current) => markLinkMoved(current, notice.candidateId, { day, sentence, versionAt: change!.after.at }));
  }

  return (
    <section
      className={`mt-3 grid gap-2 rounded-xl border p-3 text-sm ${unreviewed && isNotable(change) ? "border-[var(--warning)] bg-[var(--warning-soft)]" : "border-[var(--line)] bg-[var(--subtle)]"}`}
      aria-label={t(locale, "ann.changedHeading")}
      data-changed={announcement.id}
    >
      <h4 className="flex flex-wrap items-center gap-2 font-semibold">
        <History size={15} aria-hidden />
        {t(locale, "ann.changedHeading")}
        <span className="text-xs font-normal text-[var(--muted)]">
          {t(locale, "ann.changedWhen", { first: when.format(new Date(change.before.at)), then: when.format(new Date(change.after.at)) })}
        </span>
      </h4>

      <ul className="grid gap-0.5 text-sm">
        {change.datesRemoved.length > 0 ? (
          <li>{t(locale, "ann.datesRemoved", { days: change.datesRemoved.map((day) => formatDay(partsOf(day), locale)).join(", ") })}</li>
        ) : null}
        {change.datesAdded.length > 0 ? (
          <li>{t(locale, "ann.datesAdded", { days: change.datesAdded.map((day) => formatDay(partsOf(day), locale)).join(", ") })}</li>
        ) : null}
        {change.cancelled ? <li className="font-medium">{t(locale, "ann.nowCancelled")}</li> : null}
        {!isNotable(change) ? <li className="text-[var(--muted)]">{t(locale, "ann.wordsOnly")}</li> : null}
      </ul>

      <div>
        <button type="button" onClick={() => setShowDiff((value) => !value)} aria-expanded={showDiff} className="text-xs font-medium text-[var(--link)] hover:underline">
          {t(locale, showDiff ? "ann.hideDiff" : "ann.showDiff")}
        </button>
        {showDiff ? (
          <p className="mt-1 whitespace-pre-line rounded-lg bg-[var(--surface)] p-2 text-sm leading-6">
            {change.segments.map((segment, index) =>
              segment.kind === "added" ? (
                <ins key={index} className="bg-[var(--success-soft,#dcfce7)] text-[var(--success)] no-underline">{segment.text}</ins>
              ) : segment.kind === "removed" ? (
                <del key={index} className="text-[var(--warning)]">{segment.text}</del>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )}
          </p>
        ) : null}
      </div>

      {live.map((notice) => (
        <div key={notice.candidateId} className="grid gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5" data-notice={notice.candidateId}>
          <p className="font-medium">
            {t(locale, "ann.noticeFor", { title: notice.added.title })}
            {notice.added.day ? ` (${formatDay(partsOf(notice.added.day), locale)})` : ""}
          </p>
          <p className="text-xs text-[var(--muted)]">{notice.reasons.map((reason) => t(locale, `ann.reason.${reason}` as TranslationKey)).join(" ")}</p>
          <p className="text-xs text-[var(--muted)]">{t(locale, "ann.noticeNothingChanged")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {notice.added.taskKind === "event"
              ? notice.newDays.map((day) => (
                  <button key={day} type="button" onClick={() => move(notice, day)} className="btn btn-primary h-8 px-3 text-xs">
                    {t(locale, "ann.moveTo", { day: formatDay(partsOf(day), locale) })}
                  </button>
                ))
              : null}
            <button type="button" onClick={() => updateDecisions((current) => markLinkChecked(current, notice.candidateId, change.after.at))} className="btn btn-quiet h-8 px-3 text-xs">
              {t(locale, "ann.keepAsIs")}
            </button>
            <Link href="/tasks" className="text-xs font-semibold text-[var(--link)] hover:underline">
              {t(locale, "ann.openTodo")}
            </Link>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">{t(locale, "ann.historyNote")}</p>
        {unreviewed ? (
          <button type="button" onClick={() => updateDecisions((current) => markReviewed(current, announcement.id, change.after.at))} className="btn btn-quiet h-8 px-3 text-xs">
            {t(locale, "ann.markChecked")}
          </button>
        ) : (
          <span className="text-xs font-medium text-[var(--success)]">{t(locale, "ann.checked")}</span>
        )}
      </div>
    </section>
  );
}
