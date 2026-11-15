"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  Archive,
  FolderDown,
  PlayCircle,
  Trash2,
  Wrench,
} from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { useMaterialsExport } from "@/components/use-materials-export";
import { DemoNote } from "@/components/demo-note";
import { Chip, FileIcon, FolderView, LinkGroup, PartButton, SmallButton, Toggle } from "@/components/materials-parts";
import { openSyncCenter } from "@/components/sync-center";
import { courseKey } from "@/lib/course-key";
import { DELIVERY_EVENT, type DeliveryDetail } from "@/components/helper-deliveries";
import { ListSkeleton } from "@/components/list-skeleton";
import { SyllabusSummaryCard, SyllabusSummaryHint } from "@/components/syllabus-summary";
import { announceSeenChanged, useSeenFilesRaw } from "@/components/use-seen";
import { t } from "@/lib/i18n";
import {
  canViewInTab,
  folderTree,
  foldersIn,
  formatBytes,
  huskyctCourseUrl,
  type MaterialsIndex,
  type MaterialsStore,
  type ReceiveState,
  type StoredFile,
} from "@/lib/materials";
import { openMaterialsStore } from "@/lib/materials-store";
import { createDemoMaterials } from "@/lib/demo-content";
import { markFilesSeen, parseSeenFiles, unseenFiles } from "@/lib/seen";

/**
 * Which courses and folders the reader left open, kept between visits. A
 * term's materials are hundreds of files; everything starts closed, and what
 * was opened stays open. Per viewer and best-effort: if storage is blocked, the
 * page simply starts closed each time.
 */
const OPEN_KEY = "huskypilot.materials.open.v1";

