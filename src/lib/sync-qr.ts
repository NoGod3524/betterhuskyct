/**
 * The sync link as a QR code, drawn in the browser.
 *
 * A phone camera that reads the code opens the same link the copy button gives,
 * so the phone takes the same route as before, with one scan in place of a paste.
 * The link is drawn here and never sent anywhere to be drawn: its fragment is the
 * student's data, and a QR service would see it.
 *
 * A link too long for a QR code gives `null`; the page then says to copy it instead.
 */
export async function syncQrSvg(link: string): Promise<string | null> {
  const { default: QRCode } = await import("qrcode");
  try {
    return await QRCode.toString(link, {
      type: "svg",
      // The lowest error correction holds the most data. A screen is a clean
      // source, so the extra redundancy buys little.
      errorCorrectionLevel: "L",
      margin: 1,
      color: { dark: "#172b41", light: "#ffffff" },
    });
  } catch {
    return null;
  }
}

/** The SVG as an image source, so it needs no DOM insertion of its own. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
