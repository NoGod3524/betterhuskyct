"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { useCalendar } from "@/components/calendar-provider";
import type { GradesSnapshot } from "@/lib/grades";
import { openGradesStore } from "@/lib/grades-store";
import { t } from "@/lib/i18n";
import type { MaterialsIndex } from "@/lib/materials";
import { openMaterialsStore } from "@/lib/materials-store";
import { SEARCH_KINDS, searchAll } from "@/lib/search";

/**
 * One search over what this app holds: the tasks, the announcements, the course files and the
 * graded items. It opens from the header or with Ctrl+K (Cmd+K on a Mac). The materials and the
 * grades live in the browser's own storage, so they are read when it opens, not on every page.
 */
export function SearchPalette({ iconButton }: { iconButton: string }) {
  const { locale, tasks, announcements } = useCalendar();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [materials, setMaterials] = useState<MaterialsIndex | null>(null);
  const [grades, setGrades] = useState<GradesSnapshot | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    let live = true;
    openMaterialsStore()
      .then((store) => store.getIndex())
      .then((index) => {
        if (live) setMaterials(index);
      })
      .catch(() => {});
    openGradesStore()
      .then((store) => store.get())
      .then((snapshot) => {
        if (live) setGrades(snapshot);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open]);

  const results = useMemo(
    () => searchAll(query, { tasks, announcements, materials, grades }),
    [query, tasks, announcements, materials, grades],
  );

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (results[0]) go(results[0].href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t(locale, "search.open")}
        title={t(locale, "search.open")}
        className={iconButton}
      >
        <Search size={16} />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-start bg-black/40 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t(locale, "search.open")}
            onClick={(event) => event.stopPropagation()}
            className="card mx-auto w-full max-w-xl overflow-hidden"
          >
            <form onSubmit={submit} className="flex items-center gap-2 border-b border-[var(--line)] px-3">
              <Search size={16} className="shrink-0 text-[var(--muted)]" aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t(locale, "search.placeholder")}
                aria-label={t(locale, "search.placeholder")}
                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              <button type="button" onClick={() => setOpen(false)} aria-label={t(locale, "search.close")} className="grid size-8 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--subtle)]">
                <X size={16} />
              </button>
            </form>
            <div className="max-h-[60vh] overflow-y-auto p-2 text-sm">
              {query.trim() === "" ? (
                <p className="px-2 py-3 text-xs text-[var(--muted)]">{t(locale, "search.hint")}</p>
              ) : results.length === 0 ? (
                <p className="px-2 py-3 text-[var(--muted)]">{t(locale, "search.empty", { query: query.trim() })}</p>
              ) : (
                SEARCH_KINDS.map((kind) => {
                  const group = results.filter((result) => result.kind === kind);
                  if (group.length === 0) return null;
                  return (
                    <section key={kind} className="mb-1">
                      <h3 className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                        {t(locale, `search.kind.${kind}`)}
                      </h3>
                      <ul>
                        {group.map((result) => (
                          <li key={`${kind}-${result.id}`}>
                            <button
                              type="button"
                              onClick={() => go(result.href)}
                              className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-[var(--subtle)] focus-visible:bg-[var(--subtle)]"
                            >
                              <span className="block truncate font-medium">{result.title}</span>
                              {result.detail ? <span className="block truncate text-xs text-[var(--muted)]">{result.detail}</span> : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
