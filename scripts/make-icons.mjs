// scripts/make-icons.mjs — regenerate the app icons in public/ from one SVG.
// Rendered with headless Chromium (no ImageMagick/librsvg needed):
//   node scripts/make-icons.mjs
// Design: art/icon/designs.mjs (v1, "Porthole stroke"). Full-bleed and opaque —
// iOS applies its own rounded mask.
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The icon artwork lives in art/icon/designs.mjs ("Porthole stroke": a riveted
// porthole onto space with the tri-colour brush stroke painted across the glass).
const { ICON_SVG: SVG } = await import("../art/icon/designs.mjs");

const OUT = [
  ["public/icon-512.png", 512],
  ["public/icon-192.png", 192],
  ["public/apple-touch-icon.png", 180],
  // iOS (Capacitor) App Store icon: single 1024 universal slot, opaque RGB.
  ["ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", 1024],
];

// iOS launch screen: dark field with the icon glyph + FRONTIER PAINTER
// wordmark (matching the in-game title screen). The storyboard aspect-fills
// this 2732x2732 image, so on a landscape phone only a ~1260 px band through
// the middle shows: keep everything inside it.
const SPLASH_SIZE = 2732;
const SPLASH_OUT = [
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png",
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png",
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png",
];

const browser = await chromium.launch({ headless: true });
try {
  for (const [file, size] of OUT) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;background:#02040a">${SVG}</body></html>`,
    );
    await page.screenshot({ path: path.join(ROOT, file), omitBackground: false });
    await page.close();
    console.log(`wrote ${file} (${size}x${size})`);
  }
  const page = await browser.newPage({
    viewport: { width: SPLASH_SIZE, height: SPLASH_SIZE },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<html><body style="margin:0;background:radial-gradient(ellipse at 50% 45%,#0b1628,#05080f 60%);` +
      `display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:44px;` +
      `font-family:'DejaVu Sans Mono',ui-monospace,monospace;color:#e8f2ff">` +
      `<div style="width:330px;height:330px;border-radius:74px;overflow:hidden">${SVG}</div>` +
      `<div style="text-align:center;font-weight:800;font-size:150px;line-height:0.95;letter-spacing:0.14em;` +
      `text-shadow:0 0 40px rgba(140,217,255,0.35)">FRONTIER` +
      `<div style="font-size:92px;letter-spacing:0.34em;margin-top:18px;background:linear-gradient(90deg,#8cd9ff,#ffa829 55%,#b86bff);` +
      `-webkit-background-clip:text;background-clip:text;color:transparent">PAINTER</div></div></body></html>`,
  );
  for (const file of SPLASH_OUT) {
    await page.screenshot({ path: path.join(ROOT, file) });
    console.log(`wrote ${file} (${SPLASH_SIZE}x${SPLASH_SIZE})`);
  }
  await page.close();
} finally {
  await browser.close();
}
