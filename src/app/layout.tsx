import type { Metadata, Viewport } from "next";
import "./globals.css";

import { AppShell } from "@/components/app-shell";
import { CalendarProvider } from "@/components/calendar-provider";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
// Single source of truth for the version shown in the footer.
import packageJson from "../../package.json";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  applicationName: "BetterHuskyCT",
  title: "BetterHuskyCT — Your course deadlines, organized",
  description:
    "Turn a HuskyCT or Blackboard ICS calendar into a clear, private deadline dashboard.",
  appleWebApp: {
    capable: true,
    title: "BetterHuskyCT",
    statusBarStyle: "default",
  },
  icons: {
    // Setting `icons` replaces the file-based convention, so the favicon that
    // `src/app/icon.tsx` serves from /icon has to be declared explicitly.
    icon: "/icon",
    apple: "/icons/icon-192.png",
  },
  openGraph: {
    title: "BetterHuskyCT",
    description: "Your course deadlines, organized.",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "BetterHuskyCT",
    description: "Your course deadlines, organized.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b2745",
  // Let the app draw under the notch/home indicator when installed,
  // paired with the safe-area padding on <main>.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {/* The provider and shell live in the layout, not in a page, so moving
            between routes keeps the imported tasks, completion state, language
            and reminder settings without re-mounting or flashing demo data. */}
        <CalendarProvider initialNow={new Date().toISOString()}>
          <AppShell version={packageJson.version}>{children}</AppShell>
        </CalendarProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
