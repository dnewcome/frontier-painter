// art/icon/variants.mjs — app icon concepts (SVG), rendered with headless Chromium.
//   node art/icon/variants.mjs   -> art/icon/v{1,2,3}.png (1024) + art/icon/compare.png
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));

import { V } from "./designs.mjs";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
for (const [k, body] of Object.entries(V)) {
  await page.setContent(`<html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1024" height="1024">${body}</svg></body></html>`);
  await page.screenshot({ path: path.join(HERE, `${k}.png`) });
}
// Comparison: each at 360 (large) with iOS-style rounded mask + a 60 px home-screen size.
const cmp = await browser.newPage({ viewport: { width: 1240, height: 560 } });
const { readFileSync } = await import("node:fs");
const uri = (k) => "data:image/png;base64," + readFileSync(path.join(HERE, k + ".png")).toString("base64");
const tile = (k, s) => `<img src="${uri(k)}" style="width:${s}px;height:${s}px;border-radius:${s * 0.2237}px;box-shadow:0 4px 14px rgba(0,0,0,.35)">`;
await cmp.setContent(`<html><body style="margin:0;background:#2b2f36;font:600 18px system-ui;color:#dfe6ee;display:flex;gap:40px;padding:40px">
  ${Object.keys(V).map((k, i) => `<div style="display:flex;flex-direction:column;align-items:center;gap:16px">${tile(k, 360)}<div style="display:flex;gap:18px;align-items:center">${tile(k, 60)}${tile(k, 40)}<span>${i + 1}</span></div></div>`).join("")}
  </body></html>`);
await cmp.waitForTimeout(300);
await cmp.screenshot({ path: path.join(HERE, "compare.png") });
await browser.close();
console.log("wrote", Object.keys(V).map((k) => k + ".png").join(", "), "compare.png");