function readOpen(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(OPEN_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writeOpen(open: Set<string>) {
  try {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  } catch {
    /* the page works the same, it just forgets */
  }
}

const courseKeyOf = (courseId: string) => `c:${courseId}`;
const groupKeyOf = (courseId: string, name: string) => `g:${courseId}:${name}`;

/**
 * The Materials page: every course's files, videos, links and tools, kept in
 * this browser — the part of HuskyCT a student opens most, without HuskyCT.
 *
 * It is also where the helper delivers them: while this page is open, it
 * listens for the helper's messages (from HuskyCT's origin only) and stores
 * each file as it arrives.
 */
export function MaterialsSection({
  openStore = openMaterialsStore,
  course = null,
}: {
  openStore?: () => Promise<MaterialsStore>;
  /** On a course's page: only that course, open, with no heading, chips or all-course buttons. */
  course?: string | null;
}) {
  const { locale, courseColorFor, calendarReady, isImported, now: clock } = useCalendar();
  const [store, setStore] = useState<MaterialsStore | null>(null);
  const [index, setIndex] = useState<MaterialsIndex | null>(null);
  const [files, setFiles] = useState<Map<string, StoredFile>>(new Map());
  const [receive, setReceive] = useState<ReceiveState>({ phase: "idle", expected: 0, stored: 0, failed: 0 });
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  // Read once, on the first render in the browser. Nothing depends on it until
  // the stored courses load, so the server's render (all closed) never differs
  // from the first one here in anything shown.
  const [open, setOpen] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : readOpen()));
  const [notice, setNotice] = useState<string | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // False until the saved index has been read once, so the empty state is not
  // shown for a frame to someone who has courses.
  const [ready, setReady] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function toggle(key: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeOpen(next);
      return next;
    });
  }

  const reload = useCallback(async (from: MaterialsStore) => {
    const [nextIndex, stored] = await Promise.all([from.getIndex(), from.files()]);
    setIndex(nextIndex);
    setFiles(new Map(stored.map((file) => [file.key, file])));
    try {
      const estimate = await navigator.storage?.estimate?.();
      setUsage(estimate?.usage ?? null);
    } catch {
      setUsage(null);
    }
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

  // The helper's deliveries are received in the shell, wherever the student is;
  // this page hears each step and refreshes its list. Refreshing after every
  // file would redraw a long page dozens of times, so it waits for a pause.
  useEffect(() => {
    if (!store) return;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<DeliveryDetail>).detail;
      if (detail.kind !== "materials") return;
      const state = detail.state;
      setReceive(state);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void reload(store), state.phase === "done" ? 0 : 800);
    };
    window.addEventListener(DELIVERY_EVENT, listener);
    return () => {
      window.removeEventListener(DELIVERY_EVENT, listener);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [store, reload]);

  // Before the first sync, examples show what this page is for; nothing about them is stored.
  const demo = ready && calendarReady && !isImported && (index?.courses.length ?? 0) === 0;
  const courses = useMemo(() => (demo ? createDemoMaterials(clock).courses : (index?.courses ?? [])), [demo, index, clock]);

  // A file not seen on this page before is marked new while the student is on it, and counted as
  // seen when they leave.
  const allKeys = useMemo(() => courses.flatMap((course) => course.files.map((file) => file.key)), [courses]);
  const seenRaw = useSeenFilesRaw();
  const unseen = useMemo(() => unseenFiles(allKeys, parseSeenFiles(seenRaw)), [allKeys, seenRaw]);
  const keysNow = useRef<string[]>([]);
  useEffect(() => {
    keysNow.current = demo ? [] : allKeys;
  }, [allKeys, demo]);
  useEffect(
    () => () => {
      if (keysNow.current.length === 0) return;
      markFilesSeen(window.localStorage, keysNow.current);
      announceSeenChanged();
    },
    [],
  );
  const shown = course
    ? courses.filter((entry) => courseKey(entry.code) === course)
    : courseFilter ? courses.filter((entry) => entry.id === courseFilter) : courses;

  const { writePicker, exporting, exportToFolder, exportZip, exportPart } = useMaterialsExport(index, files, setNotice);

  /** Every course and group on the page, for "Expand all". */
  const everyKey = useMemo(() => {
    const keys: string[] = [];
    for (const course of courses) {
      keys.push(courseKeyOf(course.id));
      for (const folder of foldersIn(folderTree(course.files))) keys.push(groupKeyOf(course.id, folder.path.join("/")));
      for (const section of ["videos", "links", "tools"]) keys.push(groupKeyOf(course.id, "#" + section));
    }
    return keys;
  }, [courses]);

  function setAll(expanded: boolean) {
    const next = expanded ? new Set(everyKey) : new Set<string>();
    writeOpen(next);
    setOpen(next);
  }

  const counts = useMemo(() => {
    const fileCount = courses.reduce((total, course) => total + course.files.length, 0);
    const received = courses.reduce((total, course) => total + course.files.filter((file) => files.has(file.key)).length, 0);
    return { fileCount, received };
  }, [courses, files]);

  function openFile(file: StoredFile, download: boolean) {
    // Only a type that cannot run anything is opened here; the rest is saved to disk, not shown.
    const save = download || !canViewInTab(file.blob.type);
    const url = URL.createObjectURL(file.blob);
    if (save) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } else {
      window.open(url, "_blank", "noopener");
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function clearAll() {
    if (!store || !window.confirm(t(locale, "materials.clearConfirm"))) return;
    await store.clear();
    setCourseFilter(null);
    setNotice(null);
    await reload(store);
  }

  return (
    <section className={course ? "mt-4" : "mt-10"} aria-labelledby={course ? undefined : "materials-heading"}>
      {course ? null : <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t(locale, "materials.eyebrow")}</p>
          <h2 id="materials-heading" className="font-display mt-1 text-2xl font-semibold">
            {t(locale, "materials.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">{t(locale, "materials.description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {counts.received > 0 ? (
            <>
              {writePicker ? (
                <button
                  type="button"
                  onClick={exportToFolder}
                  disabled={exporting}
                  className="btn btn-primary"
                >
                  <FolderDown size={15} aria-hidden />
                  {t(locale, "materials.exportFolder")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={exportZip}
                disabled={exporting}
                className={writePicker ? "btn btn-quiet" : "btn btn-primary"}
              >
                <Archive size={15} aria-hidden />
                {t(locale, "materials.exportZip")}
              </button>
            </>
          ) : null}
          {courses.length > 0 && !demo ? (
            <button
              type="button"
              onClick={clearAll}
              className="btn btn-quiet"
            >
              <Trash2 size={15} aria-hidden />
              {t(locale, "materials.clear")}
            </button>
          ) : null}
        </div>
      </div>}

      {receive.phase === "connected" || receive.phase === "receiving" ? (
        <p className="mt-4 rounded-lg bg-[var(--accent-soft)] px-3.5 py-2.5 text-sm font-medium text-[var(--accent-ink)]" role="status">
          {t(locale, "materials.receiving", { stored: receive.stored, total: receive.expected })}
        </p>
      ) : receive.phase === "done" ? (
        <p className="mt-4 rounded-lg bg-[var(--success-soft)] px-3.5 py-2.5 text-sm font-medium text-[var(--success)]" role="status">
          {t(locale, "materials.received", { stored: receive.stored })}
          {receive.failed ? t(locale, "materials.receivedFailed", { count: receive.failed }) : ""}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-lg bg-[var(--subtle)] px-3.5 py-2.5 text-sm" role="status">
          {notice}
        </p>
      ) : null}
      {unavailable ? <p className="mt-4 text-sm text-[var(--danger)]">{t(locale, "materials.unavailable")}</p> : null}

      {demo ? <DemoNote /> : null}

      {!ready ? (
        <ListSkeleton label={t(locale, "common.loading")} />
      ) : shown.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--line-strong)] p-6">
          <p className="text-sm font-semibold">{t(locale, "materials.emptyTitle")}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{t(locale, "materials.emptyBody")}</p>
          <button type="button" onClick={openSyncCenter} className="tap-link mt-3 inline-flex text-sm font-semibold text-[var(--link)] hover:underline">
            {t(locale, "materials.emptyCta")}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {course ? null : <><Chip active={courseFilter === null} onClick={() => setCourseFilter(null)}>
              {t(locale, "materials.allCourses")}
            </Chip>
            {courses.map((course) => (
              <Chip key={course.id} active={courseFilter === course.id} onClick={() => setCourseFilter(course.id)}>
                {courseColorFor(course.code ?? undefined) ? (
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: courseColorFor(course.code ?? undefined)! }} aria-hidden />
                ) : null}
                {course.code ?? course.id}
                <span className="opacity-70">{course.files.length}</span>
              </Chip>
            ))}</>}
            <span className="text-xs text-[var(--muted)]">
              {t(locale, "materials.summary", { received: counts.received, files: counts.fileCount })}
              {usage !== null ? " · " + t(locale, "materials.usage", { used: formatBytes(usage) }) : ""}
            </span>
            <span className="ml-auto flex gap-3 text-xs font-medium">
              <button type="button" onClick={() => setAll(true)} className="text-[var(--link)] hover:underline">
                {t(locale, "materials.expandAll")}
              </button>
              <button type="button" onClick={() => setAll(false)} className="text-[var(--link)] hover:underline">
                {t(locale, "materials.collapseAll")}
              </button>
            </span>
          </div>

          <SyllabusSummaryHint locale={locale} />

          <div className="mt-4 space-y-3">
            {shown.map((course) => {
              const outline = huskyctCourseUrl(course);
              const videos = course.links.filter((link) => link.kind === "video");
              const links = course.links.filter((link) => link.kind === "link");
              const courseKey = courseKeyOf(course.id);
              // Picking a course with its chip is asking to see it.
              const courseOpen = open.has(courseKey) || courseFilter === course.id || shown.length === 1;
              const missing = course.files.filter((file) => !files.has(file.key)).length;
              const fresh = course.files.filter((file) => unseen.has(file.key)).length;
              const group = (name: string) => groupKeyOf(course.id, name);
              return (
                <article key={course.id} className="card overflow-hidden">
                  <div className="flex items-center pr-3">
                  <Toggle
                    open={courseOpen}
                    onToggle={() => toggle(courseKey)}
                    className="flex-1 px-5 py-3.5 hover:bg-[var(--subtle)]"
                    icon={
                      <span
                        className="size-2.5 shrink-0 rounded-full bg-[var(--blue)]"
                        style={courseColorFor(course.code ?? undefined) ? { backgroundColor: courseColorFor(course.code ?? undefined)! } : undefined}
                        aria-hidden
                      />
                    }
                    title={<span className="font-display text-base font-semibold">{course.code ?? course.id}</span>}
                    detail={
                      t(locale, "materials.courseSummary", {
                        files: course.files.length,
                        videos: videos.length,
                        links: links.length + course.tools.length,
                      }) + (fresh ? " · " + t(locale, "seen.newCount", { count: fresh }) : "") + (missing ? " · " + t(locale, "materials.courseMissing", { count: missing }) : "")
                    }
                  />
                  {course.files.length > missing ? (
                    <PartButton
                      label={t(locale, "materials.downloadPart", { name: course.code ?? course.id })}
                      disabled={exporting}
                      onClick={() => void exportPart(course.id, [])}
                    />
                  ) : null}
                  </div>

                  {courseOpen ? (
                    <div className="rise-in border-t border-[var(--line)] px-5 pb-4">
                      <SyllabusSummaryCard courseId={course.id} locale={locale} />
                      <FolderView
                        node={folderTree(course.files)}
                        isOpen={(folder) => open.has(group(folder.path.join("/")))}
                        onToggle={(folder) => toggle(group(folder.path.join("/")))}
                        onDownload={(folder) => void exportPart(course.id, folder.path)}
                        downloadLabel={(folder) => t(locale, "materials.downloadPart", { name: folder.name })}
                        downloadDisabled={exporting}
                        renderFile={(ref) => {
                          const file = files.get(ref.key);
                          return (
                            <li key={ref.key} className="-mx-2 flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 transition hover:bg-[var(--subtle)]">
                              <span className="flex min-w-0 items-center gap-2.5 text-sm">
                                <FileIcon name={file?.name ?? ref.title} />
                                <span className="truncate">{file?.name ?? ref.title}</span>
                                {unseen.has(ref.key) ? <span className="shrink-0 rounded bg-[var(--warning-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--warning)]">{t(locale, "seen.new")}</span> : null}
                                {file ? <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{formatBytes(file.size)}</span> : null}
                              </span>
                              {file ? (
                                <span className="flex shrink-0 gap-1.5">
                                  <SmallButton onClick={() => openFile(file, false)}>{t(locale, "materials.open")}</SmallButton>
                                  <SmallButton onClick={() => openFile(file, true)} label={t(locale, "materials.download")}>
                                    <Download size={14} aria-hidden />
                                  </SmallButton>
                                </span>
                              ) : (
                                <span className="text-xs text-[var(--muted)]">{t(locale, "materials.missing")}</span>
                              )}
                            </li>
                          );
                        }}
                      />

                      <LinkGroup
                        heading={t(locale, "materials.videos")}
                        items={videos}
                        open={open.has(group("#videos"))}
                        onToggle={() => toggle(group("#videos"))}
                        icon={<PlayCircle size={15} className="shrink-0 text-[var(--danger)]" aria-hidden />}
                      />
                      <LinkGroup
                        heading={t(locale, "materials.links")}
                        items={links}
                        open={open.has(group("#links"))}
                        onToggle={() => toggle(group("#links"))}
                        icon={<ExternalLink size={15} className="shrink-0 text-[var(--blue)]" aria-hidden />}
                      />
                      <LinkGroup
                        heading={t(locale, "materials.tools")}
                        items={course.tools.map((tool) => ({ ...tool, url: tool.url ?? outline }))}
                        open={open.has(group("#tools"))}
                        onToggle={() => toggle(group("#tools"))}
                        icon={<Wrench size={15} className="shrink-0 text-[var(--muted)]" aria-hidden />}
                      />
                    </div>
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
