import assert from "node:assert/strict";
import test from "node:test";

import { svgDataUrl, syncQrSvg } from "../src/lib/sync-qr.ts";

test("a typical sync link draws as a QR code", async () => {
  const link = "https://betterhuskyct.vercel.app/#sync=" + "H4sIAAAAAAAAA".repeat(120);
  const svg = await syncQrSvg(link);

  assert.ok(svg, "a link this size fits");
  assert.match(svg, /<svg[\s>]/);
});

test("a link too large for any QR code gives null, so the page can say to copy it", async () => {
  const link = "https://betterhuskyct.vercel.app/#sync=" + "x".repeat(4000);

  assert.equal(await syncQrSvg(link), null);
});

test("the image source is an SVG data URL with the markup encoded", () => {
  const url = svgDataUrl('<svg a="1"></svg>');

  assert.ok(url.startsWith("data:image/svg+xml;charset=utf-8,"));
  assert.ok(url.endsWith(encodeURIComponent('<svg a="1"></svg>')));
});
