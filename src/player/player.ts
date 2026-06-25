// src/player/player.ts
// The custom kinematic zero-g controller. Owns the player mesh + ellipsoid and
// fixedUpdate integration. Implements applyImpulse, moveTo, and the
// grab/release/pullAlong loop (analytic, via the handhold registry — NOT
// physics).
//
// MAGNETIC BOOTS: a second locomotion state lives alongside the free-float one.
// When booted the player is planted on one of the 6 interior surfaces (up =
// surface inward normal) and walks the tangent plane, transitioning across 90
// degree edges onto adjacent surfaces. Detaching hands the tangential walk
// velocity back to the free-float integrator so the existing
// draw -> grab -> pull -> goal -> win loop keeps working. All boots state
// advances ONLY inside fixedUpdate(dt) (and intent setters that merely store
// values), so determinism is preserved: no Math.random / Date.now /
// performance.now anywhere here.
import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Vec3, HandholdId, SimConfig } from "../types";
import type { HandholdRegistry } from "../drawing/drawing";
import {
  createController,
  resolveBoots,
  resolveInset,
  type KinematicController,
  type BootsConfig,
  type PlantState,
} from "./controller";
import {
  nearestSurface,
  surfaceById,
  tangentRight,
  rotateAbout,
  projectToTangent,
  refTangent,
  replant,
  type Surface,
} from "./surfaceFrame";

export interface Player {
  /** Per-fixed-step integration (registered as a core FixedStepHook). */
  fixedUpdate(dt: number): void;
  applyImpulse(v: Vec3): void;
  /** Attach to nearest handhold within grabReach; returns id or null. */
  grab(): HandholdId | null;
  release(): void;
  /** Slide along the grabbed handhold at `speed` m/s for one step of `dt`. */
  pullAlong(speed: number, dt: number): void;
  /** Steer the free-floating player toward `target` (no-op while grabbing). */
  moveTo(target: Vec3): void;
  getPosition(): Vec3;
  getVelocity(): Vec3;
  getForward(): Vec3;
  isGrabbing(): boolean;
  getGrabbedId(): HandholdId | null;
  getGrabT(): number | null;
  /** Snap back to spawn, zero velocity, release any grab, clear boots. */
  reset(): void;

  // ---- magnetic boots ----
  /** Plant on / detach from a surface. Plant snaps to the nearest surface (up =
   *  its normal) within reEngageDistance, zeroing velocity. Detach hands the
   *  current tangential walk velocity to the float integrator. No wall-clock. */
  setBooted(on: boolean): void;
  isBooted(): boolean;
  /** Persistent walk intent in [-1,1] (like held keys); consumed each step. */
  walkInput(forward: number, strafe: number): void;
  /** Best-effort auto-walk toward a world target (steers facing in the tangent
   *  plane, walks forward; transitions surfaces en route). */
  walkTo(target: Vec3): void;
  /** Yaw by `dYaw` rad about the surface normal (booted only). */
  turn(dYaw: number): void;
  /** Absolute look: yaw about normal, optional clamped pitch (booted only). */
  setFacing(yaw: number, pitch?: number): void;
  /** Detach + impulse `speed` along the current surface normal (jump off). */
  pushOff(speed: number): void;
  /** Camera up: qRender·(0,1,0) booted (tweened), else [0,1,0]. */
  getUp(): Vec3;
  /** Logical current surface inward normal when booted, else [0,1,0]. */
  getSurfaceNormal(): Vec3;
  /** Unit tangent facing when booted, else current forward heading. */
  getFacing(): Vec3;
}

class PlayerImpl implements Player {
  private readonly scene: Scene;
  private readonly registry: HandholdRegistry;
  private readonly config: SimConfig;
  private readonly boots: BootsConfig;
  private readonly inset: number;
  private readonly controller: KinematicController;
  private readonly mesh: Mesh;

  private velocity: Vec3 = [0, 0, 0];
  private grabbing = false;
  private grabbedId: HandholdId | null = null;
  private grabT: number | null = null;
  // Unit heading used by the first-person camera while FLOATING; tracks travel.
  private forward: Vec3 = [0, 0, 1];

  // ---- boots state ----
  private booted = false;
  private plant: PlantState = {
    surface: surfaceById("floor"),
    facing: [0, 0, 1],
    pitch: 0,
  };
  // Persistent walk intent, consumed each booted fixedUpdate.
  private moveF = 0;
  private moveS = 0;
  // Best-effort auto-walk target (tangent steering); null when inactive.
  private walkTarget: Vec3 | null = null;
  // Last tangential walk velocity (world), for the detach velocity handoff.
  private walkVelocity: Vec3 = [0, 0, 0];

