// src/input/humanInput.ts
// Wires real human controls for headed play WITHOUT touching the deterministic
// fixed-step contract that automation relies on:
//   - FLOATING (boots off):
//       WASD = camera-plane thrust, E/Q = up/down (per-fixed-step impulses).
//       G or Space = toggle grab / release on the nearest handhold.
//   - BOOTED (boots on, magnetic walk):
//       WASD = tangential walk intent (walkInput each fixed step).
//       Mouse move (fp + pointer-lock) = look: yaw + clamped pitch via setFacing.
//       Space = pushOff (jump off the surface). G still toggles grab.
//   - B: toggle magnetic boots; engaging boots also switches to first-person.
//   - C: toggle camera between 'demo' and 'fp'. Live mouse-draw is enabled only
//        in 'fp'.
//   - R: reset the slice.
//   - Left-drag (fp only): draw a handhold stroke (handled by the drawing module).
//
// Determinism: this module reads live DOM input, but it ONLY perturbs the sim
// through per-fixed-step intent (player.applyImpulse / player.walkInput) and
// one-shot verbs (pushOff / setBooted / setFacing). The canonical test/video
// path drives window.game.step() and never dispatches DOM key/pointer events, so
// the simulation there is untouched by this module.
import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import type { Player } from "../player/player";
import type { Drawing } from "../drawing/drawing";
import type { PaintField } from "../paint/paintField";
import type { CameraRig } from "../core/camera";
import type { GameEngine } from "../core/engine";
import { PAINT_PALETTE, type CameraMode, type PaintProperty, type SimConfig } from "../types";

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
}

/** Thrust acceleration (m/s^2) applied while a movement key is held (floating).
 *  Gentle, RCS-style: you mostly drift; WASD just nudges relative to the view. */
const THRUST_ACCEL = 7;
/** Mouse-look sensitivity (rad per pixel of pointer movement) while booted. */
const LOOK_SENS = 0.0025;

