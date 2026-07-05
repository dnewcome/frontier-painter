// playthrough/capture.mjs
//
// Reusable, re-runnable playthrough/demo harness for Frontier Painter —
// the official MAGNETIC-BOOTS slice demo.
//
// Drives the deterministic automation surface (window.game) end-to-end entirely
// via the API (NO synthetic pointer/keyboard input):
//
//   plant boots on the floor -> walk across the floor -> climb a wall ->
//   cross the ceiling -> (first-person embodied beat) -> push off into zero-g
//   float -> draw a handhold -> grab it -> pull hand-over-hand to the goal -> win
//
// The surface-walking traversal is filmed from the TRACKING 'demo' camera so the
// floor->wall->ceiling path reads clearly, with one FIRST-PERSON beat so the
// embodied, surface-relative camera (up re-rights onto the ceiling) is visible.
//
// A webm of the whole session is recorded and one labeled screenshot is taken
// per beat; afterwards the webm is transcoded into a small demo.gif + demo.mp4
// with ffmpeg. The run EXITS NON-ZERO unless the player actually reaches the
// goal (goalReached === true), so it doubles as an end-to-end smoke test.
//
// Inputs (env):
//   BASE_URL   default http://localhost:4173  (the running `vite preview`)
//   RUN_LABEL  default "latest" (also accepted as argv[2])
//
// Outputs (under <root>/demos/<RUN_LABEL>/):
//   frames/NN-<beat>.png   one screenshot per beat
//   demo.mp4               h264, ~720p, 15fps
//   demo.gif               ~720px wide, 12fps
//
// This file is intended to be run AFTER a server is already listening (the
// run.mjs orchestrator handles build + server lifecycle); it can also be run
// standalone against any already-running preview/dev server.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const BASE_URL = process.env.BASE_URL || "http://localhost:4173";
const RUN_LABEL = process.env.RUN_LABEL || process.argv[2] || "latest";
const VIEWPORT = { width: 1280, height: 720 };

// The bridge stroke drawn mid-air after the boots traversal: from just ahead of
// spawn, bowing slightly upward, to just short of the goal sphere (goal center
// [0,1,8], win radius 1.0m). The small vertical bow proves the centerline math
// handles a real 3D path, and the +Z end sits inside the win radius so a pure
// pull wins. This is the SAME stroke the legacy slice used, so the existing
// draw -> grab -> pull -> goal -> win loop is exercised verbatim.
const STROKE = [
  [0, 1, -6],
  [0, 1.4, 0],
  [0, 1, 7.4],
];
const TUBE_START = [0, 1, -6];
const GOAL = [0, 1, 8];

const outDir = path.join(ROOT, "demos", RUN_LABEL);
const framesDir = path.join(outDir, "frames");
const videoDir = path.join(outDir, "video");

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function log(...args) {
  console.log("[capture]", ...args);
}

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

