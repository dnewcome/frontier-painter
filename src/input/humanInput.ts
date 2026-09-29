// src/input/humanInput.ts
// Wires real human controls for headed play WITHOUT touching the deterministic
// fixed-step contract that automation relies on. Returns a HumanControls handle
// so the on-screen touch UI (touchInput.ts) drives the SAME look / move / boots /
// paint logic as the keyboard + mouse:
//   - FLOATING (boots off):
//       WASD / stick = camera-relative thrust, E/Q = up/down.
//       While GRABBING a handhold: forward/back = pull hand-over-hand along it.
//       G or Space / action button = grab / release the nearest handhold.
//   - BOOTED (boots on, magnetic walk):
//       WASD / stick = tangential walk intent. Space / action = push off.
//   - Mouse move or right-thumb drag = look (mouse/finger up -> look up).
//   - B: boots · R: reset · 1/2/3: brush property · (C: camera, P: next room
//     only with ?debug=1) ·
//     F: paint at the crosshair (desktop) / tap a surface (touch).
//   - Left-drag (desktop, floating, pointer released): legacy free-hand draw.
//
// Determinism: this module reads live DOM input, but it ONLY perturbs the sim
// through per-fixed-step intent (applyImpulse / walkInput / pullAlong) and
// one-shot verbs (pushOff / setBooted / setFacing / grab). The canonical
// test/video path drives window.game.step() and never dispatches DOM input, so
// with no keys held and the stick centered this hook is a no-op there.
import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import type { Player } from "../player/player";
import type { Drawing } from "../drawing/drawing";
import type { PaintField } from "../paint/paintField";
import type { CameraRig } from "../core/camera";
import type { GameEngine } from "../core/engine";
import { PAINT_PALETTE, type CameraMode, type PaintProperty, type SimConfig } from "../types";
import { isDebug, isTouchDevice } from "./device";

export interface HumanInputDeps {
  scene: Scene;
  engine: GameEngine;
  player: Player;
  drawing: Drawing;
  paintField: PaintField;
  camera: CameraRig;
  config: SimConfig;
  reset: () => void;
  /** Select the brush color (routes through automation so the HUD stays synced). */
  selectColor: (color: PaintProperty) => void;
  /** Paint the broken surface `id` with the selected color; true iff repaired. */
  paint: (id: string) => boolean;
  /** Load the next playable paint scenario. */
  cycleScenario: () => void;
  /** PAINT pressed with a surface in range: open the trace gesture for it. */
  requestPaint: (id: string) => void;
}

/** What happened when a traced paint stroke was applied to a surface. */
export type PaintOutcome = "repaired" | "wrong" | "locked";

/** How close (m) you must be to a broken surface for PAINT to appear. */
export const PAINT_RANGE = 3.5;

/** Shared control surface driven by keyboard/mouse AND the touch UI. */
export interface HumanControls {
  /** Look delta in radians: yaw to the RIGHT and pitch UP (positive = up). */
  lookRadians(yawRight: number, pitchUp: number): void;
  /** Analog move intent from a virtual stick, each axis in [-1, 1]:
   *  x = strafe right, y = forward. (0,0) releases it. */
  setStick(x: number, y: number): void;
  toggleBoots(): void;
  /** Context action: a broken surface in range -> PAINT (opens the trace);
   *  else booted -> jump; floating -> grab / release. */
  action(): void;
  toggleCamera(): void;
  /** The broken, paintable surface within PAINT_RANGE (nearest), or null. */
  paintTarget(): string | null;
  /** Apply the selected property to surface `id` (after a completed trace). */
  paintSurface(id: string): PaintOutcome;
  isBooted(): boolean;
  isGrabbing(): boolean;
}

/** Thrust acceleration (m/s^2) at full input while floating. Gentle, RCS-style:
 *  you mostly drift; input just nudges relative to the view. */
const THRUST_ACCEL = 7;
/** Mouse-look sensitivity (rad per pixel of pointer movement). */
const LOOK_SENS = 0.0025;

