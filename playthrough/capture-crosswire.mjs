// playthrough/capture-crosswire.mjs
//
// Re-runnable playthrough/demo harness for the INTERACTION slice
// ("The Cross-Wired Junction") — room 2, where properties CHAIN. Drives the
// deterministic automation surface (window.game) end-to-end via the API only:
//
//   arm the crosswire scenario -> only a frosted coolant SHROUD is visible (the
//   power core behind it is hidden) -> painting the core is rejected while it is
//   inaccessible -> painting the shroud CONDUCTIVE is rejected (wrong property)
//   -> paint the shroud COLD: it retracts and REVEALS the power core -> now paint
//   the core CONDUCTIVE to power the console -> float to the console -> win.
//
// This proves "right property, right place, right ORDER": the second surface only
// becomes solvable once the first is repaired. Exits non-zero unless the console
// powers on and the goal latches, so it doubles as an end-to-end smoke test.
//
// Inputs (env):  BASE_URL (default http://localhost:4173), RUN_LABEL (default
// "crosswire"). Outputs under <root>/demos/<RUN_LABEL>/.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const BASE_URL = process.env.BASE_URL || "http://localhost:4173";
const RUN_LABEL = process.env.RUN_LABEL || process.argv[2] || "crosswire";
const VIEWPORT = { width: 1280, height: 720 };

// A vantage near the +Z junction wall (frames the shroud/core), and the console.
const VANTAGE = [-1, 1.5, 5];
const GOAL = [0, 1, 8];

const outDir = path.join(ROOT, "demos", RUN_LABEL);
const framesDir = path.join(outDir, "frames");
const videoDir = path.join(outDir, "video");