function approx(a, b, tol) {
  return Math.abs(a - b) <= tol;
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

// Target ceiling for the rendered demo length (seconds). The raw webm runs as
// long as the wall-clock session; we only ever SPEED UP (never slow down) to
// keep the clip short and under budget as the playthrough grows.
const TARGET_MAX_SECONDS = 9;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Fresh output dir for this label so the run is idempotent / re-runnable.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(videoDir, { recursive: true });

  log(`BASE_URL=${BASE_URL}  RUN_LABEL=${RUN_LABEL}`);
  log(`output -> ${outDir}`);

  const browser = await chromium.launch({
    headless: true,
    // Force ANGLE/SwiftShader so headless Chromium reliably creates a WebGL
    // context for Babylon (matches playwright.config.ts).
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

  // Frame/screenshot helpers (closured over `page`).
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
    await settle(2); // ensure a fresh frame is composited before grabbing it
    const name = `${String(frameIndex++).padStart(2, "0")}-${id}.png`;
    await page.screenshot({ path: path.join(framesDir, name) });
    log(`frame ${name}`);
  };

  let goalReached = false;
  let finalState = null;

  try {
    // -- 01 ready ----------------------------------------------------------
    // Load the app and wait for the GPU pipeline to be live (engine + scene up,
    // first frame rendered). Frame the room from the tracking 'demo' camera.
    await page.goto(BASE_URL, { waitUntil: "load" });
    await page.waitForFunction(
      () => !!window.game && window.game.isReady(),
      null,
      { timeout: 30_000 },
    );
    const s1 = await page.evaluate(() => {
      // This is the LOCOMOTION slice: run in the empty room (no paint targets,
      // ungated console). loadScenario("none") also performs a full reset.
      window.game.loadScenario("none");
      window.game.setCameraMode("demo");
      return window.game.getState();
    });
    assert(s1.ready === true, "01: getState().ready === true");
    assert(s1.cameraMode === "demo", "01: cameraMode === 'demo'");
    assert(s1.booted === false, "01: starts floating (booted === false)");
    assert(approx(s1.surfaceNormal[1], 1, 1e-3), "01: surfaceNormal ~ [0,1,0] while floating");
    log("01 ready:", `ready=${s1.ready} camera=${s1.cameraMode} pos=${fmtVec(s1.playerPos)}`);
    await shot("ready");

    // -- 02 plant ----------------------------------------------------------
    // Engage the magnetic boots: the free-floating player is planted on the
    // nearest surface (the floor), up = its inward normal, height snapped to
    // standHeight. surfaceNormal/up both read [0,1,0].
    const m2 = await page.evaluate(() => {
      const g = window.game;
      g.setBoots(true);
      return g.step(1 / 60, 2);
    });
    assert(m2.booted === true, "02: booted === true after setBoots(true)");
    assert(approx(m2.surfaceNormal[1], 1, 1e-3), "02: surfaceNormal ~ [0,1,0]");
    assert(approx(m2.up[1], 1, 1e-3), "02: up ~ [0,1,0]");
    assert(approx(m2.playerPos[1], 1, 0.05), "02: planted at standHeight (y ~ 1)");
    log("02 plant:", `booted=${m2.booted} up=${fmtVec(m2.up)} pos=${fmtVec(m2.playerPos)}`);
    await shot("plant");

    // -- 03 walk floor -----------------------------------------------------
    // Face +X (refTangent(floor) = +X) and walk across the floor. Stop mid-floor
    // at rest for a stable, legible "walking on the floor" frame. Still planted
    // on the floor (surfaceNormal unchanged).
    const m3 = await page.evaluate(() => {
      const g = window.game;
      g.setFacing(0); // yaw 0 on the floor => face +X
      g.walk(1, 0);
      let st = g.getState();
      for (let i = 0; i < 600 && st.playerPos[0] < 4; i++) st = g.step(1 / 60, 1);
      g.walk(0, 0); // stop and settle so the screenshot is stable
      st = g.step(1 / 60, 6);
      return st;
    });
    assert(m3.booted === true, "03: still booted while walking the floor");
    assert(approx(m3.surfaceNormal[1], 1, 1e-3), "03: still on the floor (surfaceNormal ~ [0,1,0])");
    assert(m3.playerPos[0] > 3.5, "03: walked across the floor in +X");
    log("03 walk-floor:", `pos=${fmtVec(m3.playerPos)} facing=${fmtVec(m3.facing)}`);
    await shot("walk-floor");

    // -- 04 climb wall -----------------------------------------------------
    // Keep walking +X off the floor edge: the boots transition onto wallPosX
    // (surfaceNormal flips to [-1,0,0]) and the player climbs UP the wall (y
    // rises). The camera up re-rights toward +Y-on-the-wall over the tween.
    const m4 = await page.evaluate(() => {
      const g = window.game;
      g.walk(1, 0);
      let st = g.getState();
      // First: cross the floor->wall edge (surfaceNormal.x -> -1).
      let onWall = false;
      for (let i = 0; i < 2000 && !onWall; i++) {
        st = g.step(1 / 60, 1);
        if (Math.abs(st.surfaceNormal[0] + 1) < 1e-3) onWall = true;
      }
      // Then: climb partway up the wall so the frame clearly reads "on the wall".
      for (let i = 0; i < 600 && st.playerPos[1] < 3; i++) st = g.step(1 / 60, 1);
      g.walk(0, 0);
      st = g.step(1 / 60, 20); // let the up-reorientation tween settle
      return { onWall, st };
    });
    assert(m4.onWall === true, "04: transitioned onto wallPosX");
    assert(approx(m4.st.surfaceNormal[0], -1, 1e-3), "04: surfaceNormal ~ [-1,0,0]");
    assert(m4.st.playerPos[1] > 2.5, "04: climbed up the wall (y increased)");
    assert(m4.st.up[0] < -0.5, "04: smoothed camera up points along the wall normal");
    log("04 climb-wall:", `up=${fmtVec(m4.st.up)} pos=${fmtVec(m4.st.playerPos)}`);
    await shot("climb-wall");

    // -- 05 ceiling --------------------------------------------------------
    // Continue up the wall and over the top edge onto the ceiling
    // (surfaceNormal flips to [0,-1,0]); walk clear of the wall corner toward
    // mid-ceiling. Proves the full floor->wall->ceiling traversal. up flips to
    // point DOWN (the player is now inverted, hanging from the ceiling).
    const m5 = await page.evaluate(() => {
      const g = window.game;
      g.walk(1, 0);
      let st = g.getState();
      let onCeiling = false;
      for (let i = 0; i < 2000 && !onCeiling; i++) {
        st = g.step(1 / 60, 1);
        if (Math.abs(st.surfaceNormal[1] + 1) < 1e-3) onCeiling = true;
      }
      // Walk clear of the wall corner toward mid-ceiling (also keeps a later
      // pushOff away from the corner where moveWithCollisions could eject).
      for (let i = 0; i < 400 && st.playerPos[0] > 0.5; i++) st = g.step(1 / 60, 1);
      g.walk(0, 0);
      st = g.step(1 / 60, 20);
      return { onCeiling, st };
    });
    assert(m5.onCeiling === true, "05: transitioned onto the ceiling");
    assert(approx(m5.st.surfaceNormal[1], -1, 1e-3), "05: surfaceNormal ~ [0,-1,0]");
    assert(approx(m5.st.playerPos[1], 5, 0.2), "05: on the ceiling (y ~ 6-standHeight)");
    assert(m5.st.up[1] < -0.5, "05: smoothed camera up points down (inverted on ceiling)");
    log("05 ceiling:", `up=${fmtVec(m5.st.up)} pos=${fmtVec(m5.st.playerPos)}`);
    await shot("ceiling");

    // -- 06 first-person ---------------------------------------------------
    // Switch to the FIRST-PERSON camera while planted on the ceiling and take a
    // few walking steps: the embodied, surface-relative view shows the room from
    // an inverted vantage (camera up = [0,-1,0]) — the magnetic-boots feel.
    const m6 = await page.evaluate(() => {
      const g = window.game;
      g.setCameraMode("fp");
      g.walk(1, 0);
      let st = g.getState();
      for (let i = 0; i < 24; i++) st = g.step(1 / 60, 1); // a little forward motion
      g.walk(0, 0);
      st = g.step(1 / 60, 2);
      return st;
    });
    assert(m6.cameraMode === "fp", "06: cameraMode === 'fp'");
    assert(m6.booted === true, "06: still planted on the ceiling in first-person");
    assert(m6.up[1] < -0.5, "06: first-person camera up points down (embodied inversion)");
    log("06 first-person:", `camera=${m6.cameraMode} up=${fmtVec(m6.up)} pos=${fmtVec(m6.playerPos)}`);
    await shot("first-person");

    // -- 07 push off -------------------------------------------------------
    // Back to the tracking demo camera. Push off the ceiling: the boots detach
    // into zero-g free-float and hand the surface normal an impulse, so the
    // player launches DOWN into the room (velocity along the old normal).
    const m7 = await page.evaluate(() => {
      const g = window.game;
      g.setCameraMode("demo");
      g.pushOff(3);
      return g.step(1 / 60, 1);
    });
    assert(m7.booted === false, "07: detached to free-float after pushOff");
    assert(m7.velocity[1] < 0, "07: push-off velocity along the ceiling normal (downward)");
    assert(approx(m7.surfaceNormal[1], 1, 1e-3), "07: floating surfaceNormal resets to [0,1,0]");
    log("07 pushoff:", `booted=${m7.booted} vel=${fmtVec(m7.velocity)} pos=${fmtVec(m7.playerPos)}`);
    await shot("pushoff");

    // -- 08 draw -----------------------------------------------------------
    // Mid-air, draw the bridge stroke: it freezes into one collidable amber
    // handhold tube spanning from near the spawn toward the goal. Zero-g drawing
    // is preserved across the boots additions (handholds count increases).
    const m8 = await page.evaluate((stroke) => {
      const g = window.game;
      const before = g.getState().handholds.length;
      const id = g.drawStroke(stroke);
      const st = g.step(1 / 60, 2);
      return { id, before, after: st.handholds.length, st };
    }, STROKE);
    const handholdId = m8.id;
    assert(typeof handholdId === "string" && handholdId.length > 0, "08: drawStroke returned an id");
    assert(m8.after === m8.before + 1, "08: handholds.length increased by 1");
    assert(m8.st.handholds[0].id === handholdId, "08: handhold registered under its id");
    log("08 draw:", `id=${handholdId} handholds=${m8.after}`);
    await shot("draw");

    // -- 09 approach -------------------------------------------------------
    // Free-float (kinematic zero-g controller: velocity + damping, no gravity)
    // down to the tube start, ending at rest within grab range for a stable
    // frame. Driven inside one evaluate so rAF cannot perturb the approach.
    const m9 = await page.evaluate((start) => {
      const g = window.game;
      let st = g.getState();
      for (let i = 0; i < 800; i++) {
        g.moveTo(start);
        st = g.step(1 / 60, 1);
        const p = st.playerPos;
        const d = Math.hypot(p[0] - start[0], p[1] - start[1], p[2] - start[2]);
        if (d <= 0.85) break;
      }
      // Settle: aim at our own position => velocity zeroed => stable frame.
      g.moveTo(g.getState().playerPos);
      st = g.step(1 / 60, 1);
      return st;
    }, TUBE_START);
    const distToStart = Math.hypot(
      m9.playerPos[0] - TUBE_START[0],
      m9.playerPos[1] - TUBE_START[1],
      m9.playerPos[2] - TUBE_START[2],
    );
    assert(distToStart <= 1.0, `09: within grab range of the tube start (d=${distToStart.toFixed(3)})`);
    log("09 approach:", `pos=${fmtVec(m9.playerPos)} distToStart=${distToStart.toFixed(3)}`);
    await shot("approach");

    // -- 10 grab -----------------------------------------------------------
    // Attach to the nearest handhold in reach (the tube we drew).
    const m10 = await page.evaluate(() => {
      const id = window.game.grab();
      return { id, state: window.game.getState() };
    });
    assert(m10.id === handholdId, `10: grab() latched the handhold (got ${m10.id})`);
    assert(m10.state.grabbing === true, "10: grabbing === true");
    assert(m10.state.grabbedHandholdId === handholdId, "10: grabbedHandholdId === id");
    log("10 grab:", `id=${m10.id} grabT=${(m10.state.grabT ?? 0).toFixed(3)}`);
    await shot("grab");

    // -- 11 pull -> win ----------------------------------------------------
    // Pull hand-over-hand along the tube centerline toward the goal. Chunked so
    // the recorded video shows steady progress; release+drift fallback covers
    // strokes that end just outside the radius. HARD requirement: goalReached.
    let pulled = await page.evaluate(() => window.game.getState());
    for (let chunk = 0; chunk < 120 && !pulled.goalReached; chunk++) {
      pulled = await page.evaluate((goal) => {
        const g = window.game;
        let st = g.getState();
        for (let i = 0; i < 6; i++) {
          if (st.grabbing && (st.grabT ?? 0) >= 0.999) g.release();
          if (st.grabbing) g.pullAlong(2.5);
          else g.moveTo(goal);
          st = g.step(1 / 60, 1);
          if (st.goalReached) break;
        }
        return st;
      }, GOAL);
      await settle(1);
    }
    // Stabilize + prove the win latches across more steps.
    const m11 = await page.evaluate(() => {
      const g = window.game;
      let st = g.getState();
      if (!st.grabbing) {
        g.moveTo(g.getState().playerPos);
        g.step(1 / 60, 1);
      }
      st = g.step(1 / 60, 30);
      return st;
    });
    finalState = m11;
    goalReached = m11.goalReached === true;
    assert(goalReached, "11: goalReached === true (latched)");
    const bannerVisible = await page
      .locator("#hud .win-banner")
      .isVisible()
      .catch(() => false);
    assert(bannerVisible, "11: HUD win banner visible in DOM");
    log("11 pull-win:", `goalReached=${m11.goalReached} pos=${fmtVec(m11.playerPos)} banner=${bannerVisible}`);
    await shot("pull-win");

    // -- 12 replay (determinism) ------------------------------------------
    // Re-run the plant -> floor -> wall -> ceiling traversal TWICE inside one
    // synchronous evaluate (rAF cannot interfere) and confirm the surfaceNormal
    // sequence and final position reproduce exactly. This is the determinism
    // guarantee for the boots locomotion.
    const m12 = await page.evaluate(() => {
      const g = window.game;
      const run = () => {
        g.reset();
        g.setBoots(true);
        g.step(1 / 60, 2);
        g.setFacing(0);
        g.walk(1, 0);
        const seq = [];
        const rec = (n) => {
          const l = seq[seq.length - 1];
          if (
            !l ||
            Math.abs(l[0] - n[0]) > 1e-3 ||
            Math.abs(l[1] - n[1]) > 1e-3 ||
            Math.abs(l[2] - n[2]) > 1e-3
          )
            seq.push([n[0], n[1], n[2]]);
        };
        let st = g.getState();
        rec(st.surfaceNormal);
        let onCeiling = false;
        for (let i = 0; i < 4000 && !onCeiling; i++) {
          st = g.step(1 / 60, 1);
          rec(st.surfaceNormal);
          if (Math.abs(st.surfaceNormal[1] + 1) < 1e-3) onCeiling = true;
        }
        g.walk(0, 0);
        st = g.step(1 / 60, 20);
        return { seq, pos: st.playerPos };
      };
      const a = run();
      const b = run();
      return { a, b };
    });
    assert(
      JSON.stringify(m12.a.seq) === JSON.stringify(m12.b.seq),
      "12: surfaceNormal sequence reproduces",
    );
    const dPos = Math.hypot(
      m12.a.pos[0] - m12.b.pos[0],
      m12.a.pos[1] - m12.b.pos[1],
      m12.a.pos[2] - m12.b.pos[2],
    );
    assert(dPos <= 0.01, `12: final traversal position reproduces (d=${dPos.toFixed(5)})`);
    log(
      "12 replay:",
      `normals=${JSON.stringify(m12.a.seq.map((n) => fmtVec(n)))} posDelta=${dPos.toFixed(5)}`,
    );
    await shot("replay");

    if (consoleErrors.length) {
      log(`WARNING: ${consoleErrors.length} console error(s) observed:`);
      for (const e of consoleErrors) log("  console:", e);
    } else {
      log("no console/page errors observed");
    }
  } finally {
    // ALWAYS close the context to flush the webm to disk.
    await context.close();
    await browser.close();
  }

  if (!goalReached) {
    throw new Error("playthrough did not reach the goal (goalReached !== true)");
  }

  // -- Transcode webm -> demo.gif + demo.mp4 -----------------------------
  const webm = readdirSync(videoDir).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error(`no .webm recorded in ${videoDir}`);
  const webmPath = path.join(videoDir, webm);
  log(`recorded video: ${webmPath} (${humanSize(statSync(webmPath).size)})`);

  const mp4Path = path.join(outDir, "demo.mp4");
  const gifPath = path.join(outDir, "demo.gif");

  // Compute a speed-up factor so the clip lands at/under TARGET_MAX_SECONDS
  // without ever slowing down (factor >= 1). setpts=PTS/factor speeds playback.
  const rawDur = await ffprobeDuration(webmPath);
  const factor =
    rawDur && rawDur > TARGET_MAX_SECONDS ? rawDur / TARGET_MAX_SECONDS : 1;
  const setpts = `setpts=PTS/${factor.toFixed(4)}`;
  log(
    `video: raw=${rawDur ? rawDur.toFixed(2) : "?"}s -> ` +
      `${rawDur ? (rawDur / factor).toFixed(2) : "?"}s (speed x${factor.toFixed(2)})`,
  );

  // mp4: ~720p, 15fps, web-friendly.
  await ffmpeg([
    "-y",
    "-i", webmPath,
    "-vf", `${setpts},fps=15,scale=1280:-2:flags=lanczos`,
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "26",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    mp4Path,
  ]);
  log(`wrote ${mp4Path} (${humanSize(statSync(mp4Path).size)})`);

  // gif: 720px wide, 12fps, palette for decent quality + small size.
  await ffmpeg([
    "-y",
    "-i", webmPath,
    "-vf",
    `${setpts},fps=12,scale=720:-2:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`,
    gifPath,
  ]);
  log(`wrote ${gifPath} (${humanSize(statSync(gifPath).size)})`);

  log("PLAYTHROUGH OK — goal reached, artifacts written.");
}

main().catch((err) => {
  console.error("[capture] FAILED:", err && err.message ? err.message : err);
  process.exit(1);
});
