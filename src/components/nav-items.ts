import {
  Award,
  CalendarDays,
  Check,
  FolderOpen,
  LayoutDashboard,
  Megaphone,
  Puzzle,
  type LucideIcon,
} from "lucide-react";

import type { TranslationKey } from "@/lib/i18n";

export type NavItem = { href: string; key: TranslationKey; Icon: LucideIcon };

/**
 * Every page, in the order the sidebar lists them. The sidebar shows them all
 * on a wide screen; on a phone the bottom bar shows the first few and puts the
 * rest behind "More". A page that is in neither list is a page nobody on a
 * phone can reach, so a test checks that every route has an entry here.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", key: "nav.dashboard", Icon: LayoutDashboard },
  { href: "/tasks", key: "nav.tasks", Icon: Check },
  { href: "/calendar", key: "nav.calendar", Icon: CalendarDays },
  { href: "/announcements", key: "nav.announcements", Icon: Megaphone },
  { href: "/materials", key: "nav.materials", Icon: FolderOpen },
  { href: "/grades", key: "nav.grades", Icon: Award },
  { href: "/helper", key: "nav.helper", Icon: Puzzle },
];

/** The bar's own slots: what a student opens most, one press away. */
export const PRIMARY_NAV: readonly NavItem[] = NAV_ITEMS.slice(0, 4);

/** Everything else, behind the bar's "More". */
export const MORE_NAV: readonly NavItem[] = NAV_ITEMS.slice(4);
