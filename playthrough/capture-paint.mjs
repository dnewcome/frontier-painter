// playthrough/capture-paint.mjs
//
// Re-runnable playthrough/demo harness for the PROPERTY-PAINT slice
// ("The Frost Gap"). Drives the deterministic automation surface (window.game)
// end-to-end via the API only (NO synthetic pointer/keyboard input):
//
//   arm the frostgap scenario -> observe two BROKEN surfaces (a dead access rail
//   and a dead power conduit) -> demonstrate the "right property, right place"
//   rule (painting the rail CONDUCTIVE is rejected) -> paint the rail COLD so it
//   frosts into a grabbable handhold -> grab + pull hand-over-hand across the void
//   to the console (which stays LOCKED) -> paint the conduit CONDUCTIVE to power
//   the console -> the goal latches -> win.
//
// The run EXITS NON-ZERO unless the console actually powers on and the goal
// latches (goalReached === true), so it doubles as an end-to-end smoke test of
// the paint verb, the goal gating, and determinism.
//
// Inputs (env):  BASE_URL (default http://localhost:4173), RUN_LABEL (default
// "frostgap"). Outputs under <root>/demos/<RUN_LABEL>/ (frames + demo.gif/mp4).
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const BASE_URL = process.env.BASE_URL || "http://localhost:4173";
const RUN_LABEL = process.env.RUN_LABEL || process.argv[2] || "frostgap";
const VIEWPORT = { width: 1280, height: 720 };

// The access rail's start (near the spawn) and the console/goal center. The rail
// centerline is defined in src/paint/paintField.ts; its +Z end sits inside the
// goal win-radius so a pure grab->pull reaches the console.
const RAIL_START = [0, 1.2, -6];
const GOAL = [0, 1, 8];

const outDir = path.join(ROOT, "demos", RUN_LABEL);
const framesDir = path.join(outDir, "frames");
const videoDir = path.join(outDir, "video");