  // Render orientation (advanced ONLY in fixedUpdate). qRender == qTarget except
  // during a surface-transition tween. getForward/getUp are pure reads of these.
  private readonly qRender = new Quaternion();
  private readonly qTarget = new Quaternion();
  private readonly qFrom = new Quaternion();
  private tweenRemaining = 0;

  // Scratch (no per-call allocation in the fixed-step hot path).
  private readonly _localBasis = new Vector3();
  private readonly _rotated = new Vector3();
  private readonly _rightV = new Vector3();
  private readonly _upV = new Vector3();
  private readonly _fwdV = new Vector3();

  constructor(scene: Scene, registry: HandholdRegistry, config: SimConfig) {
    this.scene = scene;
    this.registry = registry;
    this.config = config;
    this.boots = resolveBoots(config);
    this.inset = resolveInset(config);
    this.controller = createController(config);

    // The player mesh is the COLLISION body (ellipsoid). It is kept invisible —
    // the visible embodiment is the cosmetic avatar (src/player/avatar.ts),
    // which follows getPosition()/getForward()/getUp() each rendered frame. The
    // collision ellipsoid and all gameplay are unchanged.
    this.mesh = MeshBuilder.CreateSphere(
      "player",
      { diameter: 0.8, segments: 16 },
      scene,
    );
    this.mesh.isVisible = false;

    // moveWithCollisions prerequisites: non-zero ellipsoid + offset.
    const e = config.playerEllipsoid;
    this.mesh.ellipsoid = new Vector3(e[0], e[1], e[2]);
    this.mesh.ellipsoidOffset = new Vector3(0, 0, 0);
    this.mesh.checkCollisions = true;

    this.reset();
  }

  fixedUpdate(dt: number): void {
    if (this.booted) {
      this.stepBooted(dt);
      return;
    }
    // ---- float path (unchanged) ----
    // While grabbing, free-float integration is suspended.
    if (this.grabbing) return;
    this.controller.integrate(this.mesh, this.velocity, dt);
    // Do NOT realign `forward` to the drift velocity here. The float view is now
    // mouse-controlled (setFacing), and a STABLE view is required for view-
    // relative WASD thrust: if the view chased velocity, reverse thrust would
    // flip the view and cancel itself (S would do nothing). See humanInput.
  }

  /** One booted fixed step: optional auto-steer, walk + re-plant, tween. */
  private stepBooted(dt: number): void {
    if (this.walkTarget) this.steerToward(dt);

    // Capture the tangential walk velocity BEFORE the re-plant (excludes the
    // re-pin / unfold) so the detach handoff direction is correct at an edge.
    const n = this.plant.surface.normal;
    const f = this.plant.facing;
    const r = tangentRight(n, f);
    const ws = this.boots.walkSpeed;
    this.walkVelocity = [
      (f[0] * this.moveF + r[0] * this.moveS) * ws,
      (f[1] * this.moveF + r[1] * this.moveS) * ws,
      (f[2] * this.moveF + r[2] * this.moveS) * ws,
    ];

    const { plant, reorient } = this.controller.walkStep(
      this.mesh,
      this.plant,
      this.moveF,
      this.moveS,
      dt,
    );
    this.plant = plant;
    if (reorient) this.beginTween();
    this.updateRender();
  }

  /** Steer facing toward the active auto-walk target along the tangent plane. */
  private steerToward(dt: number): void {
    const t = this.walkTarget;
    if (!t) return;
    const pos = this.getPosition();
    const n = this.plant.surface.normal;
    const toTan = projectToTangent(
      [t[0] - pos[0], t[1] - pos[1], t[2] - pos[2]],
      n,
    );
    const dist = Math.hypot(toTan[0], toTan[1], toTan[2]);
    if (dist < 0.2) {
      // Arrived (in the tangent plane): stop.
      this.walkTarget = null;
      this.moveF = 0;
      this.moveS = 0;
      return;
    }
    const desired: Vec3 = [toTan[0] / dist, toTan[1] / dist, toTan[2] / dist];
    const cur = this.plant.facing;
    let cosang = dot(cur, desired);
    if (cosang > 1) cosang = 1;
    if (cosang < -1) cosang = -1;
    const ang = Math.acos(cosang);
    const cr = cross(cur, desired);
    const sign = dot(cr, n) >= 0 ? 1 : -1;
    const dyaw = sign * Math.min(ang, this.boots.turnRate * dt);
    const next = projectToTangent(rotateAbout(cur, n, dyaw), n);
    this.plant.facing = normOr(next, refTangent(this.plant.surface));
    this.moveF = 1;
    this.moveS = 0;
  }

