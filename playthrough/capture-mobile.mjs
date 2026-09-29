// playthrough/capture-mobile.mjs
//
// The PHONE playthrough: solves "The Frost Gap" on an emulated landscape iPhone
// (Chromium touch emulation, 3x DPR) using ONLY real touch input — swatch taps,
// tap-to-paint, the floating joystick, the GRAB button, and right-thumb look
// swipes. Closed-loop: it polls game state rather than guessing timings, because
// this path runs in real time (the rAF loop), not window.game.step().
//
//   first-run card -> Start -> wrong property rejected -> rail frosted ->
//   joystick to the rail -> GRAB -> joystick pulls along the rail -> swipe to aim
//   at the conduit -> tap it conductive -> console online, exit door opens ->
//   RELEASE, swipe to face the door, joystick through it -> room 2 loads
//
// Exits non-zero unless the console powers on AND the door leads to room 2. Outputs
// demos/<RUN_LABEL>/ (default "mobile"): frames/, demo.gif, demo.mp4.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_URL = process.env.BASE_URL || "http://localhost:4173";
const RUN_LABEL = process.env.RUN_LABEL || process.argv[2] || "mobile";
// DEVICE=ipad runs the same touch flow on an iPad mini-sized landscape screen.
const IPAD = process.env.DEVICE === "ipad";
const VIEWPORT = IPAD ? { width: 1133, height: 744 } : { width: 844, height: 390 }; // iPhone 15-ish
const DPR = IPAD ? 2 : 3;
const IPHONE_UA = IPAD
  ? "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
  : "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const RAIL_START = [0, 1.2, -6];

const outDir = path.join(ROOT, "demos", RUN_LABEL);
const framesDir = path.join(outDir, "frames");
const videoDir = path.join(outDir, "video");

