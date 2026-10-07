"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Archive,
  FolderDown,
  Folder,
  PlayCircle,
  Trash2,
  Wrench,
} from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { DELIVERY_EVENT, type DeliveryDetail } from "@/components/helper-deliveries";
import { ListSkeleton } from "@/components/list-skeleton";
import { SyllabusSummaryCard, SyllabusSummaryHint } from "@/components/syllabus-summary";
import { t } from "@/lib/i18n";
import {
  folderTree,
  foldersIn,
  formatBytes,
  huskyctCourseUrl,
  type FolderNode,
  type MaterialFileRef,
  type MaterialsIndex,
  type MaterialsStore,
  type ReceiveState,
  type StoredFile,
} from "@/lib/materials";
import { openMaterialsStore } from "@/lib/materials-store";
import {
  LINKS_PAGE_NAMES,
  ZipTooBigError,
  buildZip,
  linksPageHtml,
  planExport,
  saveToDirectory,
  zipFileName,
  type WritableDirectory,
} from "@/lib/materials-export";

type WritePicker = (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<WritableDirectory>;

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
export function MaterialsSection({ openStore = openMaterialsStore }: { openStore?: () => Promise<MaterialsStore> }) {
  const { locale } = useCalendar();
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

  const courses = useMemo(() => index?.courses ?? [], [index]);
  const shown = courseFilter ? courses.filter((course) => course.id === courseFilter) : courses;
  const writePicker =
    typeof window !== "undefined" ? (window as unknown as { showDirectoryPicker?: WritePicker }).showDirectoryPicker : undefined;
  const [exporting, setExporting] = useState(false);

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
    const url = URL.createObjectURL(file.blob);
    if (download) {
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

  /** Everything that has arrived, or null (with a word to the reader) if nothing has. */
  function exportPlan() {
    const plan = index ? planExport(index, files) : null;
    if (!index || !plan || plan.entries.length === 0) {
      setNotice(t(locale, "materials.exportNothing"));
      return null;
    }
    return { index, plan, linksPage: { name: LINKS_PAGE_NAMES[locale], html: linksPageHtml(index, locale) } };
  }

  async function exportToFolder() {
    if (!writePicker || exporting) return;
    const ready = exportPlan();
    if (!ready) return;
    // Said before the picker opens, because the browser's own refusal of the
    // Desktop does not say what to do instead.
    setNotice(t(locale, "materials.exportPick"));
    let root: WritableDirectory;
    try {
      root = await writePicker({ id: "bhc-materials-export", mode: "readwrite" });
    } catch {
      return; // closed without picking; the hint stays up
    }
    setExporting(true);
    try {
      const result = await saveToDirectory(root, ready.plan, {
        linksPage: ready.linksPage,
        onProgress: (done, total) => setNotice(t(locale, "materials.exporting", { done, total })),
      });
      setNotice(
        t(locale, "materials.exported", { saved: result.saved, skipped: result.skipped, failed: result.failed, folder: result.folder }) +
          (ready.plan.missing ? t(locale, "materials.exportMissing", { count: ready.plan.missing }) : ""),
      );
    } catch {
      setNotice(t(locale, "materials.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  async function exportZip() {
    if (exporting) return;
    const ready = exportPlan();
    if (!ready) return;
    setExporting(true);
    try {
      const blob = await buildZip(ready.plan, {
        linksPage: ready.linksPage,
        onProgress: (done, total) => setNotice(t(locale, "materials.zipping", { done, total })),
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = zipFileName(ready.plan);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice(
        t(locale, "materials.zipped", { name: zipFileName(ready.plan), count: ready.plan.entries.length }) +
          (ready.plan.missing ? t(locale, "materials.exportMissing", { count: ready.plan.missing }) : ""),
      );
    } catch (error) {
      setNotice(t(locale, error instanceof ZipTooBigError ? "materials.zipTooBig" : "materials.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  async function clearAll() {
    if (!store || !window.confirm(t(locale, "materials.clearConfirm"))) return;
    await store.clear();
    setCourseFilter(null);
    setNotice(null);
    await reload(store);
  }

  return (
    <section className="mt-10" aria-labelledby="materials-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t(locale, "materials.eyebrow")}</p>
          <h2 id="materials-heading" className="font-display mt-1 text-2xl font-semibold tracking-[-0.025em]">
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
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--navy)] px-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                >
                  <FolderDown size={15} aria-hidden />
                  {t(locale, "materials.exportFolder")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={exportZip}
                disabled={exporting}
                className={
                  writePicker
                    ? "inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--c-4e647b)] transition hover:border-[var(--c-9fb7d1)] hover:text-[var(--c-244e7a)] disabled:cursor-wait disabled:opacity-60"
                    : "inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--navy)] px-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                }
              >
                <Archive size={15} aria-hidden />
                {t(locale, "materials.exportZip")}
              </button>
            </>
          ) : null}
          {courses.length > 0 ? (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--c-4e647b)] transition hover:border-[var(--c-9fb7d1)] hover:text-[var(--c-244e7a)]"
            >
              <Trash2 size={15} aria-hidden />
              {t(locale, "materials.clear")}
            </button>
          ) : null}
        </div>
      </div>

      {receive.phase === "connected" || receive.phase === "receiving" ? (
        <p className="mt-4 rounded-xl bg-[var(--c-eef4ff)] px-4 py-3 text-sm font-semibold text-[var(--c-244e7a)]" role="status">
          {t(locale, "materials.receiving", { stored: receive.stored, total: receive.expected })}
        </p>
      ) : receive.phase === "done" ? (
        <p className="mt-4 rounded-xl bg-[var(--c-ecf8f1)] px-4 py-3 text-sm font-semibold text-[var(--c-1d6b43)]" role="status">
          {t(locale, "materials.received", { stored: receive.stored })}
          {receive.failed ? t(locale, "materials.receivedFailed", { count: receive.failed }) : ""}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-xl bg-[var(--c-f4f7fb)] px-4 py-3 text-sm text-[var(--c-31506f)]" role="status">
          {notice}
        </p>
      ) : null}
      {unavailable ? <p className="mt-4 text-sm text-[var(--c-b3412e)]">{t(locale, "materials.unavailable")}</p> : null}

      {!ready ? (
        <ListSkeleton label={t(locale, "common.loading")} />
      ) : courses.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[var(--c-d7e1ec)] bg-[var(--c-fafcff)] p-5">
          <p className="text-sm font-semibold text-[var(--c-31506f)]">{t(locale, "materials.emptyTitle")}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{t(locale, "materials.emptyBody")}</p>
          <Link href="/helper" className="tap-link mt-3 inline-flex text-sm font-semibold text-[var(--link)] hover:underline">
            {t(locale, "materials.emptyCta")}
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Chip active={courseFilter === null} onClick={() => setCourseFilter(null)}>
              {t(locale, "materials.allCourses")}
            </Chip>
            {courses.map((course) => (
              <Chip key={course.id} active={courseFilter === course.id} onClick={() => setCourseFilter(course.id)}>
                {course.code ?? course.id}
                <span className="opacity-70">{course.files.length}</span>
              </Chip>
            ))}
            <span className="text-xs text-[var(--muted)]">
              {t(locale, "materials.summary", { received: counts.received, files: counts.fileCount })}
              {usage !== null ? " · " + t(locale, "materials.usage", { used: formatBytes(usage) }) : ""}
            </span>
            <span className="ml-auto flex gap-3 text-xs font-semibold">
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
              const courseOpen = open.has(courseKey) || courseFilter === course.id;
              const missing = course.files.filter((file) => !files.has(file.key)).length;
              const group = (name: string) => groupKeyOf(course.id, name);
              return (
                <article
                  key={course.id}
                  className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-[0_8px_30px_rgba(31,58,92,0.05)]"
                >
                  <Toggle
                    open={courseOpen}
                    onToggle={() => toggle(courseKey)}
                    className="w-full px-5 py-4"
                    title={<span className="font-display text-lg font-semibold text-[var(--c-172b41)]">{course.code ?? course.id}</span>}
                    detail={
                      t(locale, "materials.courseSummary", {
                        files: course.files.length,
                        videos: videos.length,
                        links: links.length + course.tools.length,
                      }) + (missing ? " · " + t(locale, "materials.courseMissing", { count: missing }) : "")
                    }
                  />

                  {courseOpen ? (
                    <div className="rise-in border-t border-[var(--c-eef2f6)] px-5 pb-4">
                      <SyllabusSummaryCard courseId={course.id} locale={locale} />
                      <FolderView
                        node={folderTree(course.files)}
                        isOpen={(folder) => open.has(group(folder.path.join("/")))}
                        onToggle={(folder) => toggle(group(folder.path.join("/")))}
                        renderFile={(ref) => {
                          const file = files.get(ref.key);
                          return (
                            <li key={ref.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                              <span className="flex min-w-0 items-center gap-2 text-sm text-[var(--c-172b41)]">
                                <FileText size={15} className="shrink-0 text-[var(--c-6b7f94)]" aria-hidden />
                                <span className="truncate">{file?.name ?? ref.title}</span>
                                {file ? <span className="shrink-0 text-xs text-[var(--muted)]">{formatBytes(file.size)}</span> : null}
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
                        icon={<PlayCircle size={15} className="shrink-0 text-[var(--c-6b7f94)]" aria-hidden />}
                      />
                      <LinkGroup
                        heading={t(locale, "materials.links")}
                        items={links}
                        open={open.has(group("#links"))}
                        onToggle={() => toggle(group("#links"))}
                        icon={<ExternalLink size={15} className="shrink-0 text-[var(--c-6b7f94)]" aria-hidden />}
                      />
                      <LinkGroup
                        heading={t(locale, "materials.tools")}
                        items={course.tools.map((tool) => ({ ...tool, url: tool.url ?? outline }))}
                        open={open.has(group("#tools"))}
                        onToggle={() => toggle(group("#tools"))}
                        icon={<Wrench size={15} className="shrink-0 text-[var(--c-6b7f94)]" aria-hidden />}
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
        active ? "bg-[var(--navy)] text-white" : "border border-[var(--c-cdd9e6)] bg-[var(--surface)] text-[var(--c-4e647b)] hover:border-[var(--c-9fb7d1)]"
      }`}
    >
      {children}
    </button>
  );
}

function SmallButton({ onClick, label, children }: { onClick: () => void; label?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-7 items-center rounded-md border border-[var(--c-cdd9e6)] bg-[var(--surface)] px-2 text-xs font-semibold text-[var(--c-244e7a)] transition hover:border-[var(--c-9fb7d1)]"
    >
      {children}
    </button>
  );
}

/**
 * One folder's files, then its folders, each closed until opened. At the top
 * of a course the files are shown directly: the course is already the folder.
 */
function FolderView({
  node,
  isOpen,
  onToggle,
  renderFile,
}: {
  node: FolderNode<MaterialFileRef>;
  isOpen: (folder: FolderNode<MaterialFileRef>) => boolean;
  onToggle: (folder: FolderNode<MaterialFileRef>) => void;
  renderFile: (file: MaterialFileRef) => React.ReactNode;
}) {
  return (
    <>
      {node.items.length ? <ul className="mt-2 divide-y divide-[var(--c-eef2f6)]">{node.items.map(renderFile)}</ul> : null}
      {node.children.map((child) => {
        const childOpen = isOpen(child);
        return (
          <div key={child.name} className="mt-2">
            <Toggle
              open={childOpen}
              onToggle={() => onToggle(child)}
              icon={<Folder size={14} className="shrink-0 text-[var(--c-6b7f94)]" aria-hidden />}
              title={<span className="text-sm font-semibold text-[var(--c-31506f)]">{child.name}</span>}
              detail={String(child.total)}
            />
            {childOpen ? (
              <div className="rise-in ml-5 border-l border-[var(--c-eef2f6)] pl-3">
                <FolderView node={child} isOpen={isOpen} onToggle={onToggle} renderFile={renderFile} />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** A header that opens and closes what is under it. */
function Toggle({
  open,
  onToggle,
  title,
  detail,
  icon,
  className = "",
}: {
  open: boolean;
  onToggle: () => void;
  title: React.ReactNode;
  detail?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`flex min-w-0 items-center gap-2 text-left transition hover:opacity-80 ${className}`}
    >
      <ChevronRight
        size={16}
        className={`shrink-0 text-[var(--c-6b7f94)] transition-transform ${open ? "rotate-90" : ""}`}
        aria-hidden
      />
      {icon}
      <span className="min-w-0 truncate">{title}</span>
      {detail ? <span className="shrink-0 text-xs font-semibold text-[var(--muted)]">{detail}</span> : null}
    </button>
  );
}

function LinkGroup({
  heading,
  items,
  open,
  onToggle,
  icon,
}: {
  heading: string;
  items: Array<{ path: string[]; title: string; url: string | null }>;
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <Toggle
        open={open}
        onToggle={onToggle}
        title={<span className="text-sm font-semibold text-[var(--c-31506f)]">{heading}</span>}
        detail={String(items.length)}
      />
      {open ? (
        <ul className="rise-in ml-6 mt-1.5 space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex min-w-0 items-center gap-2 text-sm text-[var(--c-172b41)]">
              {icon}
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer" className="truncate text-[var(--link)] hover:underline">
                  {item.title}
                </a>
              ) : (
                <span className="truncate">{item.title}</span>
              )}
              {item.path.length ? <span className="shrink-0 text-xs text-[var(--muted)]">{item.path.join(" / ")}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
