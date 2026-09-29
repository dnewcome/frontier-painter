// scripts/appstore-screenshots.mjs
// Renders the App Store screenshots from the real game (production build on
// vite preview at BASE_URL), staged through window.game, at Apple's exact
// pixel sizes (landscape):
//   iphone-6.9  2868x1320  (956x440 CSS @3x)
//   ipad-13     2752x2064  (1376x1032 CSS @2x)
// Output: ios/appstore/screenshots/<device>/NN-name.png (RGB, no alpha — the
// alpha channel is stripped afterwards; ASC silently fails files with alpha).
//
//   npm run build && npx vite preview --port 4173 &  node scripts/appstore-screenshots.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.BASE_URL || "http://localhost:4173";
const DEVICES = [
  { dir: "iphone-6.9", viewport: { width: 956, height: 440 }, dpr: 3, ua: "iPhone; CPU iPhone OS 18_0 like Mac OS X" },
  { dir: "ipad-13", viewport: { width: 1376, height: 1032 }, dpr: 2, ua: "iPad; CPU OS 18_0 like Mac OS X" },
];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

async function scene(dev, name, room, stage) {
  const ctx = await browser.newContext({
    viewport: dev.viewport,
    deviceScaleFactor: dev.dpr,
    isMobile: true,
    hasTouch: true,
    userAgent: `Mozilla/5.0 (${dev.ua}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1`,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/?room=${room}`);
  await page.waitForFunction(() => window.game && window.game.isReady(), null, { timeout: 60_000 });
  await stage(page, ctx);
  const out = path.join(ROOT, "ios/appstore/screenshots", dev.dir, `${name}.png`);
  mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, timeout: 120_000 });
  // Strip alpha (RGB only).
  execFileSync("python3", ["-c", `from PIL import Image; Image.open("${out}").convert("RGB").save("${out}")`]);
  console.log("wrote", path.relative(ROOT, out));
  await ctx.close();
}

/** Fly to `to` and come to rest there (moveTo eases in near the target;
 *  keep issuing it until the drift has stopped). */
const fly = (page, to, steps = 1500) =>
  page.evaluate(
    ([t, n]) => {
      const g = window.game;
      for (let i = 0; i < n; i++) {
        const s = g.getState();
        const d = Math.hypot(s.playerPos[0] - t[0], s.playerPos[1] - t[1], s.playerPos[2] - t[2]);
        if (d < 0.05 && Math.hypot(...s.velocity) < 0.05) break;
        g.moveTo(t);
        g.step(1 / 60, 1);
      }
    },
    [to, steps],
  );

for (const dev of DEVICES) {
  // 1. Mag boots: standing on the ceiling, the room upside down.
  await scene(dev, "01-walk-the-ceiling", "boots", async (page) => {
    await fly(page, [0, 5.3, -5]);
    await page.evaluate(() => {
      const g = window.game;
      g.setBoots(true);
      g.step(1 / 60, 30);
      // Face down the room (+Z): pick the yaw whose facing is +Z on this face.
      let best = 0;
      let bestZ = -2;
      for (let k = 0; k < 64; k++) {
        const y = (k / 64) * Math.PI * 2;
        g.setFacing(y, 0);
        const f = g.getState().facing;
        if (f[2] > bestZ) {
          bestZ = f[2];
          best = y;
        }
      }
      g.setFacing(best + 0.18, -0.32); // booted: negative pitch looks "up" = toward the floor
      g.step(1 / 60, 40);
    });
    await page.waitForTimeout(1500);
  });

  // 2. Painting: tracing the COLD spiral onto the overheated rail.
  await scene(dev, "02-trace-to-paint", "frostgap", async (page, ctx) => {
    await page.evaluate(() => {
      const g = window.game;
      g.selectColor("cold");
      g.setFacing(0.25, 0.12);
      g.step(1 / 60, 10);
    });
    await page.waitForTimeout(400);
    await page.locator('.t-btn[data-role="action"]', { hasText: "PAINT" }).tap();
    const pts = JSON.parse(await page.locator("#paint-trace").getAttribute("data-points"));
    const cdp = await ctx.newCDPSession(page);
    const T = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p[0], y: p[1], id: 1 }] : [] });
    await T("touchStart", pts[0]);
    for (let i = 1; i < Math.floor(pts.length * 0.7); i++) await T("touchMove", pts[i]);
    await page.waitForTimeout(300);
  });

  // 3. The frosted rail: an icy handhold arcing across the gap.
  await scene(dev, "03-frozen-handhold", "frostgap", async (page) => {
    await page.evaluate(() => {
      const g = window.game;
      g.selectColor("cold");
      g.paint("access-rail");
    });
    await fly(page, [2.2, 2.6, -5.5]);
    await page.evaluate(() => {
      window.game.setFacing(-0.12, -0.2);
      window.game.step(1 / 60, 5);
    });
    await page.waitForTimeout(1500);
  });

  // 4. Room clear: the exit door lights up.
  await scene(dev, "04-room-clear", "frostgap", async (page) => {
    await page.evaluate(() => {
      const g = window.game;
      g.selectColor("cold");
      g.paint("access-rail");
      g.selectColor("conductive");
      g.paint("power-conduit");
      g.step(1 / 60, 90);
    });
    await fly(page, [-0.8, 2.0, 1.0]);
    await page.evaluate(() => {
      window.game.setFacing(0.06, -0.04);
      window.game.step(1 / 60, 5);
    });
    await page.waitForTimeout(3200); // past the ROOM CLEAR flash: glow + EXIT marker
  });

  // 5. Order matters: frosting the shroud revealed the power core behind it.
  await scene(dev, "05-right-order", "crosswire", async (page) => {
    await page.evaluate(() => {
      const g = window.game;
      g.selectColor("cold");
      g.paint("coolant-shroud");
      g.selectColor("conductive");
    });
    await fly(page, [-1.4, 1.9, 7.0]);
    await page.evaluate(() => {
      window.game.setFacing(-0.38, -0.08);
      window.game.step(1 / 60, 5);
    });
    await page.waitForTimeout(1500);
  });
}
await browser.close();