const log = (...a) => console.log("[capture-mobile]", ...a);
const assert = (c, m) => {
  if (!c) throw new Error("ASSERT: " + m);
};
const humanSize = (b) =>
  b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`;

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const c = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("error", reject);
    c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-1500)))));
  });
}
function ffprobeDuration(file) {
  return new Promise((resolve) => {
    const c = spawn(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.on("exit", () => resolve(Number.isFinite(parseFloat(out)) ? parseFloat(out) : null));
    c.on("error", () => resolve(null));
  });
}

async function main() {
  rmSync(framesDir, { recursive: true, force: true });
  rmSync(videoDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(videoDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    recordVideo: { dir: videoDir, size: VIEWPORT },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);

  let frame = 1;
  const shot = async (id) => {
    await page.waitForTimeout(120);
    const name = `${String(frame++).padStart(2, "0")}-${id}.png`;
    await page.screenshot({ path: path.join(framesDir, name) });
    log("frame", name);
  };
  const st = () => page.evaluate(() => window.game.getState());
  const touch = (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 7 }],
    });
  /** Hold the joystick deflected until `done(state)` or timeout. */
  const holdStick = async (dx, dy, done, timeoutMs = 12_000) => {
    const [x0, y0] = [150, VIEWPORT.height - 90];
    await touch("touchStart", x0, y0);
    for (let i = 1; i <= 6; i++) await touch("touchMove", x0 + (dx * i) / 6, y0 + (dy * i) / 6);
    const t0 = Date.now();
    let s = await st();
    while (!done(s) && Date.now() - t0 < timeoutMs) {
      await page.waitForTimeout(60);
      s = await st();
    }
    await touch("touchEnd");
    return s;
  };
  const swipe = async (x0, y0, x1, y1) => {
    await touch("touchStart", x0, y0);
    for (let i = 1; i <= 10; i++) await touch("touchMove", x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10);
    await touch("touchEnd");
    await page.waitForTimeout(60);
  };
  const anchorOnScreen = (id) =>
    page.evaluate((sid) => {
      const s = window.game.getState().paintSurfaces.find((x) => x.id === sid);
      return s ? window.game.projectToScreen(s.anchor) : null;
    }, id);
  const tapSurface = async (id) => {
    const p = await anchorOnScreen(id);
    assert(p, `${id} is on screen`);
    await page.touchscreen.tap(p[0], p[1]);
  };
  const surf = (s, id) => s.paintSurfaces.find((x) => x.id === id);

  let won = false;
  try {
    // 01 first-run card
    await page.goto(BASE_URL, { waitUntil: "load" });
    await page.waitForFunction(() => window.game && window.game.isReady(), null, { timeout: 30_000 });
    await page.getByRole("button", { name: "Start" }).waitFor();
    await shot("intro");

    // 02 the room, phone UI
    await page.getByRole("button", { name: "Start" }).tap();
    await shot("phone-ui");

    // 03 wrong property -> rejected
    await page.locator('.t-swatch[data-color="conductive"]').tap();
    await tapSurface("access-rail");
    await page.locator(".t-toast", { hasText: "Rejected" }).waitFor();
    assert(!surf(await st(), "access-rail").satisfied, "03 rail still broken");
    await shot("rejected");

    // 04 right property -> frosted into a handhold
    await page.locator('.t-swatch[data-color="cold"]').tap();
    await tapSurface("access-rail");
    await page.locator(".t-toast", { hasText: "Repaired" }).waitFor();
    assert(surf(await st(), "access-rail").satisfied, "04 rail repaired");
    await shot("frost-rail");

    // 05 joystick forward to the rail
    const near = (s) =>
      Math.hypot(s.playerPos[0] - RAIL_START[0], s.playerPos[1] - RAIL_START[1], s.playerPos[2] - RAIL_START[2]) < 0.9;
    let s = await holdStick(0, -70, near);
    // Drift settles inside reach; wait briefly for it.
    for (let i = 0; i < 20 && !near(s); i++) {
      await page.waitForTimeout(60);
      s = await st();
    }
    assert(near(s), `05 reached the rail (pos ${s.playerPos.map((n) => n.toFixed(2))})`);
    await shot("approach");

    // 06 GRAB
    await page.locator('.t-btn[data-role="action"]').tap();
    await page.waitForFunction(() => window.game.getState().grabbing);
    await shot("grab");

    // 07 joystick forward pulls hand-over-hand along the rail
    s = await holdStick(0, -70, (x) => (x.grabT ?? 0) >= 0.99, 15_000);
    assert((s.grabT ?? 0) >= 0.99, `07 pulled across (grabT ${s.grabT})`);
    await shot("pull-across");

    // 08 aim: steer the conduit to screen center with look swipes (closed loop on
    // both axes). A finger move of 1px turns ~0.0045 rad ≈ 2.2px on screen near
    // center, so swipe by (error / 2.2). Off screen -> search to the right.
    const cx = VIEWPORT.width / 2;
    const cy = VIEWPORT.height / 2;
    for (let i = 0; i < 16; i++) {
      const p = await anchorOnScreen("power-conduit");
      if (p && Math.abs(p[0] - cx) < 45 && Math.abs(p[1] - cy) < 45) break;
      const clamp = (v) => Math.max(-70, Math.min(70, v));
      // Object right of center -> look right (finger right); above -> look up (finger up).
      const fdx = p ? clamp((p[0] - cx) / 2.2) : 60;
      const fdy = p ? clamp((p[1] - cy) / 2.2) : 0;
      await swipe(640, 220, 640 + fdx, 220 + fdy);
    }
    await shot("aim-conduit");
    await page.locator('.t-swatch[data-color="conductive"]').tap();
    await tapSurface("power-conduit");
    await page.locator(".t-toast", { hasText: "Repaired" }).waitFor();

    // 09 console online -> the exit door behind it opens
    await page.locator(".t-toast", { hasText: "exit door open" }).waitFor({ timeout: 10_000 });
    assert((await st()).goalReached === true, "09 console latched (goalReached)");
    await page.waitForFunction(() => window.game.getState().doorProgress >= 1);
    await shot("door-open");

    // 10 let go of the rail, turn to face the doorway (closed-loop look swipes)
    await page.locator('.t-btn[data-role="action"]').tap();
    await page.waitForFunction(() => !window.game.getState().grabbing);
    const exitOnScreen = () =>
      page.evaluate(() => window.game.projectToScreen(window.game.getState().exitAnchor));
    for (let i = 0; i < 20; i++) {
      const p = await exitOnScreen();
      if (p && Math.abs(p[0] - cx) < 30 && Math.abs(p[1] - cy) < 30) break;
      const clamp = (v) => Math.max(-70, Math.min(70, v));
      const fdx = p ? clamp((p[0] - cx) / 2.2) : 60;
      const fdy = p ? clamp((p[1] - cy) / 2.2) : 0;
      await swipe(640, 220, 640 + fdx, 220 + fdy);
    }
    assert(await exitOnScreen(), "10 facing the exit door");
    await shot("face-door");

    // 11 joystick forward, through the door -> fade to room 2's title card
    s = await holdStick(0, -70, (x) => x.roomCleared, 15_000);
    assert(s.roomCleared, `11 went through the door (pos ${s.playerPos.map((n) => n.toFixed(2))})`);
    await page.locator("#room-fade.on").waitFor();
    await page.waitForTimeout(500);
    await shot("room-2-card");

    // 12 room 2: the Cross-Wired Junction, sealed door, new wall stencils
    await page.waitForFunction(() => window.game.getState().scenario === "crosswire", null, { polling: 50 });
    await page.waitForFunction(() => !document.getElementById("room-fade").classList.contains("on"), null, { polling: 50 });
    await page.waitForTimeout(600);
    const r2 = await st();
    assert(!r2.doorOpen && !r2.goalReached, "12 room 2 starts sealed");
    won = true;
    await shot("room-2");

    if (errors.length) {
      log(`WARNING: ${errors.length} console error(s)`);
      for (const e of errors) log("  ", e);
    } else log("no console/page errors");
  } finally {
    await context.close();
    await browser.close();
  }
  if (!won) throw new Error("mobile playthrough did not reach room 2");

  const webm = readdirSync(videoDir).find((f) => f.endsWith(".webm"));
  const webmPath = path.join(videoDir, webm);
  const dur = await ffprobeDuration(webmPath);
  const factor = dur && dur > 14 ? dur / 14 : 1;
  const setpts = `setpts=PTS/${factor.toFixed(4)}`;
  const mp4 = path.join(outDir, "demo.mp4");
  const gif = path.join(outDir, "demo.gif");
  await ffmpeg(["-y", "-i", webmPath, "-vf", `${setpts},fps=15,scale=${VIEWPORT.width & ~1}:-2:flags=lanczos`, "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  await ffmpeg(["-y", "-i", webmPath, "-vf",
    `${setpts},fps=12,scale=720:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`, gif]);
  log(`wrote ${mp4} (${humanSize(statSync(mp4).size)}), ${gif} (${humanSize(statSync(gif).size)})`);
  log("MOBILE PLAYTHROUGH OK — solved on touch, through the door to room 2.");
}

main().catch((e) => {
  console.error("[capture-mobile] FAILED:", e?.message ?? e);
  process.exit(1);
});
