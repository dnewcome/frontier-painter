// src/player/controller.ts
// The custom kinematic zero-g integrator helper used by the Player. Pure of
// gameplay rules: velocity damping, maxSpeed clamp, and collision-aware
// displacement via mesh.moveWithCollisions. NO gravity, NO physics engine.
//
// Two integrators live here:
//  - integrate(): the EXISTING free-float path (moveWithCollisions), unchanged.
//  - walkStep():  the magnetic-boots path. Applies a tangential walk in the
//    current surface frame then re-plants (analytic box unfold). It sets
//    mesh.position DIRECTLY (kinematic) and never calls moveWithCollisions, so
//    collider resolution order can't introduce nondeterminism — the analytic
//    unfold keeps the player inside the box.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Vec3, SimConfig } from "../types";
import { replant, tangentRight, type Surface } from "./surfaceFrame";

/** Current boots plant: surface (logical up = surface.normal) + facing + pitch. */
export interface PlantState {
  surface: Surface;
  /** Unit tangent facing. */
  facing: Vec3;
  /** Camera pitch (rad), clamped to +/-pitchClamp. Camera-only; never walks. */
  pitch: number;
}

export interface KinematicController {
  /** Damp + clamp `velocity`, then move `mesh` by v*dt with collisions. */
  integrate(mesh: Mesh, velocity: Vec3, dt: number): void;
  /**
   * Booted: apply tangential walk + re-plant; returns the new plant + the
   * transition reorientation (null if no edge was crossed this step). Sets
   * mesh.position directly (kinematic, no moveWithCollisions).
   */
  walkStep(
    mesh: Mesh,
    plant: PlantState,
    moveF: number,
    moveS: number,
    dt: number,
  ): { plant: PlantState; reorient: Quaternion | null };
}

/**
 * Boots tuning consumed by the controller + player. These fields are additive
 * to SimConfig (see the slice design doc, section 4). Until SimConfig is
 * extended by the integration step they are read defensively with defaults, so
 * this module compiles and runs against the current SimConfig and will pick up
 * the real values once they are present.
 */
export interface BootsConfig {
  walkSpeed: number;
  standHeight: number;
  turnRate: number;
  pitchClamp: number;
  surfaceTweenSteps: number;
  reEngageDistance: number;
  pushOffSpeed: number;
}

export const BOOTS_DEFAULTS: BootsConfig = {
  walkSpeed: 3.0,
  standHeight: 1.0,
  turnRate: 2.5,
  pitchClamp: 1.483,
  surfaceTweenSteps: 18,
  reEngageDistance: 1.5,
  pushOffSpeed: 3.0,
};

export function resolveBoots(config: SimConfig): BootsConfig {
  const c = config as SimConfig & Partial<BootsConfig>;
  return {
    walkSpeed: c.walkSpeed ?? BOOTS_DEFAULTS.walkSpeed,
    standHeight: c.standHeight ?? BOOTS_DEFAULTS.standHeight,
    turnRate: c.turnRate ?? BOOTS_DEFAULTS.turnRate,
    pitchClamp: c.pitchClamp ?? BOOTS_DEFAULTS.pitchClamp,
    surfaceTweenSteps: c.surfaceTweenSteps ?? BOOTS_DEFAULTS.surfaceTweenSteps,
    reEngageDistance: c.reEngageDistance ?? BOOTS_DEFAULTS.reEngageDistance,
    pushOffSpeed: c.pushOffSpeed ?? BOOTS_DEFAULTS.pushOffSpeed,
  };
}

/** Small extra gap (m) beyond the ellipsoid radius kept between a planted rest
 *  pose and any perpendicular wall, so the collision ellipsoid never overlaps a
 *  wall it isn't planted on (see replant's `inset` — fixes corner tunneling). */
export const CLAMP_MARGIN = 0.05;

/** Walkable-rect inset = max ellipsoid half-extent + margin. */
export function resolveInset(config: SimConfig): number {
  const e = config.playerEllipsoid;
  return Math.max(e[0], e[1], e[2]) + CLAMP_MARGIN;
}

class KinematicControllerImpl implements KinematicController {
  private readonly config: SimConfig;
  private readonly boots: BootsConfig;
  private readonly inset: number;
  private readonly scratch = new Vector3();

  constructor(config: SimConfig) {
    this.config = config;
    this.boots = resolveBoots(config);
    this.inset = resolveInset(config);
  }

  integrate(mesh: Mesh, velocity: Vec3, dt: number): void {
    // Zero-g drag: v *= linearDamping^dt (frame-rate independent half-life).
    const decay = Math.pow(this.config.linearDamping, dt);
    velocity[0] *= decay;
    velocity[1] *= decay;
    velocity[2] *= decay;

    // Clamp to maxSpeed.
    const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
    const max = this.config.maxSpeed;
    if (speed > max && speed > 1e-9) {
      const k = max / speed;
      velocity[0] *= k;
      velocity[1] *= k;
      velocity[2] *= k;
    }

    // Apply displacement with wall/tube collisions.
    this.scratch.set(velocity[0] * dt, velocity[1] * dt, velocity[2] * dt);
    mesh.moveWithCollisions(this.scratch);
  }

  walkStep(
    mesh: Mesh,
    plant: PlantState,
    moveF: number,
    moveS: number,
    dt: number,
  ): { plant: PlantState; reorient: Quaternion | null } {
    const surface = plant.surface;
    const n = surface.normal;
    const f = plant.facing;
    // right = normalize(cross(up, forward)); strafe slides along it.
    const r = tangentRight(n, f);
    const step = this.boots.walkSpeed * dt;

    const p = mesh.position;
    // Tangential displacement in the current surface frame.
    const moved: Vec3 = [
      p.x + (f[0] * moveF + r[0] * moveS) * step,
      p.y + (f[1] * moveF + r[1] * moveS) * step,
      p.z + (f[2] * moveF + r[2] * moveS) * step,
    ];

    // Re-pin to standHeight and unfold across any edge crossing(s); the inset
    // keeps the rest pose clear of perpendicular walls (corner tunneling fix).
    const res = replant(moved, surface, f, this.boots.standHeight, this.inset);
    mesh.position.set(res.center[0], res.center[1], res.center[2]);

    return {
      plant: { surface: res.surface, facing: res.facing, pitch: plant.pitch },
      reorient: res.reorient,
    };
  }
}

export function createController(config: SimConfig): KinematicController {
  return new KinematicControllerImpl(config);
}
