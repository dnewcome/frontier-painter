// scripts/make-icons.mjs — regenerate the app icons in public/ from one SVG.
// Rendered with headless Chromium (no ImageMagick/librsvg needed):
//   node scripts/make-icons.mjs
// Design: a glowing frost-blue brush arc (the repaired rail) across deep space,
// with the copper (conductive) and violet (magnetic) palette accents. Full-bleed
// and opaque — iOS applies its own rounded mask to apple-touch-icon.
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const stars = [
  [70, 90, 2.2], [150, 60, 1.6], [300, 70, 2], [440, 110, 1.8], [470, 380, 2.2],
  [380, 440, 1.5], [60, 250, 1.4], [230, 420, 1.8], [330, 330, 1.2], [110, 460, 1.6],
]
  .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#cfe8ff" opacity="0.8"/>`)
  .join("");

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <radialGradient id="bg" cx="46%" cy="40%" r="78%">
      <stop offset="0" stop-color="#173063"/>
      <stop offset="0.55" stop-color="#0a1633"/>
      <stop offset="1" stop-color="#02040a"/>
    </radialGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="13" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="stroke" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#5fc8ff"/>
      <stop offset="1" stop-color="#c9f1ff"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  ${stars}
  <path d="M92 392 C 150 190, 320 128, 424 238" fill="none" stroke="url(#stroke)"
        stroke-width="38" stroke-linecap="round" filter="url(#glow)"/>
  <path d="M92 392 C 150 190, 320 128, 424 238" fill="none" stroke="#f2fbff"
        stroke-width="11" stroke-linecap="round" opacity="0.9"/>
  <circle cx="424" cy="238" r="34" fill="#ffa829" filter="url(#glow)"/>
  <circle cx="424" cy="238" r="14" fill="#fff3d6"/>
  <circle cx="150" cy="148" r="19" fill="#b86bff" filter="url(#glow)"/>
</svg>`;

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