export function createHumanInput(deps: HumanInputDeps): void {
  const { scene, engine, player, drawing, paintField, camera, config, reset } =
    deps;
  const pressed = new Set<string>();

  // Paint the broken surface under the cursor with the selected color. The brush
  // ray uses the live pointer position (a visible cursor while floating), so the
  // player aims at a surface and presses F. Deterministic automation never uses
  // this path — the scripted playthrough calls window.game.paint(id) directly.
  const paintUnderCursor = (): void => {
    const pick = scene.pick(
      scene.pointerX,
      scene.pointerY,
      (m) => paintField.idForMesh(m) !== null,
    );
    if (!pick?.hit || !pick.pickedMesh) return;
    // Only paint within reach so you can't repair a surface across the whole ship.
    if (pick.distance > config.paintReach) return;
    const id = paintField.idForMesh(pick.pickedMesh);
    if (id) deps.paint(id);
  };

  // Reusable scratch so the per-step hook allocates nothing.
  const dir = new Vector3();
  const tmp = new Vector3();

  // Booted mouse-look accumulators. setFacing is the single authority for the
  // look orientation while booted (yaw about the surface normal + clamped
  // pitch), so it stays internally consistent with no double-applied yaw. Reset
  // when boots engage; the player module rotates facing across surface
  // transitions independently of these (cosmetic only, headed play).
  let lookYaw = 0;
  let lookPitch = 0;
  // Floating look accumulators (world-frame yaw/pitch). Separate from the booted
  // surface-relative look so the two don't cross-contaminate.
  let floatYaw = 0;
  let floatPitch = 0;
  // Invert vertical mouse-look (mouse up -> look down). Persisted in
  // localStorage; toggle live with the I key. Defaults to inverted.
  let invertY = (localStorage.getItem("fp_invertY") ?? "1") === "1";

  // Tracks whether human keys were driving the walk last step, so we only emit a
  // single walkInput(0,0) on key release. Without this guard the per-step hook
  // would call walkInput(0,0) every idle step and clobber the deterministic
  // automation path's window.game.walk() intent.
  let wasWalking = false;

  // The render canvas: target for pointer-lock (mouse-look) and the surface the
  // user clicks to (re)capture the mouse.
  const canvas = scene.getEngine().getRenderingCanvas();

  // Mouse-look (booted) and mouse-draw (floating) both want the pointer, so we
  // separate them by state to avoid the two fighting:
  //   - BOOTED + fp   -> pointer-lock look; drawing OFF.
  //   - FLOATING + fp -> drawing ON (left-drag); no pointer lock.
  const lookActive = (): boolean =>
    player.isBooted() && camera.getMode() === "fp";

  const syncDrawing = (): void => {
    // Mouse-draw only when FLOATING in first person; off while booted (pointer is
    // captured for look) and off in demo (so it can't fight the orbit camera or
    // leak into the deterministic demo-mode automation path).
    drawing.setInputEnabled(camera.getMode() === "fp" && !player.isBooted());
  };

  // Request pointer-lock so "move mouse to look" works. Must be driven by a user
  // gesture (a click, or the B keydown that engages boots) — browsers reject it
  // otherwise. Only meaningful while booted + first-person.
  // On-screen affordance so capture is discoverable: pointer-lock can only be
  // requested from a user gesture (a click), so we prompt for one while booted.
  const hint = document.createElement("div");
  hint.textContent = "🖱  Click the view to capture the mouse  ·  Esc to release";
  hint.style.cssText =
    "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);" +
    "padding:6px 12px;background:rgba(0,0,0,0.6);color:#cfe8ff;" +
    "font:13px system-ui,sans-serif;border-radius:6px;pointer-events:none;" +
    "z-index:20;display:none";
  document.body.appendChild(hint);

  const updateHint = (): void => {
    hint.style.display =
      lookActive() && document.pointerLockElement !== canvas ? "block" : "none";
  };

  const lockPointer = (): void => {
    if (lookActive() && document.pointerLockElement !== canvas) {
      // Modern browsers return a Promise that can reject (e.g. lock cooldown
      // right after Esc); swallow it so we never throw on a best-effort capture.
      const req = canvas?.requestPointerLock();
      if (req && typeof (req as { catch?: unknown }).catch === "function") {
        (req as Promise<void>).catch(() => {});
      }
    }
  };

  const setCamera = (mode: CameraMode): void => {
    if (camera.getMode() === mode) return;
    camera.setMode(mode);
    syncDrawing();
    if (mode === "fp") lockPointer();
    else if (document.pointerLockElement === canvas) document.exitPointerLock();
    updateHint();
  };

  const toggleCamera = (): void => {
    setCamera(camera.getMode() === "demo" ? "fp" : "demo");
  };

  const toggleGrab = (): void => {
    if (player.isGrabbing()) player.release();
    else player.grab();
  };

  // After a push-off the player is suddenly floating with a new heading; sync the
  // float-look accumulators to it so the next mouse move doesn't snap the view.
  const syncFloatLookFromView = (): void => {
    const f = player.getForward();
    floatYaw = Math.atan2(f[0], f[2]);
    floatPitch = Math.asin(Math.max(-1, Math.min(1, f[1])));
  };

  const toggleBoots = (): void => {
    if (!player.isBooted()) {
      // Plant => first-person, fresh look accumulators, capture the mouse so the
      // user can immediately look around (B keydown is a valid lock gesture).
      player.setBooted(true);
      setCamera("fp");
      lookYaw = 0;
      lookPitch = 0;
      lockPointer();
    } else {
      // Release => float. Carry the current view into the float look so it does
      // not jump, then release the captured cursor (floating uses a free cursor
      // so left-drag can draw).
      const f = player.getForward();
      player.setBooted(false);
      floatYaw = Math.atan2(f[0], f[2]);
      floatPitch = Math.asin(Math.max(-1, Math.min(1, f[1])));
      player.setFacing(floatYaw, floatPitch);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }
    syncDrawing();
    updateHint();
  };

  window.addEventListener("keydown", (e) => {
    // Edge-triggered actions fire once per physical press.
    if (!e.repeat) {
      switch (e.code) {
        case "KeyB":
          toggleBoots();
          break;
        case "Space":
          // Booted: push off the surface (-> floating). Floating: grab toggle.
          if (player.isBooted()) {
            player.pushOff(config.pushOffSpeed);
            // Now floating: carry the launch heading into the float look, release
            // the captured cursor, and re-enable mouse-draw.
            syncFloatLookFromView();
            if (document.pointerLockElement === canvas) document.exitPointerLock();
            syncDrawing();
            updateHint();
          } else {
            toggleGrab();
          }
          break;
        case "KeyG":
          toggleGrab();
          break;
        case "KeyC":
          toggleCamera();
          break;
        case "KeyR":
          reset();
          break;
        case "KeyI":
          invertY = !invertY;
          localStorage.setItem("fp_invertY", invertY ? "1" : "0");
          break;
        // Brush palette: pick the physical property to paint (1 cold, 2
        // conductive, 3 magnetic), then F paints the surface under the cursor.
        case "Digit1":
          deps.selectColor(PAINT_PALETTE[0]);
          break;
        case "Digit2":
          deps.selectColor(PAINT_PALETTE[1]);
          break;
        case "Digit3":
          deps.selectColor(PAINT_PALETTE[2]);
          break;
        case "KeyF":
          paintUnderCursor();
          break;
      }
    }
    pressed.add(e.code);
  });
  window.addEventListener("keyup", (e) => {
    pressed.delete(e.code);
  });
  // Don't keep "holding" thrust/walk if focus is lost.
  window.addEventListener("blur", () => pressed.clear());

  // Click the canvas to (re)capture the mouse for look while booted — e.g. after
  // the user hit Esc to release it. No-op when floating (left-drag draws instead).
  // 'click' is the most reliable pointer-lock gesture; pointerdown covers the
  // press too. Keep the hint synced to the actual lock state.
  canvas?.addEventListener("click", () => lockPointer());
  canvas?.addEventListener("pointerdown", () => lockPointer());
  document.addEventListener("pointerlockchange", updateHint);

  // Mouse-look in first-person, both booted (surface-relative) and floating
  // (world-frame). Uses relative movementX/movementY, which the browser reports
  // whether or not pointer-lock is engaged — so look works even when capture is
  // unavailable (capture only adds endless-spin). Demo orbit camera is excluded.
  window.addEventListener("mousemove", (e) => {
    if (camera.getMode() !== "fp") return;
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    if (dx === 0 && dy === 0) return;
    const pitchSign = invertY ? 1 : -1; // invertY: mouse up -> look down
    const clamp = config.pitchClamp;
    if (player.isBooted()) {
      lookYaw += dx * LOOK_SENS;
      lookPitch += pitchSign * dy * LOOK_SENS;
      if (lookPitch > clamp) lookPitch = clamp;
      else if (lookPitch < -clamp) lookPitch = -clamp;
      player.setFacing(lookYaw, lookPitch);
    } else {
      // Floating: free-move look, but NOT while a mouse button is held — so a
      // left-drag draws a stroke instead of swinging the view.
      if (e.buttons !== 0) return;
      floatYaw += dx * LOOK_SENS;
      floatPitch += pitchSign * dy * LOOK_SENS;
      if (floatPitch > clamp) floatPitch = clamp;
      else if (floatPitch < -clamp) floatPitch = -clamp;
      player.setFacing(floatYaw, floatPitch);
    }
  });

  // Movement intent in the fixed-step pump so it integrates in lockstep with the
  // rest of the sim. Branches on boots: walk intent while planted, free-float
  // thrust otherwise. No-op (for thrust) while grabbing.
  engine.addFixedStepHook({
    onFixedStep: (dt: number) => {
      if (player.isBooted()) {
        // Persistent tangential walk intent from held WASD. Only assert intent
        // while a movement key is down; emit a single walkInput(0,0) on release.
        // When no walk key is held we leave the player's walk intent untouched so
        // the deterministic window.game.walk() automation path is never clobbered.
        const moving =
          pressed.has("KeyW") ||
          pressed.has("KeyS") ||
          pressed.has("KeyD") ||
          pressed.has("KeyA");
        if (moving) {
          let fwd = 0;
          let strafe = 0;
          if (pressed.has("KeyW")) fwd += 1;
          if (pressed.has("KeyS")) fwd -= 1;
          if (pressed.has("KeyD")) strafe += 1;
          if (pressed.has("KeyA")) strafe -= 1;
          player.walkInput(fwd, strafe);
          wasWalking = true;
        } else if (wasWalking) {
          player.walkInput(0, 0);
          wasWalking = false;
        }
        return;
      }

      if (pressed.size === 0 || player.isGrabbing()) return;
      const cam = scene.activeCamera;
      if (!cam) return;

      dir.set(0, 0, 0);
      const fwd = cam.getDirection(Axis.Z);
      const right = cam.getDirection(Axis.X);

      if (pressed.has("KeyW")) dir.addInPlace(fwd);
      if (pressed.has("KeyS")) dir.subtractInPlace(fwd);
      if (pressed.has("KeyD")) dir.addInPlace(right);
      if (pressed.has("KeyA")) dir.subtractInPlace(right);
      if (pressed.has("KeyE")) dir.addInPlace(tmp.set(0, 1, 0));
      if (pressed.has("KeyQ")) dir.addInPlace(tmp.set(0, -1, 0));

      const len = dir.length();
      if (len < 1e-6) return;
      const k = (THRUST_ACCEL * dt) / len;
      player.applyImpulse([dir.x * k, dir.y * k, dir.z * k]);
    },
  });

  // Match the initial camera/boots state (demo => draw off).
  syncDrawing();
  updateHint();
}