function clamp1(v: number): number {
  return v > 1 ? 1 : v < -1 ? -1 : v;
}

export function createHumanInput(deps: HumanInputDeps): HumanControls {
  const { scene, engine, player, drawing, paintField, camera, config, reset } =
    deps;
  const touch = isTouchDevice();
  const pressed = new Set<string>();

  // Analog stick intent (touch). Combined with keyboard axes each fixed step.
  let stickX = 0;
  let stickY = 0;

  // Reusable scratch so the per-step hook allocates nothing.
  const dir = new Vector3();
  const tmp = new Vector3();

  // Only emit a single walkInput(0,0) on release, so an idle hook never clobbers
  // the deterministic automation path's window.game.walk() intent.
  let wasWalking = false;

  const canvas = scene.getEngine().getRenderingCanvas();
  // iOS Safari has NO Pointer Lock API: calling requestPointerLock there throws.
  const canLock =
    !touch && !!canvas && typeof canvas.requestPointerLock === "function";
  const isLocked = (): boolean =>
    !!canvas && document.pointerLockElement === canvas;
  const exitLock = (): void => {
    if (isLocked()) document.exitPointerLock?.();
  };

  // Desktop first-person captures the pointer (floating OR booted) so the cursor
  // can't leave the window. Touch devices never lock.
  const lookActive = (): boolean => canLock && camera.getMode() === "fp";

  const syncDrawing = (): void => {
    // Legacy free-hand draw: desktop only, floating in fp, pointer NOT captured.
    // Never on touch (every finger would start a stroke).
    drawing.setInputEnabled(
      !touch && camera.getMode() === "fp" && !player.isBooted() && !isLocked(),
    );
  };

  // ---- desktop affordances: capture hint + crosshair (hidden on touch) ------
  const hint = document.createElement("div");
  hint.textContent = "🖱  Click the view to capture the mouse  ·  Esc to release";
  hint.style.cssText =
    "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);" +
    "padding:6px 12px;background:rgba(0,0,0,0.6);color:#cfe8ff;" +
    "font:13px system-ui,sans-serif;border-radius:6px;pointer-events:none;" +
    "z-index:20;display:none";
  document.body.appendChild(hint);

  // Aiming crosshair (screen center) — where F paints on desktop.
  const crosshair = document.createElement("div");
  crosshair.style.cssText =
    "position:fixed;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;" +
    "border-radius:50%;background:rgba(207,232,255,0.9);" +
    "box-shadow:0 0 0 1px rgba(0,0,0,0.55);pointer-events:none;z-index:20;display:none";
  document.body.appendChild(crosshair);

  const updateHint = (): void => {
    hint.style.display = lookActive() && !isLocked() ? "block" : "none";
    crosshair.style.display = !touch && camera.getMode() === "fp" ? "block" : "none";
  };

  const lockPointer = (): void => {
    if (!lookActive() || isLocked() || !canvas) return;
    // Returns a Promise in modern browsers that can reject (e.g. the cooldown
    // right after Esc); swallow it — capture is best-effort.
    const req = canvas.requestPointerLock() as unknown;
    if (req && typeof (req as Promise<void>).catch === "function") {
      (req as Promise<void>).catch(() => {});
    }
  };

  const setCamera = (mode: CameraMode): void => {
    if (camera.getMode() === mode) return;
    camera.setMode(mode);
    syncDrawing();
    if (mode === "fp") lockPointer();
    else exitLock();
    updateHint();
  };

  const toggleCamera = (): void => {
    setCamera(camera.getMode() === "demo" ? "fp" : "demo");
  };

  const toggleGrab = (): void => {
    if (player.isGrabbing()) player.release();
    else player.grab();
  };

  // Re-aim the (now floating) view at a captured look direction, so leaving the
  // surface keeps what you were looking at instead of snapping to the launch
  // velocity (thrust is view-relative, so a stable view matters).
  const keepViewFloating = (f: [number, number, number]): void => {
    player.setFacing(Math.atan2(f[0], f[2]), Math.asin(Math.max(-1, Math.min(1, f[1]))));
  };

  const toggleBoots = (): void => {
    if (!player.isBooted()) {
      player.setBooted(true);
      setCamera("fp");
      lockPointer();
    } else {
      const f = player.getForward(); // the booted view, before detaching
      player.setBooted(false);
      keepViewFloating(f);
    }
    syncDrawing();
    updateHint();
  };

  // Nearest broken surface you can paint right now (available = not blocked
  // by an unrepaired prerequisite), measured to its bounding box.
  const paintTarget = (): string | null => {
    const open = new Set(
      paintField.states().filter((st) => st.available && !st.satisfied).map((st) => st.id),
    );
    if (open.size === 0 || player.isGrabbing()) return null;
    const p = player.getPosition();
    let best: string | null = null;
    let bestD = PAINT_RANGE;
    for (const m of paintField.pickables()) {
      const id = paintField.idForMesh(m);
      if (!id || !open.has(id)) continue;
      const bb = m.getBoundingInfo().boundingBox;
      const lo = bb.minimumWorld;
      const hi = bb.maximumWorld;
      const dx = Math.max(lo.x - p[0], 0, p[0] - hi.x);
      const dy = Math.max(lo.y - p[1], 0, p[1] - hi.y);
      const dz = Math.max(lo.z - p[2], 0, p[2] - hi.z);
      const d = Math.hypot(dx, dy, dz);
      if (d <= bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  };

  const paintSurface = (id: string): PaintOutcome => {
    const before = paintField.states().find((st) => st.id === id);
    if (deps.paint(id)) return "repaired";
    return before && !before.available ? "locked" : "wrong";
  };

  const action = (): void => {
    const target = paintTarget();
    if (target) {
      exitLock(); // the trace needs the real cursor on desktop
      deps.requestPaint(target);
      return;
    }
    if (player.isBooted()) {
      // Boots-on jump: stay magnetized and fly to the nearest surface (no-op
      // while already in the air). Turn the boots OFF to float free.
      player.hop();
    } else {
      toggleGrab();
    }
  };

  // Mouse-up / finger-up ALWAYS looks up. The two modes use OPPOSITE pitch
  // conventions (booted: +pitch tilts DOWN via rotateAbout(f, cross(n,f));
  // floating: +pitch is forward.y = sin(pitch), i.e. UP), so each branch maps
  // "pitch up" with its own sign.
  // Deltas apply to the player's TRUE current look (getLook), so nothing can go
  // stale when the game turns you (grab, pull, plant, crossing a surface edge).
  const lookRadians = (yawRight: number, pitchUp: number): void => {
    if (camera.getMode() !== "fp") return;
    const clamp = config.pitchClamp;
    const cur = player.getLook();
    const raw = player.isBooted() ? cur.pitch - pitchUp : cur.pitch + pitchUp;
    const pitch = raw > clamp ? clamp : raw < -clamp ? -clamp : raw;
    player.setFacing(cur.yaw + yawRight, pitch);
  };

  const debug = isDebug();
  window.addEventListener("keydown", (e) => {
    if (!e.repeat) {
      switch (e.code) {
        case "KeyB":
          toggleBoots();
          break;
        case "Space":
          action();
          break;
        case "KeyG":
          toggleGrab();
          break;
        case "KeyC": // developer: demo <-> first-person camera
          if (debug) toggleCamera();
          break;
        case "KeyR":
          reset();
          break;
        case "Digit1":
          deps.selectColor(PAINT_PALETTE[0]);
          break;
        case "Digit2":
          deps.selectColor(PAINT_PALETTE[1]);
          break;
        case "Digit3":
          deps.selectColor(PAINT_PALETTE[2]);
          break;
        case "KeyF": {
          const target = paintTarget();
          if (target) {
            exitLock();
            deps.requestPaint(target);
          }
          break;
        }
        case "KeyP": // developer: skip to the next room
          if (debug) deps.cycleScenario();
          break;
      }
    }
    pressed.add(e.code);
  });
  window.addEventListener("keyup", (e) => {
    pressed.delete(e.code);
  });
  // Don't keep "holding" input if focus is lost.
  window.addEventListener("blur", () => {
    pressed.clear();
    stickX = 0;
    stickY = 0;
  });

  // Click the view to (re)capture the mouse (desktop) — e.g. after Esc.
  canvas?.addEventListener("click", () => lockPointer());
  canvas?.addEventListener("pointerdown", () => lockPointer());
  document.addEventListener("pointerlockchange", () => {
    updateHint();
    syncDrawing();
  });

  // Desktop mouse-look via relative movement (works with or without capture).
  // Chromium fires ONE bogus mousemove as pointer-lock engages whose movement is
  // minus the cursor position (e.g. -640,-360 for a click at screen center) —
  // without this guard every click-to-capture snapped the view. Drop the first
  // move on each lock transition, and any single-event spike.
  let lastMoveLocked = false;
  window.addEventListener("mousemove", (e) => {
    if (touch || camera.getMode() !== "fp") return;
    const locked = isLocked();
    const lockEdge = locked !== lastMoveLocked;
    lastMoveLocked = locked;
    if (lockEdge) return;
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    if (dx === 0 && dy === 0) return;
    if (Math.abs(dx) > 300 || Math.abs(dy) > 300) return;
    // Floating + a held button = a free-hand draw stroke, not look.
    if (!player.isBooted() && e.buttons !== 0) return;
    lookRadians(dx * LOOK_SENS, -dy * LOOK_SENS); // mouse up (dy<0) -> look up
  });

  // Movement intent in the fixed-step pump so it integrates in lockstep with the
  // sim. Keyboard axes + the analog stick are summed and clamped.
  engine.addFixedStepHook({
    onFixedStep: (dt: number) => {
      let kf = 0;
      let ks = 0;
      let ku = 0;
      if (pressed.has("KeyW")) kf += 1;
      if (pressed.has("KeyS")) kf -= 1;
      if (pressed.has("KeyD")) ks += 1;
      if (pressed.has("KeyA")) ks -= 1;
      if (pressed.has("KeyE")) ku += 1;
      if (pressed.has("KeyQ")) ku -= 1;
      const fwd = clamp1(kf + stickY);
      const strafe = clamp1(ks + stickX);

      if (player.isBooted()) {
        if (fwd !== 0 || strafe !== 0) {
          player.walkInput(fwd, strafe);
          wasWalking = true;
        } else if (wasWalking) {
          player.walkInput(0, 0);
          wasWalking = false;
        }
        return;
      }

      if (player.isGrabbing()) {
        // Hand-over-hand: forward pulls toward the handhold's far end (grab()
        // faces you down it), back pulls toward its start.
        if (fwd !== 0) player.pullAlong(config.pullSpeed * fwd, dt);
        return;
      }

      if (fwd === 0 && strafe === 0 && ku === 0) return;
      const cam = scene.activeCamera;
      if (!cam) return;

      dir.set(0, 0, 0);
      const camFwd = cam.getDirection(Axis.Z);
      const camRight = cam.getDirection(Axis.X);
      dir.addInPlace(tmp.copyFrom(camFwd).scaleInPlace(fwd));
      dir.addInPlace(tmp.copyFrom(camRight).scaleInPlace(strafe));
      dir.addInPlace(tmp.set(0, ku, 0));

      const len = dir.length();
      if (len < 1e-6) return;
      // Analog: a half-tilted stick gives half thrust; diagonals normalize to 1.
      const mag = Math.min(1, len);
      const k = (THRUST_ACCEL * dt * mag) / len;
      player.applyImpulse([dir.x * k, dir.y * k, dir.z * k]);
    },
  });

  syncDrawing();
  updateHint();

  return {
    lookRadians,
    setStick: (x: number, y: number) => {
      stickX = clamp1(x);
      stickY = clamp1(y);
    },
    toggleBoots,
    action,
    toggleCamera,
    paintTarget,
    paintSurface,
    isBooted: () => player.isBooted(),
    isGrabbing: () => player.isGrabbing(),
  };
}
