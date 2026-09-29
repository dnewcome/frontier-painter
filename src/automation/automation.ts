// src/automation/automation.ts
// Implements GameApi and mounts it on window.game. Orchestrates the other
// modules: wires player.fixedUpdate into the engine, drives reset() across
// world/registry/player, builds GameState snapshots, manages the ready promise
// (resolved after first rendered frame), and routes API calls to the right
// module. step() runs through engine.runFixedSteps for deterministic headless
// playthroughs.
import type { Dressing } from "../dressing/dressing";
import { wallLabelsFor } from "../levels";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import type { GameApi } from "../gameApi";
import type { GameEngine, CameraRig } from "../core/engine";
import type { Player } from "../player/player";
import type { Avatar } from "../player/avatar";
import type { World } from "../world/room";
import type { HandholdRegistry } from "../drawing/drawing";
import type { PaintField, ScenarioName } from "../paint/paintField";
import type { Hud } from "../hud/hud";
import type {
  SimConfig,
  GameState,
  Vec3,
  HandholdId,
  CameraMode,
  PaintProperty,
} from "../types";

export interface AutomationDeps {
  engine: GameEngine;
  camera: CameraRig;
  player: Player;
  world: World;
  registry: HandholdRegistry;
  paintField: PaintField;
  hud: Hud;
  config: SimConfig;
  /** Cosmetic third-person player figure; posed in the per-frame observer. */
  avatar?: Avatar;
  /** Set dressing; its wall stencils are repainted per room. */
  dressing?: Dressing;
}

class AutomationImpl implements GameApi {
  readonly ready: Promise<void>;

  private readonly deps: AutomationDeps;
  private elapsed = 0;
  private _isReady = false;
  private selectedColor: PaintProperty = "cold";
  /** Latched when the player exits through the open door. */
  private cleared = false;

  constructor(deps: AutomationDeps) {
    this.deps = deps;
    const { engine, player, world, camera, hud, paintField } = deps;

    // Wire the player integrator and the goal/elapsed bookkeeping into the
    // engine's fixed-step pump (used by both rAF and runFixedSteps).
    engine.addFixedStepHook({
      onFixedStep: (dt) => player.fixedUpdate(dt),
    });
    engine.addFixedStepHook({
      onFixedStep: (dt) => {
        this.elapsed += dt;
        // The console latches only once the player is in range AND every armed
        // paint target is repaired (paintField.complete() is vacuously true in
        // the empty "none" scenario, so the legacy boots slice is unaffected).
        if (
          !world.goal.reached() &&
          world.goal.isReached(player.getPosition()) &&
          paintField.complete()
        ) {
          world.goal.setReached(true);
        }
        // Room clear (every broken surface repaired) -> the exit door opens;
        // moving into the doorway once it's mostly open leaves the room
        // (main.ts then loads the next one). The empty legacy room has no
        // surfaces, so there the console latch opens it instead.
        const clear =
          paintField.scenario() === "none" ? world.goal.reached() : paintField.complete();
        if (clear && !world.door.isOpen()) world.door.setOpen(true);
        world.door.fixedUpdate(dt);
        if (!this.cleared && world.door.progress() > 0.6 && world.door.inDoorway(player.getPosition())) {
          this.cleared = true;
        }
      },
    });

    // Per-rendered-frame: track camera to player and refresh HUD. The third
    // arg (camera up) is the player's smoothed surface up — [0,1,0] while
    // floating — so the fp camera re-rights on walls/ceiling without gimbal pop.
    engine.scene.onBeforeRenderObservable.add(() => {
      const pos = player.getPosition();
      const fwd = player.getForward();
      const up = player.getUp();
      camera.update(pos, fwd, up);
      // Pose the cosmetic avatar from the SAME deterministic player basis the
      // camera uses; hidden in fp so it never fills the cockpit.
      deps.avatar?.update(pos, fwd, up, player.isBooted(), camera.getMode());
      hud.update(this.getState());
    });

    // ready resolves only after the GPU pipeline is live: scene ready AND the
    // first render-loop tick has produced a frame.
    this.ready = engine.scene.whenReadyAsync().then(
      () =>
        new Promise<void>((resolve) => {
          engine.scene.onAfterRenderObservable.addOnce(() => {
            this._isReady = true;
            resolve();
          });
        }),
    );
  }

  isReady(): boolean {
    return this._isReady;
  }

  reset(): void {
    this.deps.registry.clear();
    this.deps.world.reset();
    // paintField AFTER registry.clear() so any rail handhold it registered is
    // gone before it re-arms its targets to the broken state.
    this.deps.paintField.reset();
    this.selectedColor = "cold";
    this.cleared = false;
    this.deps.player.reset();
    this.elapsed = 0;
    this.deps.hud.update(this.getState());
  }

