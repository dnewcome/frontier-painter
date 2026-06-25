// src/core/engine.ts
// Owns Babylon Engine + Scene lifecycle, the variable rAF render loop, the
// deterministic fixed-step pump, and the headless runFixedSteps used by
// automation.step. Knows nothing about gameplay rules; gameplay registers
// fixed-step hooks.
//
// SLICE 1 SCAFFOLD: real engine/scene so the preview shows a room, plus a
// working fixed-step pump. Gameplay hooks are invoked but no-op until modules
// are implemented.
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Collisions/collisionCoordinator";

// Re-export the camera rig so consumers (automation) can import both the
// engine and camera contracts from "../core/engine".
export type { CameraRig } from "./camera";
export { createCameraRig } from "./camera";

/** A per-fixed-step subscriber (player/world/drawing integration). */
export interface FixedStepHook {
  onFixedStep(dt: number): void;
}

export interface GameEngine {
  readonly engine: Engine;
  readonly scene: Scene;
  /** Begin the rAF render loop; it internally accumulates wall time and pumps
   *  whole fixedDt steps so on-screen play matches automation.step(). */
  start(): void;
  stop(): void;
  /** Run exactly `steps` fixed steps of size `dt` WITHOUT rAF (used by
   *  window.game.step for deterministic headless playthroughs). Renders once at end. */
  runFixedSteps(dt: number, steps: number): void;
  /** Force-render the current scene one frame (used after step for screenshots). */
  renderOnce(): void;
  addFixedStepHook(hook: FixedStepHook): void;
  dispose(): void;
}

class GameEngineImpl implements GameEngine {
  readonly engine: Engine;
  readonly scene: Scene;
  private readonly fixedDt: number;
  private readonly hooks: FixedStepHook[] = [];
  private accumulator = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement, fixedDt: number) {
    this.fixedDt = fixedDt;
    // preserveDrawingBuffer MUST be true so the canvas is screenshot-able.
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    });
    this.engine.setHardwareScalingLevel(1);

    this.scene = new Scene(this.engine);
    // Zero-g: built-in collider must not apply gravity.
    this.scene.gravity = Vector3.Zero();
    this.scene.collisionsEnabled = true;

    window.addEventListener("resize", this.onResize);
  }

  private onResize = (): void => {
    this.engine.resize();
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.accumulator = 0;
    this.engine.runRenderLoop(this.renderTick);
  }

  private renderTick = (): void => {
    // Accumulate wall time and pump whole fixedDt steps so on-screen play
    // matches automation.step(). Sim never reads wall-clock directly.
    const dtMs = this.engine.getDeltaTime();
    this.accumulator += dtMs / 1000;
    // Clamp to avoid spiral-of-death after a long pause.
    if (this.accumulator > 0.25) this.accumulator = 0.25;
    while (this.accumulator >= this.fixedDt) {
      this.pumpOne(this.fixedDt);
      this.accumulator -= this.fixedDt;
    }
    this.scene.render();
  };

  private pumpOne(dt: number): void {
    for (const h of this.hooks) h.onFixedStep(dt);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.engine.stopRenderLoop(this.renderTick);
  }

  runFixedSteps(dt: number, steps: number): void {
    for (let i = 0; i < steps; i++) this.pumpOne(dt);
    this.renderOnce();
  }

  renderOnce(): void {
    this.scene.render();
  }

  addFixedStepHook(hook: FixedStepHook): void {
    this.hooks.push(hook);
  }

  dispose(): void {
    this.stop();
    window.removeEventListener("resize", this.onResize);
    this.scene.dispose();
    this.engine.dispose();
  }
}

/** preserveDrawingBuffer MUST be true so the canvas is screenshot-able. */
export function createGameEngine(
  canvas: HTMLCanvasElement,
  fixedDt: number,
): GameEngine {
  return new GameEngineImpl(canvas, fixedDt);
}
