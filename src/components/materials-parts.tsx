"use client";

import {
  ChevronRight,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Archive,
  Folder,
  Presentation,
} from "lucide-react";

import type { FolderNode, MaterialFileRef } from "@/lib/materials";

// The Materials page's small parts: chips, toggles, file icons, folders and link groups.

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition ${
        active ? "bg-[var(--ink)] text-[var(--surface)]" : "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--subtle)]"
      }`}
    >
      {children}
    </button>
  );
}

/** The small download beside a course or a folder: its files as a ZIP of their own. */
export function PartButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="tap-icon grid size-7 shrink-0 place-items-center rounded-md text-[var(--muted)] transition hover:bg-[var(--subtle)] hover:text-[var(--ink)] disabled:cursor-wait disabled:opacity-50"
    >
      <Archive size={15} aria-hidden />
    </button>
  );
}

/** A file's icon by its kind, so a PDF, a slide deck and a spreadsheet are told apart at a glance. */
export function FileIcon({ name }: { name: string }) {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  const [Icon, tone] =
    ext === "pdf"
      ? [FileText, "text-[var(--danger)]"]
      : ["ppt", "pptx", "key"].includes(ext)
        ? [Presentation, "text-[var(--warning)]"]
        : ["xls", "xlsx", "csv", "numbers"].includes(ext)
          ? [FileSpreadsheet, "text-[var(--success)]"]
          : ["doc", "docx", "txt", "rtf", "pages", "md"].includes(ext)
            ? [FileText, "text-[var(--blue)]"]
            : ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext)
              ? [FileImage, "text-[var(--accent-ink)]"]
              : ["zip", "rar", "7z", "gz"].includes(ext)
                ? [FileArchive, "text-[var(--muted)]"]
                : [File, "text-[var(--muted)]"];
  return <Icon size={16} className={`shrink-0 ${tone}`} aria-hidden />;
}

export function SmallButton({ onClick, label, children }: { onClick: () => void; label?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="btn btn-quiet h-7 px-2 text-xs"
    >
      {children}
    </button>
  );
}

/**
 * One folder's files, then its folders, each closed until opened. At the top
 * of a course the files are shown directly: the course is already the folder.
 */
export function FolderView({
  node,
  isOpen,
  onToggle,
  onDownload,
  downloadLabel,
  downloadDisabled,
  renderFile,
}: {
  node: FolderNode<MaterialFileRef>;
  isOpen: (folder: FolderNode<MaterialFileRef>) => boolean;
  onToggle: (folder: FolderNode<MaterialFileRef>) => void;
  onDownload: (folder: FolderNode<MaterialFileRef>) => void;
  downloadLabel: (folder: FolderNode<MaterialFileRef>) => string;
  downloadDisabled: boolean;
  renderFile: (file: MaterialFileRef) => React.ReactNode;
}) {
  return (
    <>
      {node.items.length ? <ul className="mt-2 space-y-0.5">{node.items.map(renderFile)}</ul> : null}
      {node.children.map((child) => {
        const childOpen = isOpen(child);
        return (
          <div key={child.name} className="mt-2">
            <div className="flex items-center gap-1">
              <Toggle
                open={childOpen}
                onToggle={() => onToggle(child)}
                className="flex-1"
                icon={<Folder size={15} className="shrink-0 fill-[var(--warning-soft)] text-[var(--warning)]" aria-hidden />}
                title={<span className="text-sm font-medium">{child.name}</span>}
                detail={String(child.total)}
              />
              <PartButton label={downloadLabel(child)} disabled={downloadDisabled} onClick={() => onDownload(child)} />
            </div>
            {childOpen ? (
              <div className="rise-in ml-2 border-l border-[var(--line)] pl-4">
                <FolderView node={child} isOpen={isOpen} onToggle={onToggle} onDownload={onDownload} downloadLabel={downloadLabel} downloadDisabled={downloadDisabled} renderFile={renderFile} />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** A header that opens and closes what is under it. */
export function Toggle({
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
        className={`shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-90" : ""}`}
        aria-hidden
      />
      {icon}
      <span className="min-w-0 truncate">{title}</span>
      {detail ? <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{detail}</span> : null}
    </button>
  );
}

export function LinkGroup({
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
        title={<span className="text-sm font-medium">{heading}</span>}
        detail={String(items.length)}
      />
      {open ? (
        <ul className="rise-in ml-6 mt-1.5 space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex min-w-0 items-center gap-2.5 text-sm">
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