  applyImpulse(v: Vec3): void {
    this.deps.player.applyImpulse(v);
  }

  drawStroke(points: Vec3[]): HandholdId {
    return this.deps.registry.freeze(points, this.deps.config.handholdRadius);
  }

  grab(): HandholdId | null {
    return this.deps.player.grab();
  }

  release(): void {
    this.deps.player.release();
  }

  pullAlong(speed: number): void {
    this.deps.player.pullAlong(speed, this.deps.config.fixedDt);
  }

  moveTo(target: Vec3): void {
    this.deps.player.moveTo(target);
  }

  setCameraMode(mode: CameraMode): void {
    this.deps.camera.setMode(mode);
  }

  // ---- magnetic boots: forward 1:1 to the player controller ----

  setBoots(on: boolean): void {
    this.deps.player.setBooted(on);
  }

  walk(forward: number, strafe: number): void {
    this.deps.player.walkInput(forward, strafe);
  }

  walkTo(target: Vec3): void {
    this.deps.player.walkTo(target);
  }

  turn(dYaw: number): void {
    this.deps.player.turn(dYaw);
  }

  setFacing(yaw: number, pitch?: number): void {
    this.deps.player.setFacing(yaw, pitch);
  }

  pushOff(speed: number): void {
    this.deps.player.pushOff(speed);
  }

  hop(speed?: number): void {
    this.deps.player.hop(speed);
  }

  // ---- property painting ----

  loadScenario(name: ScenarioName): void {
    this.deps.paintField.setScenario(name);
    this.deps.dressing?.setLabels(wallLabelsFor(name));
    // In puzzle rooms the lit exit door is the objective; the green goal orb
    // would sit in the doorway competing with it. Keep it in the empty room.
    this.deps.world.goal.setVisible(name === "none");
    // Full reset so the player is at spawn and the registry/world are clean for
    // the freshly-armed scenario.
    this.reset();
  }

  selectColor(color: PaintProperty): void {
    this.selectedColor = color;
    this.deps.hud.update(this.getState());
  }

  paint(id: string): boolean {
    const ok = this.deps.paintField.paint(id, this.selectedColor);
    this.deps.hud.update(this.getState());
    return ok;
  }

  projectToScreen(p: Vec3): [number, number] | null {
    const scene = this.deps.engine.scene;
    const cam = scene.activeCamera;
    if (!cam) return null;
    const eng = scene.getEngine();
    const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
    const out = Vector3.Project(
      new Vector3(p[0], p[1], p[2]),
      Matrix.IdentityReadOnly,
      scene.getTransformMatrix(),
      vp,
    );
    if (!(out.z >= 0 && out.z <= 1)) return null; // behind camera / clipped
    // Render pixels -> CSS pixels (hardware scaling), offset by the canvas rect.
    const s = eng.getHardwareScalingLevel();
    const rect = eng.getRenderingCanvasClientRect();
    const left = rect ? rect.left : 0;
    const top = rect ? rect.top : 0;
    return [left + out.x * s, top + out.y * s];
  }

  step(dtSeconds: number, steps = 1): GameState {
    this.deps.engine.runFixedSteps(dtSeconds, steps);
    this.deps.hud.update(this.getState());
    return this.getState();
  }

  getState(): GameState {
    const { player, world, registry, camera } = this.deps;
    return {
      ready: this._isReady,
      playerPos: player.getPosition(),
      velocity: player.getVelocity(),
      grabbing: player.isGrabbing(),
      grabbedHandholdId: player.getGrabbedId(),
      grabT: player.getGrabT(),
      handholds: registry.list(),
      goalReached: world.goal.reached(),
      cameraMode: camera.getMode(),
      elapsed: this.elapsed,
      booted: player.isBooted(),
      airborne: player.isAirborne(),
      surfaceNormal: player.getSurfaceNormal(),
      up: player.getUp(),
      facing: player.getFacing(),
      selectedColor: this.selectedColor,
      paintSurfaces: this.deps.paintField.states(),
      paintComplete: this.deps.paintField.complete(),
      scenario: this.deps.paintField.scenario(),
      doorOpen: world.door.isOpen(),
      doorProgress: world.door.progress(),
      exitAnchor: world.door.anchor,
      roomCleared: this.cleared,
    };
  }
}

/**
 * Builds the GameApi, mounts it at window.game, and resolves `ready` after the
 * first frame. main.ts calls this last, once all deps are constructed.
 */
export function createAutomation(deps: AutomationDeps): GameApi {
  const api = new AutomationImpl(deps);
  window.game = api;
  return api;
}