  /** Start (or restart) the reorientation tween from the current qRender. */
  private beginTween(): void {
    this.qFrom.copyFrom(this.qRender);
    this.tweenRemaining = Math.max(1, this.boots.surfaceTweenSteps);
  }

  /** Recompute qTarget from the plant; advance/snap qRender (fixed-step only). */
  private updateRender(): void {
    // Build an orthonormal camera basis (right, up, forward) so that
    //   qTarget·(0,0,1) == look (facing tilted by pitch)
    //   qTarget·(0,1,0) == up   (surface normal at pitch 0, tilting with pitch)
    // `right` is the pitch rotation axis (horizontal in the tangent plane) so
    // the camera never rolls. RotationQuaternionFromAxisToRef maps the local
    // x/y/z axes onto (right, up, forward) exactly — unlike FromLookDirectionLH,
    // whose convention does not satisfy q·(0,0,1)==forward in this engine build.
    const n = this.plant.surface.normal;
    const f = this.plant.facing;
    const r = tangentRight(n, f);
    const look = rotateAbout(f, r, this.plant.pitch);
    const up = cross(look, r); // = cross(forward, right): unit, completes RH basis
    this._rightV.set(r[0], r[1], r[2]);
    this._upV.set(up[0], up[1], up[2]);
    this._fwdV.set(look[0], look[1], look[2]);
    Quaternion.RotationQuaternionFromAxisToRef(
      this._rightV,
      this._upV,
      this._fwdV,
      this.qTarget,
    );

    if (this.tweenRemaining > 0) {
      this.tweenRemaining -= 1;
      const steps = this.boots.surfaceTweenSteps;
      const tt = steps > 0 ? (steps - this.tweenRemaining) / steps : 1;
      Quaternion.SlerpToRef(this.qFrom, this.qTarget, tt, this.qRender);
    } else {
      this.qRender.copyFrom(this.qTarget);
    }
  }

  applyImpulse(v: Vec3): void {
    // Float-only: while booted, walking is driven by walkInput, not impulses.
    if (this.grabbing || this.booted) return;
    this.velocity[0] += v[0];
    this.velocity[1] += v[1];
    this.velocity[2] += v[2];
  }

  grab(): HandholdId | null {
    // Latch onto the nearest handhold within grabReach, recording the
    // normalized arc position of the closest centerline point (analytic — no
    // physics). Free-float integration is suspended until release().
    if (this.booted) return null;
    if (this.grabbing) return this.grabbedId;
    const pos = this.getPosition();
    const hit = this.registry.nearest(pos, this.config.grabReach);
    if (!hit) return null;
    this.grabbing = true;
    this.grabbedId = hit.id;
    this.grabT = hit.t;
    this.velocity = [0, 0, 0];
    // Aim the camera down the tube toward its far (goal) end.
    this.faceAlongHandhold();
    return this.grabbedId;
  }

  release(): void {
    this.grabbing = false;
    this.grabbedId = null;
    this.grabT = null;
  }

