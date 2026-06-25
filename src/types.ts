// src/types.ts  (OWNED BY Scaffold/Integration step)
// Pure, dependency-free, serializable shared types. No Babylon imports so the
// automation boundary stays JSON-friendly for Playwright page.evaluate().

/** Plain serializable 3-tuple: world space, +Y up, meters. */
export type Vec3 = [number, number, number];

export type HandholdId = string;

export type CameraMode = "demo" | "fp";

/** A frozen handhold tube created from a drawn stroke. */
export interface HandholdState {
  id: HandholdId;
  /** Centerline control points in world space, in draw order. */
  points: Vec3[];
  /** Tube radius in meters. */
  radius: number;
}

/** Full snapshot of game state exposed to automation + HUD. */
export interface GameState {
  ready: boolean;
  playerPos: Vec3;
  velocity: Vec3;
  /** True while the player is attached to a handhold. */
  grabbing: boolean;
  grabbedHandholdId: HandholdId | null;
  /** Normalized [0..1] arc position along the grabbed handhold, else null. */
  grabT: number | null;
  handholds: HandholdState[];
  goalReached: boolean;
  cameraMode: CameraMode;
  /** Seconds of simulated time since the last reset(). */
  elapsed: number;
  // ---- magnetic boots (additive; default values reported while floating) ----
  /** True while the player is planted/walking on a surface. */
  booted: boolean;
  /** Logical "up" == current surface inward normal; [0,1,0] when floating. */
  surfaceNormal: Vec3;
  /** Rendered/smoothed camera up (tweened across transitions); [0,1,0] when floating. */
  up: Vec3;
  /** Unit tangent facing (booted) or forward heading (floating). */
  facing: Vec3;
}

/** Tunable simulation constants shared across player + drawing + world. */
export interface SimConfig {
  /** Fixed simulation timestep (s). Sim is integrated only in this quantum. */
  fixedDt: number;
  /** Fractional velocity retained per second (zero-g drag), e.g. 0.5 => half-life ~1s. */
  linearDamping: number;
  /** Clamp on free-float speed (m/s). */
  maxSpeed: number;
  /** Player collision ellipsoid half-extents (m). */
  playerEllipsoid: Vec3;
  /** Default frozen-tube radius (m). */
  handholdRadius: number;
  /** Max centerline distance (m) at which grab() will attach. */
  grabReach: number;
  /** Default pull speed along a handhold (m/s). */
  pullSpeed: number;
  /** Distance (m) from goal center that triggers the win state. */
  goalRadius: number;
  /** Deterministic player spawn pose. */
  spawn: Vec3;
  // ---- magnetic boots tuning (additive) ----
  /** Tangential walk speed (m/s). */
  walkSpeed: number;
  /** Player-center offset along the surface normal when planted (m). */
  standHeight: number;
  /** Yaw rate for walkTo / key turn (rad/s). */
  turnRate: number;
  /** Max |pitch| (rad) for the camera tilt while booted. */
  pitchClamp: number;
  /** Fixed steps over which to slerp the up reorientation on a transition. */
  surfaceTweenSteps: number;
  /** Max plane distance (m) at which setBoots(true) will plant. */
  reEngageDistance: number;
  /** Default push-off impulse (m/s) when detaching from a surface. */
  pushOffSpeed: number;
}

/** Canonical default tuning for slice 1. Scaffold may freeze and pass this in. */
export const DEFAULT_CONFIG: SimConfig = {
  fixedDt: 1 / 60,
  linearDamping: 0.5,
  maxSpeed: 4,
  playerEllipsoid: [0.4, 0.4, 0.4],
  handholdRadius: 0.12,
  grabReach: 1.0,
  pullSpeed: 2.5,
  goalRadius: 1.0,
  spawn: [0, 1, -8],
  walkSpeed: 3.0,
  standHeight: 1.0, // keeps spawn [0,1,-8] reading as "on the floor"
  turnRate: 2.5,
  pitchClamp: 1.483, // ~85°
  surfaceTweenSteps: 18, // ~0.3 s at 1/60
  reEngageDistance: 1.5,
  pushOffSpeed: 3.0,
};
