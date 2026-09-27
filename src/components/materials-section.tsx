"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, ExternalLink, FileText, FolderInput, Folder, PlayCircle, Trash2, Wrench } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import { t } from "@/lib/i18n";
import {
  createMaterialsReceiver,
  formatBytes,
  groupByFolder,
  huskyctCourseUrl,
  importMaterialsFolder,
  parseLinksPage,
  type DirectoryHandle,
  type MaterialsIndex,
  type MaterialsStore,
  type ReceiveState,
  type StoredFile,
} from "@/lib/materials";
import { openMaterialsStore } from "@/lib/materials-store";

type Picker = (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<DirectoryHandle>;

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
  const [notice, setNotice] = useState<string | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [openStore, reload]);

  // The helper's deliveries. Refreshing the list after every file would redraw
  // a long page dozens of times, so it waits for a pause between files.
  useEffect(() => {
    if (!store) return;
    const receiver = createMaterialsReceiver({
      store,
      onChange: (state) => {
        setReceive(state);
        if (state.phase === "receiving") {
          // Asked once: a store the browser may clear under pressure is not a
          // place to keep a term's files.
          navigator.storage?.persist?.().catch(() => undefined);
        }
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => void reload(store), state.phase === "done" ? 0 : 800);
      },
    });
    const listener = (event: MessageEvent) => {
      void receiver({ origin: event.origin, data: event.data, source: event.source as Window | null });
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [store, reload]);

  const courses = useMemo(() => index?.courses ?? [], [index]);
  const shown = courseFilter ? courses.filter((course) => course.id === courseFilter) : courses;
  const picker = typeof window !== "undefined" ? (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker : undefined;

  const counts = useMemo(() => {
    const fileCount = courses.reduce((total, course) => total + course.files.length, 0);
    const received = courses.reduce((total, course) => total + course.files.filter((file) => files.has(file.key)).length, 0);
    return { fileCount, received };
  }, [courses, files]);

  function open(file: StoredFile, download: boolean) {
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

  async function importFolder() {
    if (!store || !picker) return;
    let root: DirectoryHandle;
    try {
      root = await picker({ id: "huskyct-materials", mode: "read" });
    } catch {
      return;
    }
    setNotice(t(locale, "materials.importing", { count: 0 }));
    try {
      const result = await importMaterialsFolder(root, store, {
        onProgress: (count) => setNotice(t(locale, "materials.importing", { count })),
        parseLinks: (html) => parseLinksPage(html, (source) => new DOMParser().parseFromString(source, "text/html")),
      });
      navigator.storage?.persist?.().catch(() => undefined);
      setNotice(t(locale, "materials.imported", result));
    } catch {
      setNotice(t(locale, "materials.importFailed"));
    }
    await reload(store);
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
          {picker ? (
            <button
              type="button"
              onClick={importFolder}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#cdd9e6] bg-white px-3 text-sm font-semibold text-[#4e647b] transition hover:border-[#9fb7d1] hover:text-[#244e7a]"
            >
              <FolderInput size={15} aria-hidden />
              {t(locale, "materials.import")}
            </button>
          ) : null}
          {courses.length > 0 ? (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#cdd9e6] bg-white px-3 text-sm font-semibold text-[#4e647b] transition hover:border-[#9fb7d1] hover:text-[#244e7a]"
            >
              <Trash2 size={15} aria-hidden />
              {t(locale, "materials.clear")}
            </button>
          ) : null}
        </div>
      </div>

      {receive.phase === "connected" || receive.phase === "receiving" ? (
        <p className="mt-4 rounded-xl bg-[#eef4ff] px-4 py-3 text-sm font-semibold text-[#244e7a]" role="status">
          {t(locale, "materials.receiving", { stored: receive.stored, total: receive.expected })}
        </p>
      ) : receive.phase === "done" ? (
        <p className="mt-4 rounded-xl bg-[#ecf8f1] px-4 py-3 text-sm font-semibold text-[#1d6b43]" role="status">
          {t(locale, "materials.received", { stored: receive.stored })}
          {receive.failed ? t(locale, "materials.receivedFailed", { count: receive.failed }) : ""}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-xl bg-[#f4f7fb] px-4 py-3 text-sm text-[#31506f]" role="status">
          {notice}
        </p>
      ) : null}
      {unavailable ? <p className="mt-4 text-sm text-[#b3412e]">{t(locale, "materials.unavailable")}</p> : null}

      {courses.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[#d7e1ec] bg-[#fafcff] p-5">
          <p className="text-sm font-semibold text-[#31506f]">{t(locale, "materials.emptyTitle")}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{t(locale, "materials.emptyBody")}</p>
          <Link href="/helper" className="mt-3 inline-flex text-sm font-semibold text-[var(--blue)] hover:underline">
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
          </div>

          <div className="mt-4 space-y-5">
            {shown.map((course) => {
              const outline = huskyctCourseUrl(course);
              const videos = course.links.filter((link) => link.kind === "video");
              const links = course.links.filter((link) => link.kind === "link");
              return (
                <article
                  key={course.id}
                  className="rounded-[20px] border border-[var(--line)] bg-white p-5 shadow-[0_8px_30px_rgba(31,58,92,0.05)]"
                >
                  <h3 className="font-display text-lg font-semibold text-[#172b41]">{course.code ?? course.id}</h3>

                  {groupByFolder(course.files).map((group) => (
                    <div key={group.folder.join("/") || "_"} className="mt-4">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#6b7f94]">
                        <Folder size={13} aria-hidden />
                        {group.folder.length ? group.folder.join(" / ") : t(locale, "materials.rootFolder")}
                      </p>
                      <ul className="mt-1.5 divide-y divide-[#eef2f6]">
                        {group.items.map((ref) => {
                          const file = files.get(ref.key);
                          return (
                            <li key={ref.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                              <span className="flex min-w-0 items-center gap-2 text-sm text-[#172b41]">
                                <FileText size={15} className="shrink-0 text-[#6b7f94]" aria-hidden />
                                <span className="truncate">{file?.name ?? ref.title}</span>
                                {file ? <span className="shrink-0 text-xs text-[var(--muted)]">{formatBytes(file.size)}</span> : null}
                              </span>
                              {file ? (
                                <span className="flex shrink-0 gap-1.5">
                                  <SmallButton onClick={() => open(file, false)}>{t(locale, "materials.open")}</SmallButton>
                                  <SmallButton onClick={() => open(file, true)} label={t(locale, "materials.download")}>
                                    <Download size={14} aria-hidden />
                                  </SmallButton>
                                </span>
                              ) : (
                                <span className="text-xs text-[var(--muted)]">{t(locale, "materials.missing")}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}

                  <LinkList
                    heading={t(locale, "materials.videos")}
                    items={videos}
                    icon={<PlayCircle size={15} className="shrink-0 text-[#6b7f94]" aria-hidden />}
                  />
                  <LinkList
                    heading={t(locale, "materials.links")}
                    items={links}
                    icon={<ExternalLink size={15} className="shrink-0 text-[#6b7f94]" aria-hidden />}
                  />
                  {course.tools.length ? (
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#6b7f94]">{t(locale, "materials.tools")}</p>
                      <ul className="mt-1.5 space-y-1.5">
                        {course.tools.map((tool, i) => (
                          <li key={i} className="flex items-center gap-2 text-sm text-[#172b41]">
                            <Wrench size={15} className="shrink-0 text-[#6b7f94]" aria-hidden />
                            {outline ? (
                              <a href={outline} target="_blank" rel="noreferrer" className="text-[var(--blue)] hover:underline">
                                {tool.title}
                              </a>
                            ) : (
                              tool.title
                            )}
                            {tool.path.length ? <span className="text-xs text-[var(--muted)]">{tool.path.join(" / ")}</span> : null}
                          </li>
                        ))}
                      </ul>
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
        active ? "bg-[var(--navy)] text-white" : "border border-[#cdd9e6] bg-white text-[#4e647b] hover:border-[#9fb7d1]"
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
      className="inline-flex h-7 items-center rounded-md border border-[#cdd9e6] bg-white px-2 text-xs font-semibold text-[#244e7a] transition hover:border-[#9fb7d1]"
    >
      {children}
    </button>
  );
}

function LinkList({
  heading,
  items,
  icon,
}: {
  heading: string;
  items: Array<{ path: string[]; title: string; url: string }>;
  icon: React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#6b7f94]">{heading}</p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex min-w-0 items-center gap-2 text-sm">
            {icon}
            <a href={item.url} target="_blank" rel="noreferrer" className="truncate text-[var(--blue)] hover:underline">
              {item.title}
            </a>
            {item.path.length ? <span className="shrink-0 text-xs text-[var(--muted)]">{item.path.join(" / ")}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
