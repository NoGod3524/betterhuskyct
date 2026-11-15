import {
  BookOpen,
  CheckSquare,
  House,
  Settings,
  type LucideIcon,
} from "lucide-react";

import type { TranslationKey } from "@/lib/i18n";

/** A page inside a section, shown as a tab along the top of that section. */
export type SubPage = { href: string; key: TranslationKey };

/**
 * One of the four places the app has. The sidebar on a wide screen and the bar along the bottom
 * of a phone show the same four; the pages inside a section are tabs at the top of its pages.
 */
export type NavSection = { href: string; key: TranslationKey; Icon: LucideIcon; pages: readonly SubPage[] };

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    href: "/",
    key: "nav.today",
    Icon: House,
    pages: [
      { href: "/", key: "nav.today" },
      { href: "/changes", key: "nav.changes" },
    ],
  },
  {
    href: "/tasks",
    key: "nav.tasks",
    Icon: CheckSquare,
    pages: [
      { href: "/tasks", key: "nav.taskList" },
      { href: "/calendar", key: "nav.calendar" },
    ],
  },
  {
    href: "/announcements",
    key: "nav.courses",
    Icon: BookOpen,
    pages: [
      { href: "/announcements", key: "nav.announcements" },
      { href: "/materials", key: "nav.materials" },
      { href: "/grades", key: "nav.grades" },
    ],
  },
  {
    href: "/settings",
    key: "nav.settings",
    Icon: Settings,
    pages: [
      { href: "/settings", key: "nav.settings" },
      { href: "/backup", key: "nav.backup" },
      { href: "/privacy", key: "nav.privacy" },
      { href: "/about", key: "nav.about" },
    ],
  },
];

/** The section a route belongs to; an unknown route belongs to none. */
export function sectionFor(pathname: string): NavSection | null {
  return NAV_SECTIONS.find((section) => section.pages.some((page) => page.href === pathname)) ?? null;
}