  pullAlong(speed: number, dt: number): void {
    // No-op unless attached. Slide hand-over-hand along the grabbed handhold's
    // centerline at `speed` m/s for one step of `dt` (sign selects direction:
    // + toward the end, - toward the start) by advancing grabT along arc
    // length and snapping the player onto registry.sampleAt(t).
    if (!this.grabbing || this.grabbedId === null || this.grabT === null) return;
    const hh = this.registry.get(this.grabbedId);
    if (!hh) {
      // The handhold was removed underneath us (e.g. reset/clear) — let go.
      this.release();
      return;
    }
    const total = polylineLength(hh.points);
    if (total <= 1e-9) return;

    // Convert a linear pull distance (speed * dt, in metres) into a delta on
    // the normalized [0..1] arc parameter, then clamp to the tube extent.
    const dtArc = (speed * dt) / total;
    let next = this.grabT + dtArc;
    if (next < 0) next = 0;
    if (next > 1) next = 1;

    const before = this.getPosition();
    const p = this.registry.sampleAt(this.grabbedId, next);
    if (!p) return;
    this.grabT = next;
    this.mesh.position.set(p[0], p[1], p[2]);

    // Face the direction of travel so the first-person camera follows the pull.
    const dx = p[0] - before[0];
    const dy = p[1] - before[1];
    const dz = p[2] - before[2];
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) this.forward = [dx / len, dy / len, dz / len];
  }

  moveTo(target: Vec3): void {
    // Kinematic steer for the free-floating player (no-op while grabbing or
    // booted): point the velocity straight at `target`. Speed is full unless the
    // target is so close that maxSpeed would overshoot within one fixed step, in
    // which case it eases in to land on the point. The integrator's damping then
    // bleeds momentum naturally if moveTo is not re-issued.
    if (this.grabbing || this.booted) return;
    const pos = this.getPosition();
    const dx = target[0] - pos[0];
    const dy = target[1] - pos[1];
    const dz = target[2] - pos[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6) {
      this.velocity[0] = 0;
      this.velocity[1] = 0;
      this.velocity[2] = 0;
      return;
    }
    const speed = Math.min(this.config.maxSpeed, dist / this.config.fixedDt);
    const k = speed / dist;
    this.velocity[0] = dx * k;
    this.velocity[1] = dy * k;
    this.velocity[2] = dz * k;
    this.forward = [dx / dist, dy / dist, dz / dist];
  }

  getPosition(): Vec3 {
    const p = this.mesh.position;
    return [p.x, p.y, p.z];
  }

  getVelocity(): Vec3 {
    return [this.velocity[0], this.velocity[1], this.velocity[2]];
  }

  getForward(): Vec3 {
    // Booted: the tweened camera look (facing + pitch) = qRender·(0,0,1).
    // Float: unit heading tracking drift / pull / steer (defaults +Z at rest).
    if (this.booted) {
      this._localBasis.copyFromFloats(0, 0, 1);
      this._localBasis.applyRotationQuaternionToRef(this.qRender, this._rotated);
      return [this._rotated.x, this._rotated.y, this._rotated.z];
    }
    return [this.forward[0], this.forward[1], this.forward[2]];
  }

  getUp(): Vec3 {
    // Booted: qRender·(0,1,0) (smoothed surface normal during a transition).
    // Float: world up — preserves the existing first-person framing.
    if (this.booted) {
      this._localBasis.copyFromFloats(0, 1, 0);
      this._localBasis.applyRotationQuaternionToRef(this.qRender, this._rotated);
      return [this._rotated.x, this._rotated.y, this._rotated.z];
    }
    return [0, 1, 0];
  }

  getSurfaceNormal(): Vec3 {
    if (this.booted) {
      const n = this.plant.surface.normal;
      return [n[0], n[1], n[2]];
    }
    return [0, 1, 0];
  }

  getFacing(): Vec3 {
    if (this.booted) {
      const f = this.plant.facing;
      return [f[0], f[1], f[2]];
    }
    return [this.forward[0], this.forward[1], this.forward[2]];
  }

  isBooted(): boolean {
    return this.booted;
  }

  setBooted(on: boolean): void {
    if (on) {
      if (this.booted) return;
      const pos = this.getPosition();
      const near = nearestSurface(pos);
      // Only plant if close enough to a surface plane.
      if (near.dist > this.boots.reEngageDistance) return;
      if (this.grabbing) this.release();
      this.plantOn(near.surface);
    } else {
      if (!this.booted) return;
      this.detach();
    }
  }

  /** Snap onto `surface`: pin to standHeight, derive facing, set the frame. */
  private plantOn(surface: Surface): void {
    this.booted = true;
    this.velocity = [0, 0, 0];
    this.walkVelocity = [0, 0, 0];
    this.moveF = 0;
    this.moveS = 0;
    this.walkTarget = null;

    // Facing: project the current float heading onto the tangent plane; fall
    // back to the surface reference tangent if degenerate.
    const n = surface.normal;
    const f = normOr(projectToTangent(this.forward, n), refTangent(surface));

    // Pin to standHeight (and unfold if the spawn point is slightly past an
    // edge); inset keeps the plant clear of perpendicular walls at a corner.
    const res = replant(
      this.getPosition(),
      surface,
      f,
      this.boots.standHeight,
      this.inset,
    );
    this.mesh.position.set(res.center[0], res.center[1], res.center[2]);
    this.mesh.computeWorldMatrix(true);
    this.plant = { surface: res.surface, facing: res.facing, pitch: 0 };

    // Establish the render orientation immediately (no tween on initial plant).
    this.tweenRemaining = 0;
    this.updateRender();
  }

  /** Detach into free-float, handing the last tangential velocity to the float
   *  integrator. */
  private detach(): void {
    this.booted = false;
    this.velocity = [
      this.walkVelocity[0],
      this.walkVelocity[1],
      this.walkVelocity[2],
    ];
    this.moveF = 0;
    this.moveS = 0;
    this.walkTarget = null;
    const sp = Math.hypot(this.velocity[0], this.velocity[1], this.velocity[2]);
    if (sp > 1e-6) {
      this.forward = [
        this.velocity[0] / sp,
        this.velocity[1] / sp,
        this.velocity[2] / sp,
      ];
    }
  }

  walkInput(forward: number, strafe: number): void {
    // Manual intent cancels any active auto-walk steering.
    this.walkTarget = null;
    this.moveF = clamp1(forward);
    this.moveS = clamp1(strafe);
  }

  walkTo(target: Vec3): void {
    if (!this.booted) return;
    this.walkTarget = [target[0], target[1], target[2]];
    this.moveF = 0;
    this.moveS = 0;
  }

  turn(dYaw: number): void {
    if (!this.booted) return;
    this.walkTarget = null;
    const n = this.plant.surface.normal;
    const f = projectToTangent(rotateAbout(this.plant.facing, n, dYaw), n);
    this.plant.facing = normOr(f, refTangent(this.plant.surface));
  }

  setFacing(yaw: number, pitch?: number): void {
    if (!this.booted) {
      // Floating: free world-frame look — yaw about world up from +Z, then pitch.
      // Drives the stable first-person view so WASD thrust is view-relative and
      // the camera no longer chases the drift velocity.
      const p = pitch ?? 0;
      const cp = Math.cos(p);
      this.forward = [Math.sin(yaw) * cp, Math.sin(p), Math.cos(yaw) * cp];
      return;
    }
    this.walkTarget = null;
    const surface = this.plant.surface;
    const n = surface.normal;
    const ref = refTangent(surface);
    const f = projectToTangent(rotateAbout(ref, n, yaw), n);
    this.plant.facing = normOr(f, ref);
    if (pitch !== undefined) {
      const c = this.boots.pitchClamp;
      this.plant.pitch = Math.max(-c, Math.min(c, pitch));
    }
  }

  pushOff(speed: number): void {
    if (!this.booted) return;
    const n = this.plant.surface.normal;
    this.detach();
    this.velocity[0] += n[0] * speed;
    this.velocity[1] += n[1] * speed;
    this.velocity[2] += n[2] * speed;
    const sp = Math.hypot(this.velocity[0], this.velocity[1], this.velocity[2]);
    if (sp > 1e-6) {
      this.forward = [
        this.velocity[0] / sp,
        this.velocity[1] / sp,
        this.velocity[2] / sp,
      ];
    }
  }

  /** Orient `forward` down the grabbed tube toward its far (increasing-t) end. */
  private faceAlongHandhold(): void {
    if (this.grabbedId === null || this.grabT === null) return;
    const eps = 1e-3;
    const a = this.registry.sampleAt(
      this.grabbedId,
      Math.max(0, this.grabT - eps),
    );
    const b = this.registry.sampleAt(
      this.grabbedId,
      Math.min(1, this.grabT + eps),
    );
    if (!a || !b) return;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) this.forward = [dx / len, dy / len, dz / len];
  }

  isGrabbing(): boolean {
    return this.grabbing;
  }

  getGrabbedId(): HandholdId | null {
    return this.grabbedId;
  }

  getGrabT(): number | null {
    return this.grabT;
  }

  reset(): void {
    const s = this.config.spawn;
    this.mesh.position.set(s[0], s[1], s[2]);
    this.mesh.computeWorldMatrix(true);
    this.velocity = [0, 0, 0];
    this.grabbing = false;
    this.grabbedId = null;
    this.grabT = null;
    this.forward = [0, 0, 1];

    // Clear boots -> floating, up = [0,1,0], facing = [0,0,1].
    this.booted = false;
    this.moveF = 0;
    this.moveS = 0;
    this.walkTarget = null;
    this.walkVelocity = [0, 0, 0];
    this.plant = { surface: surfaceById("floor"), facing: [0, 0, 1], pitch: 0 };
    this.tweenRemaining = 0;
    this.qRender.copyFromFloats(0, 0, 0, 1);
    this.qTarget.copyFromFloats(0, 0, 0, 1);
    this.qFrom.copyFromFloats(0, 0, 0, 1);
  }
}

/** Total polyline arc length (metres) over a list of control points. */
function polylineLength(points: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const dz = points[i][2] - points[i - 1][2];
    total += Math.hypot(dx, dy, dz);
  }
  return total;
}

function clamp1(x: number): number {
  if (x > 1) return 1;
  if (x < -1) return -1;
  return x;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Normalize `v`, falling back to `fallback` (assumed unit) if degenerate. */
function normOr(v: Vec3, fallback: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-9)) return [fallback[0], fallback[1], fallback[2]];
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function createPlayer(
  scene: Scene,
  registry: HandholdRegistry,
  config: SimConfig,
): Player {
  return new PlayerImpl(scene, registry, config);
}
