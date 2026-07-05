// src/gameApi.ts  (OWNED BY Scaffold/Integration step — public automation contract)
// The deterministic surface mounted at window.game. Every method drives the
// simulation directly; NO synthetic pointer/mouse events are ever required.
import type {
  Vec3,
  HandholdId,
  CameraMode,
  GameState,
  PaintProperty,
} from "./types";

export interface GameApi {
  /** Resolves once engine + scene exist and the first frame has rendered. */
  readonly ready: Promise<void>;
  /** Synchronous readiness check (false until `ready` resolves). */
  isReady(): boolean;

  /**
   * Restore the slice to its deterministic initial state: player at spawn with
   * zero velocity, all handholds removed, goal not reached, elapsed = 0,
   * camera mode unchanged.
   */
  reset(): void;

  /** Add an instantaneous velocity delta (m/s) to the free-floating player. No-op while grabbing. */
  applyImpulse(v: Vec3): void;

  /**
   * Freeze a stroke (>= 2 world-space points) into a collidable handhold tube.
   * Returns the new handhold id. Deterministic given identical input points.
   */
  drawStroke(points: Vec3[]): HandholdId;

  /** Attach to the nearest handhold within grabReach. Returns the grabbed id, or null if none in range. */
  grab(): HandholdId | null;

  /** Detach from the current handhold (no-op if not grabbing). */
  release(): void;

  /**
   * While grabbing, slide along the handhold centerline at `speed` m/s for the
   * current step (sign selects direction: + toward end, - toward start).
   * No-op if not grabbing. Pair with step() for deterministic traversal.
   */
  pullAlong(speed: number): void;

  /** Kinematically nudge the free-floating player toward a world point (demo/test convenience). No-op while grabbing. */
  moveTo(target: Vec3): void;

  /** Immutable snapshot of current state (safe to structuredClone across the Playwright boundary). */
  getState(): GameState;

  /** Switch camera framing. 'demo' frames the whole room+action for video; 'fp' is first-person. */
  setCameraMode(mode: CameraMode): void;

  /**
   * Advance the simulation by `dtSeconds` per step for `steps` iterations
   * (default 1), independent of requestAnimationFrame/wall-clock. This is the
   * key to reproducible headless playthroughs. Returns the resulting state.
   */
  step(dtSeconds: number, steps?: number): GameState;

  // ---- magnetic boots (additive; existing methods unchanged) ----

  /** Plant on the nearest surface (on) or detach into free-float (off). */
  setBoots(on: boolean): void;

  /**
   * Set persistent walk intent in [-1,1]; consumed each step() while booted.
   * walk(0,0) stops. No-op while floating. + forward, + strafe right.
   */
  walk(forward: number, strafe: number): void;

  /** Best-effort auto-walk toward a world point along surfaces (booted only). */
  walkTo(target: Vec3): void;

  /** Yaw by `dYaw` radians about the surface normal (booted only). */
  turn(dYaw: number): void;

  /** Absolute facing: yaw about normal, optional clamped pitch (radians; booted only). */
  setFacing(yaw: number, pitch?: number): void;

  /** Detach + impulse `speed` (m/s) along the current surface normal (jump off). */
  pushOff(speed: number): void;

  // ---- property painting (additive; existing methods unchanged) ----

  /**
   * Load a puzzle scenario. "frostgap" arms the paint targets and gates the
   * console on repairing them; "none" clears them (the empty legacy room). Resets
   * target state. Setup-only (like reset), so determinism is preserved.
   */
  loadScenario(name: "none" | "frostgap"): void;

  /** Choose the brush palette color subsequent paint() calls apply. */
  selectColor(color: PaintProperty): void;

  /**
   * Paint the broken surface `id` with the currently-selected color. Returns true
   * iff it repaired the surface (the color matched its required property).
   * Deterministic: no pointer input, no time/RNG reads.
   */
  paint(id: string): boolean;
}

declare global {
  interface Window {
    game: GameApi;
  }
}

export {};
