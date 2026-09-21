import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BetterHuskyCT — Course deadlines, organized",
    short_name: "BetterHuskyCT",
    description:
      "Turn your HuskyCT / Blackboard ICS calendar into a clean, private deadline dashboard.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f6fa",
    theme_color: "#0b2745",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
