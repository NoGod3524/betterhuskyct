"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, ExternalLink, Trash2 } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { ListSkeleton } from "@/components/list-skeleton";
import {
  createGradesReceiver,
  formatPoints,
  huskyctGradesUrl,
  isCounted,
  summarizeCourse,
  type GradeItem,
  type GradesReceiveState,
  type GradesSnapshot,
  type GradesStore,
} from "@/lib/grades";
import { openGradesStore } from "@/lib/grades-store";
import { intlLocale, t, type Locale } from "@/lib/i18n";

/**
 * The Grades page: each course's gradebook rows and the points so far, kept in
 * this browser and delivered by the helper. While this page is open it listens
 * for the helper's messages (from HuskyCT's origin only) and stores what
 * arrives.
 */
export function GradesSection({ openStore = openGradesStore }: { openStore?: () => Promise<GradesStore> }) {
  const { locale } = useCalendar();
  const [store, setStore] = useState<GradesStore | null>(null);
  const [grades, setGrades] = useState<GradesSnapshot | null>(null);
  const [receive, setReceive] = useState<GradesReceiveState>({ phase: "idle", courses: 0, items: 0 });
  const [unavailable, setUnavailable] = useState(false);
  // False until the saved grades have been read once, so the empty state is not
  // shown for a frame to someone who has grades.
  const [ready, setReady] = useState(false);
  const [openUngraded, setOpenUngraded] = useState<Set<string>>(new Set());

  const reload = useCallback(async (from: GradesStore) => {
    setGrades(await from.get());
  }, []);

  useEffect(() => {
    let cancelled = false;
    openStore()
      .then(async (opened) => {
        if (cancelled) return;
        setStore(opened);
        await reload(opened);
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setUnavailable(true);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [openStore, reload]);

  useEffect(() => {
    if (!store) return;
    const receiver = createGradesReceiver({
      store,
      onChange: (state) => {
        setReceive(state);
        if (state.phase === "done") void reload(store);
      },
    });
    const listener = (event: MessageEvent) => {
      void receiver({ origin: event.origin, data: event.data, source: event.source as Window | null });
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [store, reload]);

  const courses = useMemo(() => grades?.courses ?? [], [grades]);

  async function clearAll() {
    if (!store || !window.confirm(t(locale, "grades.clearConfirm"))) return;
    await store.clear();
    await reload(store);
  }

  function toggleUngraded(courseId: string) {
    setOpenUngraded((current) => {
      const next = new Set(current);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  }

  return (
    <section className="mt-10" aria-labelledby="grades-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t(locale, "grades.eyebrow")}</p>
          <h2 id="grades-heading" className="font-display mt-1 text-2xl font-semibold tracking-[-0.025em]">
            {t(locale, "grades.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">{t(locale, "grades.description")}</p>
        </div>
        {courses.length > 0 ? (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--c-4e647b)] transition hover:border-[var(--c-9fb7d1)] hover:text-[var(--c-244e7a)]"
          >
            <Trash2 size={15} aria-hidden />
            {t(locale, "grades.clear")}
          </button>
        ) : null}
      </div>

      {receive.phase === "done" ? (
        <p className="mt-4 rounded-xl bg-[var(--c-ecf8f1)] px-4 py-3 text-sm font-semibold text-[var(--c-1d6b43)]" role="status">
          {t(locale, "grades.received", { courses: receive.courses, items: receive.items })}
        </p>
      ) : receive.phase === "failed" ? (
        <p className="mt-4 rounded-xl bg-[var(--c-f4f7fb)] px-4 py-3 text-sm text-[var(--c-b3412e)]" role="status">
          {t(locale, "grades.receivedFailed")}
        </p>
      ) : null}
      {unavailable ? <p className="mt-4 text-sm text-[var(--c-b3412e)]">{t(locale, "grades.unavailable")}</p> : null}

      {!ready ? (
        <ListSkeleton label={t(locale, "common.loading")} />
      ) : courses.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[var(--c-d7e1ec)] bg-[var(--c-fafcff)] p-5">
          <p className="text-sm font-semibold text-[var(--c-31506f)]">{t(locale, "grades.emptyTitle")}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{t(locale, "grades.emptyBody")}</p>
          <Link href="/helper" className="tap-link mt-3 inline-flex text-sm font-semibold text-[var(--link)] hover:underline">
            {t(locale, "grades.emptyCta")}
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-4 text-xs text-[var(--muted)]">
            {t(locale, "grades.caveat")}
            {grades ? " · " + t(locale, "grades.updated", { when: formatWhen(grades.takenAt, locale) }) : ""}
          </p>

          <div className="mt-4 space-y-3">
            {courses.map((course) => {
              const summary = summarizeCourse(course);
              const counted = course.items.filter(isCounted);
              const rest = course.items.filter((item) => !isCounted(item));
              const url = huskyctGradesUrl(course);
              const restOpen = openUngraded.has(course.id);
              return (
                <article
                  key={course.id}
                  className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] px-5 py-4 shadow-[0_8px_30px_rgba(31,58,92,0.05)]"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <h3 className="font-display text-lg font-semibold text-[var(--c-172b41)]">{course.code ?? course.id}</h3>
                      <p className="text-xs font-semibold text-[var(--muted)]">
                        {t(locale, "grades.courseSummary", { graded: summary.graded, total: summary.total })}
                      </p>
                    </div>
                    {summary.percent !== null ? (
                      <p className="text-right">
                        <span className="font-display text-2xl font-semibold text-[var(--c-172b41)]">
                          {t(locale, "grades.percent", { percent: formatPoints(summary.percent) })}
                        </span>
                        <span className="ml-2 text-xs font-semibold text-[var(--muted)]">
                          {t(locale, "grades.points", {
                            earned: formatPoints(summary.earned),
                            possible: formatPoints(summary.possible),
                          })}
                        </span>
                      </p>
                    ) : null}
                  </div>

                  {course.items.length === 0 ? (
                    <p className="mt-3 text-sm text-[var(--muted)]">{t(locale, "grades.noWork")}</p>
                  ) : null}

                  {counted.length > 0 ? (
                    <ul className="mt-2 divide-y divide-[var(--c-eef2f6)]">
                      {counted.map((item) => (
                        <ItemRow key={item.id} item={item} />
                      ))}
                    </ul>
                  ) : null}

                  {rest.length > 0 ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => toggleUngraded(course.id)}
                        aria-expanded={restOpen}
                        className="flex items-center gap-2 text-left text-sm font-semibold text-[var(--c-31506f)] transition hover:opacity-80"
                      >
                        <ChevronRight
                          size={16}
                          className={`shrink-0 text-[var(--c-6b7f94)] transition-transform ${restOpen ? "rotate-90" : ""}`}
                          aria-hidden
                        />
                        {t(locale, "grades.noScore", { count: rest.length })}
                      </button>
                      {restOpen ? (
                        <ul className="rise-in mt-1 divide-y divide-[var(--c-eef2f6)]">
                          {rest.map((item) => (
                            <ItemRow key={item.id} item={item} />
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tap-link mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--link)] hover:underline"
                    >
                      <ExternalLink size={13} aria-hidden />
                      {t(locale, "grades.openInHuskyct")}
                    </a>
                  ) : null}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function ItemRow({ item }: { item: GradeItem }) {
  const scored = item.earned !== null && item.possible !== null;
  return (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--c-31506f)]">{item.title}</p>
        {item.status ? <p className="text-xs text-[var(--muted)]">{item.status}</p> : null}
      </div>
      <p className="shrink-0 text-sm font-semibold text-[var(--c-244e7a)]">
        {scored ? `${formatPoints(item.earned!)} / ${formatPoints(item.possible!)}` : item.label}
      </p>
    </li>
  );
}

function formatWhen(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}
