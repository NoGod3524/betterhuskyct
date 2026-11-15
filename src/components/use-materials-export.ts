"use client";

import { useState } from "react";

import { useCalendar } from "@/components/calendar-provider";
import { t } from "@/lib/i18n";
import type { MaterialsIndex, StoredFile } from "@/lib/materials";
import {
  LINKS_PAGE_NAMES,
  ZipTooBigError,
  buildZip,
  linksPageHtml,
  planPart,
  planExport,
  saveToDirectory,
  zipFileName,
  type WritableDirectory,
} from "@/lib/materials-export";

type WritePicker = (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<WritableDirectory>;

/**
 * Getting the files that have arrived onto the computer: into a folder the student picks, where
 * the browser allows it, or as a ZIP. What happens is said through `setNotice`.
 */
export function useMaterialsExport(
  index: MaterialsIndex | null,
  files: Map<string, StoredFile>,
  setNotice: (message: string | null) => void,
) {
  const { locale } = useCalendar();
  const writePicker =
    typeof window !== "undefined" ? (window as unknown as { showDirectoryPicker?: WritePicker }).showDirectoryPicker : undefined;
  const [exporting, setExporting] = useState(false);

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
    await downloadZip(ready.plan, ready.linksPage);
  }

  /** One course's files, or one of its folders', as a ZIP of its own. No links page: it holds the whole term's. */
  async function exportPart(courseId: string, path: string[]) {
    if (exporting || !index) return;
    const plan = planPart(index, files, courseId, path);
    if (plan.entries.length === 0) {
      setNotice(t(locale, "materials.exportNothing"));
      return;
    }
    await downloadZip(plan, undefined);
  }

  async function downloadZip(plan: ReturnType<typeof planExport>, linksPage: { name: string; html: string } | undefined) {
    const ready = { plan, linksPage };
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

  return { writePicker, exporting, exportToFolder, exportZip, exportPart };
}