function log(...a) {
  console.log("[capture-crosswire]", ...a);
}
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}
function fmtVec(v) {
  return `[${v.map((n) => n.toFixed(2)).join(", ")}]`;
}
function humanSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}
function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-2000)}`)),
    );
  });
}
function ffprobeDuration(file) {
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve(null));
    child.on("exit", () => {
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) ? n : null);
    });
  });
}

const TARGET_MAX_SECONDS = 10;
const surf = (state, id) => state.paintSurfaces.find((s) => s.id === id) || null;

async function main() {
  // Wipe only the regenerated media (NOT the hand-written DEMO.md kept in git).
  rmSync(framesDir, { recursive: true, force: true });
  rmSync(videoDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(videoDir, { recursive: true });
  log(`BASE_URL=${BASE_URL}  RUN_LABEL=${RUN_LABEL}`);
  log(`output -> ${outDir}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: VIEWPORT },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  let frameIndex = 1;
  const settle = (frames = 2) =>
    page.evaluate(
      (n) =>
        new Promise((res) => {
          let i = 0;
          const tick = () => (++i >= n ? res() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
      frames,
    );
  const shot = async (id) => {
    await settle(2);
    const name = `${String(frameIndex++).padStart(2, "0")}-${id}.png`;
    await page.screenshot({ path: path.join(framesDir, name) });
    log(`frame ${name}`);
  };

  let goalReached = false;

  try {
    // -- 01 arrive: only the shroud is visible -----------------------------
    await page.goto(BASE_URL, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.game && window.game.isReady(), null, { timeout: 30_000 });
    const s1 = await page.evaluate(() => {
      const g = window.game;
      g.loadScenario("crosswire");
      g.setCameraMode("demo");
      return g.getState();
    });
    assert(s1.ready === true, "01: ready");
    assert(s1.paintSurfaces.length === 1, "01: only ONE surface is perceivable (the shroud)");
    assert(surf(s1, "coolant-shroud")?.required === "cold", "01: shroud needs cold");
    assert(surf(s1, "power-core") === null, "01: the power core is HIDDEN behind the shroud");
    assert(s1.paintComplete === false, "01: console not powered");
    log("01 arrive:", `visible=${s1.paintSurfaces.map((s) => s.id).join(",")} complete=${s1.paintComplete}`);
    await shot("arrive");

    // -- 02 approach the junction ------------------------------------------
    const s2 = await page.evaluate((v) => {
      const g = window.game;
      let st = g.getState();
      for (let i = 0; i < 800; i++) {
        g.moveTo(v);
        st = g.step(1 / 60, 1);
        const p = st.playerPos;
        if (Math.hypot(p[0] - v[0], p[1] - v[1], p[2] - v[2]) <= 0.6) break;
      }
      g.moveTo(g.getState().playerPos);
      return g.step(1 / 60, 1);
    }, VANTAGE);
    log("02 approach:", `pos=${fmtVec(s2.playerPos)}`);
    await shot("approach-junction");

    // -- 03 the core is locked ---------------------------------------------
    // Try to power the core NOW (conductive), before clearing the shroud. It is
    // inaccessible: rejected, and it is not even perceivable yet.
    const s3 = await page.evaluate(() => {
      const g = window.game;
      g.selectColor("conductive");
      const ok = g.paint("power-core");
      return { ok, state: g.getState() };
    });
    assert(s3.ok === false, "03: powering the core is REJECTED while the shroud blocks it");
    assert(surf(s3.state, "power-core") === null, "03: core still hidden");
    assert(s3.state.paintComplete === false, "03: console still locked");
    log("03 core-locked:", `paint(power-core)->${s3.ok}`);
    await shot("core-locked");

    // -- 04 wrong color on the shroud --------------------------------------
    const s4 = await page.evaluate(() => {
      const g = window.game;
      g.selectColor("conductive");
      const ok = g.paint("coolant-shroud");
      return { ok, state: g.getState() };
    });
    assert(s4.ok === false, "04: painting the shroud conductive is REJECTED (wrong property)");
    assert(!surf(s4.state, "coolant-shroud").satisfied, "04: shroud still broken");
    log("04 wrong-color:", `paint(shroud, conductive)->${s4.ok}`);
    await shot("wrong-color");

    // -- 05 frost the shroud -> reveal the core ----------------------------
    const s5 = await page.evaluate(() => {
      const g = window.game;
      g.selectColor("cold");
      const ok = g.paint("coolant-shroud");
      return { ok, state: g.step(1 / 60, 2) };
    });
    assert(s5.ok === true, "05: frosting the shroud REPAIRS it");
    assert(surf(s5.state, "coolant-shroud").satisfied === true, "05: shroud satisfied");
    const coreNow = surf(s5.state, "power-core");
    assert(coreNow !== null, "05: the power core is now REVEALED");
    assert(coreNow.required === "conductive" && coreNow.available === true, "05: core is now accessible, needs conductive");
    assert(s5.state.paintComplete === false, "05: console still locked (core not yet powered)");
    log("05 frost-reveal:", `shroud repaired; core revealed needs=${coreNow.required} available=${coreNow.available}`);
    await shot("frost-reveal");

    // -- 06 power the core -------------------------------------------------
    const s6 = await page.evaluate(() => {
      const g = window.game;
      g.selectColor("conductive");
      const ok = g.paint("power-core");
      return { ok, state: g.step(1 / 60, 6) };
    });
    assert(s6.ok === true, "06: powering the revealed core REPAIRS it");
    assert(surf(s6.state, "power-core").satisfied === true, "06: core satisfied");
    assert(s6.state.paintComplete === true, "06: console POWERED (chain complete)");
    log("06 power-core:", `paint(power-core, conductive)->${s6.ok} complete=${s6.state.paintComplete}`);
    await shot("power-core");

    // -- 07 float to the console -> win ------------------------------------
    const s7 = await page.evaluate((goal) => {
      const g = window.game;
      let st = g.getState();
      for (let i = 0; i < 1200 && !st.goalReached; i++) {
        g.moveTo(goal);
        st = g.step(1 / 60, 1);
      }
      return g.step(1 / 60, 12);
    }, GOAL);
    goalReached = s7.goalReached === true;
    assert(goalReached, "07: goalReached === true (console latched)");
    const bannerVisible = await page.locator("#hud .win-banner").isVisible().catch(() => false);
    assert(bannerVisible, "07: HUD win banner visible");
    log("07 win:", `goalReached=${s7.goalReached} banner=${bannerVisible} pos=${fmtVec(s7.playerPos)}`);
    await shot("win");

    // -- 08 determinism replay ---------------------------------------------
    const rep = await page.evaluate((goal) => {
      const g = window.game;
      const runOnce = () => {
        g.loadScenario("crosswire");
        g.selectColor("cold");
        g.paint("coolant-shroud");
        g.selectColor("conductive");
        g.paint("power-core");
        let st = g.getState();
        for (let i = 0; i < 1200 && !st.goalReached; i++) {
          g.moveTo(goal);
          st = g.step(1 / 60, 1);
        }
        st = g.step(1 / 60, 12);
        return {
          shroud: !!(st.paintSurfaces.find((s) => s.id === "coolant-shroud") || {}).satisfied,
          core: !!(st.paintSurfaces.find((s) => s.id === "power-core") || {}).satisfied,
          complete: st.paintComplete,
          goal: st.goalReached,
          pos: st.playerPos,
        };
      };
      const a = runOnce();
      const b = runOnce();
      return { a, b };
    }, GOAL);
    assert(rep.a.goal === true && rep.b.goal === true, "08: both replays win");
    assert(rep.a.core === rep.b.core && rep.a.shroud === rep.b.shroud, "08: surface states reproduce");
    const dPos = Math.hypot(rep.a.pos[0] - rep.b.pos[0], rep.a.pos[1] - rep.b.pos[1], rep.a.pos[2] - rep.b.pos[2]);
    assert(dPos <= 0.01, `08: final position reproduces (d=${dPos.toFixed(5)})`);
    log("08 replay:", `a.goal=${rep.a.goal} b.goal=${rep.b.goal} posDelta=${dPos.toFixed(5)}`);
    await shot("replay");

    if (consoleErrors.length) {
      log(`WARNING: ${consoleErrors.length} console error(s):`);
      for (const e of consoleErrors) log("  console:", e);
    } else {
      log("no console/page errors observed");
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (!goalReached) {
    throw new Error("crosswire playthrough did not power the console (goalReached !== true)");
  }

  const webm = readdirSync(videoDir).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error(`no .webm recorded in ${videoDir}`);
  const webmPath = path.join(videoDir, webm);
  log(`recorded video: ${webmPath} (${humanSize(statSync(webmPath).size)})`);

  const mp4Path = path.join(outDir, "demo.mp4");
  const gifPath = path.join(outDir, "demo.gif");
  const rawDur = await ffprobeDuration(webmPath);
  const factor = rawDur && rawDur > TARGET_MAX_SECONDS ? rawDur / TARGET_MAX_SECONDS : 1;
  const setpts = `setpts=PTS/${factor.toFixed(4)}`;
  log(`video: raw=${rawDur ? rawDur.toFixed(2) : "?"}s -> ${rawDur ? (rawDur / factor).toFixed(2) : "?"}s (x${factor.toFixed(2)})`);

  await ffmpeg([
    "-y", "-i", webmPath,
    "-vf", `${setpts},fps=15,scale=1280:-2:flags=lanczos`,
    "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4Path,
  ]);
  log(`wrote ${mp4Path} (${humanSize(statSync(mp4Path).size)})`);

  await ffmpeg([
    "-y", "-i", webmPath,
    "-vf", `${setpts},fps=12,scale=720:-2:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`,
    gifPath,
  ]);
  log(`wrote ${gifPath} (${humanSize(statSync(gifPath).size)})`);

  log("CROSSWIRE PLAYTHROUGH OK — chain solved, console powered, artifacts written.");
}

main().catch((err) => {
  console.error("[capture-crosswire] FAILED:", err && err.message ? err.message : err);
  process.exit(1);
});