function log(...args) {
  console.log("[capture-paint]", ...args);
}
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}
function fmtVec(v) {
  return `[${v.map((n) => n.toFixed(2)).join(", ")}]`;
}
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-2000)}`)),
    );
  });
}
function ffprobeDuration(file) {
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file,
      ],
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

// Helper to pull the state of a named paint surface out of a snapshot.
function surf(state, id) {
  return state.paintSurfaces.find((s) => s.id === id) || null;
}

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
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
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
    // -- 01 arrive: broken room -------------------------------------------
    await page.goto(BASE_URL, { waitUntil: "load" });
    await page.waitForFunction(
      () => !!window.game && window.game.isReady(),
      null,
      { timeout: 30_000 },
    );
    const s1 = await page.evaluate(() => {
      const g = window.game;
      g.loadScenario("frostgap");
      g.setCameraMode("demo");
      return g.getState();
    });
    assert(s1.ready === true, "01: ready");
    assert(s1.paintSurfaces.length === 2, "01: two broken surfaces armed");
    const rail1 = surf(s1, "access-rail");
    const cond1 = surf(s1, "power-conduit");
    assert(rail1 && rail1.required === "cold", "01: access-rail needs cold");
    assert(cond1 && cond1.required === "conductive", "01: power-conduit needs conductive");
    assert(!rail1.satisfied && !cond1.satisfied, "01: both surfaces start BROKEN");
    assert(s1.paintComplete === false, "01: console NOT yet powered");
    assert(s1.handholds.length === 0, "01: no handholds yet");
    log("01 arrive:", `surfaces=${s1.paintSurfaces.map((s) => s.id + ":" + s.required).join(",")} complete=${s1.paintComplete}`);
    await shot("arrive");

    // -- 02 wrong color (the constraint) ----------------------------------
    // Paint the access rail CONDUCTIVE — the wrong property. It is rejected: no
    // repair, no handhold, the surface flares red. This is the "right property,
    // right place" rule made visible.
    const s2 = await page.evaluate(() => {
      const g = window.game;
      g.selectColor("conductive");
      const ok = g.paint("access-rail");
      return { ok, state: g.getState() };
    });
    assert(s2.ok === false, "02: painting the rail conductive is REJECTED");
    assert(!surf(s2.state, "access-rail").satisfied, "02: rail still broken after wrong color");
    assert(s2.state.handholds.length === 0, "02: no handhold from a rejected paint");
    log("02 wrong-color:", `paint(conductive)->${s2.ok} rail.satisfied=${surf(s2.state, "access-rail").satisfied}`);
    await shot("wrong-color");

    // -- 03 paint the rail COLD -------------------------------------------
    // The correct property: the rail frosts and freezes into a grabbable
    // handhold spanning the void (handholds count goes 0 -> 1).
    const s3 = await page.evaluate(() => {
      const g = window.game;
      g.selectColor("cold");
      const ok = g.paint("access-rail");
      return { ok, state: g.step(1 / 60, 2) };
    });
    assert(s3.ok === true, "03: painting the rail cold REPAIRS it");
    assert(surf(s3.state, "access-rail").satisfied === true, "03: access-rail satisfied");
    assert(s3.state.handholds.length === 1, "03: a handhold froze into being");
    assert(s3.state.paintComplete === false, "03: console still locked (conduit dead)");
    const railHandholdId = s3.state.handholds[0].id;
    log("03 frost-rail:", `paint(cold)->${s3.ok} handholds=${s3.state.handholds.length} id=${railHandholdId}`);
    await shot("frost-rail");

    // -- 04 approach the rail ---------------------------------------------
    const s4 = await page.evaluate((start) => {
      const g = window.game;
      let st = g.getState();
      for (let i = 0; i < 800; i++) {
        g.moveTo(start);
        st = g.step(1 / 60, 1);
        const p = st.playerPos;
        const d = Math.hypot(p[0] - start[0], p[1] - start[1], p[2] - start[2]);
        if (d <= 0.85) break;
      }
      g.moveTo(g.getState().playerPos); // settle -> stable frame
      st = g.step(1 / 60, 1);
      return st;
    }, RAIL_START);
    const dStart = Math.hypot(
      s4.playerPos[0] - RAIL_START[0],
      s4.playerPos[1] - RAIL_START[1],
      s4.playerPos[2] - RAIL_START[2],
    );
    assert(dStart <= 1.0, `04: within grab range of the rail (d=${dStart.toFixed(3)})`);
    log("04 approach:", `pos=${fmtVec(s4.playerPos)} dStart=${dStart.toFixed(3)}`);
    await shot("approach");

    // -- 05 grab -----------------------------------------------------------
    const s5 = await page.evaluate(() => {
      const id = window.game.grab();
      return { id, state: window.game.getState() };
    });
    assert(s5.id === railHandholdId, `05: grabbed the frosted rail (got ${s5.id})`);
    assert(s5.state.grabbing === true, "05: grabbing");
    log("05 grab:", `id=${s5.id} grabT=${(s5.state.grabT ?? 0).toFixed(3)}`);
    await shot("grab");

    // -- 06 pull across to the locked console -----------------------------
    // Pull hand-over-hand to the far (+Z) end. The player arrives IN RANGE of the
    // console, but it stays dark: goalReached is false while the conduit is dead.
    let pulled = await page.evaluate(() => window.game.getState());
    for (let chunk = 0; chunk < 120 && (pulled.grabT ?? 0) < 0.999; chunk++) {
      pulled = await page.evaluate(() => {
        const g = window.game;
        let st = g.getState();
        for (let i = 0; i < 6; i++) {
          if (st.grabbing) g.pullAlong(2.5);
          st = g.step(1 / 60, 1);
          if ((st.grabT ?? 0) >= 0.999) break;
        }
        return st;
      });
      await settle(1);
    }
    const dGoal = Math.hypot(
      pulled.playerPos[0] - GOAL[0],
      pulled.playerPos[1] - GOAL[1],
      pulled.playerPos[2] - GOAL[2],
    );
    assert(dGoal <= 1.0, `06: reached the console (d=${dGoal.toFixed(3)})`);
    assert(pulled.goalReached === false, "06: console is LOCKED (conduit still dead)");
    assert(pulled.paintComplete === false, "06: paintComplete still false");
    log("06 at-locked-console:", `pos=${fmtVec(pulled.playerPos)} dGoal=${dGoal.toFixed(3)} goalReached=${pulled.goalReached}`);
    await shot("locked-console");

    // -- 07 power the conduit ---------------------------------------------
    // Paint the conduit CONDUCTIVE: the door powers on (green), every surface is
    // now repaired, and the console latches on the next step.
    const s7 = await page.evaluate(() => {
      const g = window.game;
      g.selectColor("conductive");
      const ok = g.paint("power-conduit");
      const st = g.step(1 / 60, 6);
      return { ok, state: st };
    });
    assert(s7.ok === true, "07: painting the conduit conductive REPAIRS it");
    assert(surf(s7.state, "power-conduit").satisfied === true, "07: conduit satisfied");
    assert(s7.state.paintComplete === true, "07: console POWERED (all surfaces repaired)");
    log("07 power-conduit:", `paint(conductive)->${s7.ok} complete=${s7.state.paintComplete}`);
    await shot("power-conduit");

    // -- 08 win ------------------------------------------------------------
    const s8 = await page.evaluate(() => window.game.step(1 / 60, 20));
    goalReached = s8.goalReached === true;
    assert(goalReached, "08: goalReached === true (console latched)");
    const bannerVisible = await page
      .locator("#hud .win-banner")
      .isVisible()
      .catch(() => false);
    assert(bannerVisible, "08: HUD win banner visible");
    log("08 win:", `goalReached=${s8.goalReached} banner=${bannerVisible}`);
    await shot("win");

    // -- 09 determinism replay --------------------------------------------
    // Run the whole paint->cross->power->win sequence TWICE inside one
    // synchronous evaluate and confirm the surface states + win reproduce.
    const rep = await page.evaluate((args) => {
      const { railStart } = args;
      const g = window.game;
      const runOnce = () => {
        g.loadScenario("frostgap");
        g.selectColor("cold");
        g.paint("access-rail");
        let st = g.getState();
        for (let i = 0; i < 1200; i++) {
          g.moveTo(railStart);
          st = g.step(1 / 60, 1);
          const p = st.playerPos;
          if (Math.hypot(p[0] - railStart[0], p[1] - railStart[1], p[2] - railStart[2]) <= 0.85) break;
        }
        g.grab();
        for (let c = 0; c < 400 && (g.getState().grabT ?? 0) < 0.999; c++) {
          g.pullAlong(2.5);
          g.step(1 / 60, 1);
        }
        g.selectColor("conductive");
        g.paint("power-conduit");
        st = g.step(1 / 60, 20);
        return {
          rail: !!(st.paintSurfaces.find((s) => s.id === "access-rail") || {}).satisfied,
          conduit: !!(st.paintSurfaces.find((s) => s.id === "power-conduit") || {}).satisfied,
          complete: st.paintComplete,
          goal: st.goalReached,
          pos: st.playerPos,
        };
      };
      const a = runOnce();
      const b = runOnce();
      return { a, b };
    }, { railStart: RAIL_START });
    assert(rep.a.goal === true && rep.b.goal === true, "09: both replays win");
    assert(rep.a.rail === rep.b.rail && rep.a.conduit === rep.b.conduit, "09: surface states reproduce");
    assert(rep.a.complete === rep.b.complete, "09: paintComplete reproduces");
    const dPos = Math.hypot(
      rep.a.pos[0] - rep.b.pos[0],
      rep.a.pos[1] - rep.b.pos[1],
      rep.a.pos[2] - rep.b.pos[2],
    );
    assert(dPos <= 0.01, `09: final position reproduces (d=${dPos.toFixed(5)})`);
    log("09 replay:", `a.goal=${rep.a.goal} b.goal=${rep.b.goal} posDelta=${dPos.toFixed(5)}`);
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
    throw new Error("paint playthrough did not power the console (goalReached !== true)");
  }

  // -- Transcode webm -> demo.gif + demo.mp4 -----------------------------
  const webm = readdirSync(videoDir).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error(`no .webm recorded in ${videoDir}`);
  const webmPath = path.join(videoDir, webm);
  log(`recorded video: ${webmPath} (${humanSize(statSync(webmPath).size)})`);

  const mp4Path = path.join(outDir, "demo.mp4");
  const gifPath = path.join(outDir, "demo.gif");

  const rawDur = await ffprobeDuration(webmPath);
  const factor =
    rawDur && rawDur > TARGET_MAX_SECONDS ? rawDur / TARGET_MAX_SECONDS : 1;
  const setpts = `setpts=PTS/${factor.toFixed(4)}`;
  log(`video: raw=${rawDur ? rawDur.toFixed(2) : "?"}s -> ${rawDur ? (rawDur / factor).toFixed(2) : "?"}s (x${factor.toFixed(2)})`);

  await ffmpeg([
    "-y", "-i", webmPath,
    "-vf", `${setpts},fps=15,scale=1280:-2:flags=lanczos`,
    "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    mp4Path,
  ]);
  log(`wrote ${mp4Path} (${humanSize(statSync(mp4Path).size)})`);

  await ffmpeg([
    "-y", "-i", webmPath,
    "-vf",
    `${setpts},fps=12,scale=720:-2:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`,
    gifPath,
  ]);
  log(`wrote ${gifPath} (${humanSize(statSync(gifPath).size)})`);

  log("PAINT PLAYTHROUGH OK — console powered, goal latched, artifacts written.");
}

main().catch((err) => {
  console.error("[capture-paint] FAILED:", err && err.message ? err.message : err);
  process.exit(1);
});
