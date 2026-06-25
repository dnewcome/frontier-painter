// src/drawing/drawing.ts
// The core verb. Captures strokes either programmatically via drawStroke(points)
// or from live pointer drags (projected onto a draw plane in front of the active
// camera). Freezes a stroke into a collidable tube and registers it. Maintains
// the handhold registry plus analytic centerline math used by player grab/pull.
//
// Determinism note: live pointer capture is OFF by default and is never engaged
// in headless/scripted runs (main.ts calls setInputEnabled(false)). The capture
// path feeds the very same registry.freeze() that drawStroke() uses, so the only
// non-deterministic input (raw pointer coordinates) stays out of the fixed-step
// simulation entirely.
import type { Scene } from "@babylonjs/core/scene";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import {
  PointerEventTypes,
  type PointerInfo,
} from "@babylonjs/core/Events/pointerEvents";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type {
  Vec3,
  HandholdId,
  HandholdState,
  SimConfig,
} from "../types";
import {
  freezeStrokeMesh,
  nearestOnPolyline,
  sampleAtT,
  type FrozenStroke,
} from "./strokeFreeze";

/** Distance (m) in front of the active camera at which a live stroke is drawn. */
const DRAW_PLANE_DISTANCE = 5;
/** Minimum spacing (m) between captured stroke samples; decimates dense drags. */
const MIN_SAMPLE_SPACING = 0.15;

/** Result of projecting a query point onto a handhold centerline. */
export interface HandholdHit {
  id: HandholdId;
  /** Closest point on the centerline (world space). */
  point: Vec3;
  /** Distance from the query point to the centerline (m). */
  distance: number;
  /** Normalized [0..1] arc-length position of `point`. */
  t: number;
}

export interface HandholdRegistry {
  /** Freeze a stroke (>=2 pts) into a collidable tube; returns its id. */
  freeze(points: Vec3[], radius: number): HandholdId;
  get(id: HandholdId): HandholdState | undefined;
  list(): HandholdState[];
  /** Nearest handhold whose centerline lies within `maxDist` of `pos`, else null. */
  nearest(pos: Vec3, maxDist: number): HandholdHit | null;
  /** World position at arc-parameter t in [0..1] for a handhold, else null. */
  sampleAt(id: HandholdId, t: number): Vec3 | null;
  /** Dispose all tube meshes + clear registry (used by reset). */
  clear(): void;
}

export interface Drawing {
  readonly registry: HandholdRegistry;
  /** Enable/disable live pointer-drag capture. MUST be false in headless runs. */
  setInputEnabled(enabled: boolean): void;
}

interface Entry {
  state: HandholdState;
  frozen: FrozenStroke;
}

class RegistryImpl implements HandholdRegistry {
  private readonly scene: Scene;
  private readonly entries = new Map<HandholdId, Entry>();
  // Deterministic ids: no Math.random / Date.now in the simulation path.
  private counter = 0;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  freeze(points: Vec3[], radius: number): HandholdId {
    if (points.length < 2) {
      throw new Error("freeze requires >= 2 points");
    }
    const id = `hh${++this.counter}`;
    const cloned: Vec3[] = points.map((p) => [p[0], p[1], p[2]]);
    const frozen = freezeStrokeMesh(this.scene, id, cloned, radius);
    this.entries.set(id, {
      state: { id, points: cloned, radius },
      frozen,
    });
    return id;
  }

  get(id: HandholdId): HandholdState | undefined {
    const e = this.entries.get(id);
    return e ? cloneState(e.state) : undefined;
  }

  list(): HandholdState[] {
    return [...this.entries.values()].map((e) => cloneState(e.state));
  }

  nearest(pos: Vec3, maxDist: number): HandholdHit | null {
    let best: HandholdHit | null = null;
    for (const e of this.entries.values()) {
      const hit = nearestOnPolyline(
        e.state.points,
        e.frozen.arcLengths,
        e.frozen.totalLength,
        pos,
      );
      if (
        hit.distance <= maxDist &&
        (best === null || hit.distance < best.distance)
      ) {
        best = {
          id: e.state.id,
          point: hit.point,
          distance: hit.distance,
          t: hit.t,
        };
      }
    }
    return best;
  }

  sampleAt(id: HandholdId, t: number): Vec3 | null {
    const e = this.entries.get(id);
    if (!e) return null;
    return sampleAtT(
      e.state.points,
      e.frozen.arcLengths,
      e.frozen.totalLength,
      t,
    );
  }

  clear(): void {
    for (const e of this.entries.values()) {
      e.frozen.mesh.dispose();
    }
    this.entries.clear();
    this.counter = 0;
  }
}

function cloneState(s: HandholdState): HandholdState {
  return {
    id: s.id,
    radius: s.radius,
    points: s.points.map((p) => [p[0], p[1], p[2]] as Vec3),
  };
}

class DrawingImpl implements Drawing {
  readonly registry: HandholdRegistry;

  private readonly scene: Scene;
  private readonly config: SimConfig;
  private inputEnabled = false;
  private pointerObserver: Observer<PointerInfo> | null = null;

  // Live-capture state: world-space samples of the stroke currently being drawn.
  private capturing = false;
  private readonly pending: Vec3[] = [];

  constructor(scene: Scene, config: SimConfig) {
    this.scene = scene;
    this.config = config;
    this.registry = new RegistryImpl(scene);
  }

  setInputEnabled(enabled: boolean): void {
    if (enabled === this.inputEnabled) return;
    this.inputEnabled = enabled;
    if (enabled) {
      this.attachPointer();
    } else {
      this.detachPointer();
    }
  }

  private attachPointer(): void {
    if (this.pointerObserver) return;
    this.pointerObserver = this.scene.onPointerObservable.add((info) =>
      this.onPointer(info),
    );
  }

  private detachPointer(): void {
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
    this.capturing = false;
    this.pending.length = 0;
  }

  private onPointer(info: PointerInfo): void {
    // Defensive: never act on a stale event after disabling.
    if (!this.inputEnabled) return;

    switch (info.type) {
      case PointerEventTypes.POINTERDOWN:
        // Primary button only; ignore right/middle so camera controls survive.
        if (info.event.button !== 0) return;
        this.capturing = true;
        this.pending.length = 0;
        this.addSample();
        break;

      case PointerEventTypes.POINTERMOVE:
        if (!this.capturing) return;
        this.addSample();
        break;

      case PointerEventTypes.POINTERUP:
        if (!this.capturing) return;
        this.capturing = false;
        this.addSample();
        // A stroke needs >= 2 distinct samples to form a tube.
        if (this.pending.length >= 2) {
          this.registry.freeze(
            this.pending.map((p) => [p[0], p[1], p[2]] as Vec3),
            this.config.handholdRadius,
          );
        }
        this.pending.length = 0;
        break;
    }
  }

  /** Project the current pointer onto the draw plane and append (if far enough). */
  private addSample(): void {
    const p = this.projectPointer();
    if (!p) return;
    const last = this.pending[this.pending.length - 1];
    if (last) {
      const dx = p[0] - last[0];
      const dy = p[1] - last[1];
      const dz = p[2] - last[2];
      if (dx * dx + dy * dy + dz * dz < MIN_SAMPLE_SPACING * MIN_SAMPLE_SPACING) {
        return;
      }
    }
    this.pending.push(p);
  }

  /**
   * Intersect the pointer ray with a plane held DRAW_PLANE_DISTANCE m in front of
   * the active camera (plane normal = camera forward, so it always faces the
   * viewer). Returns the world-space hit, or null if there is no active camera or
   * the ray runs parallel to the plane.
   */
  private projectPointer(): Vec3 | null {
    const cam = this.scene.activeCamera;
    if (!cam) return null;

    const forward = cam.getForwardRay().direction;
    const planePoint = cam.globalPosition.add(forward.scale(DRAW_PLANE_DISTANCE));
    const plane = Plane.FromPositionAndNormal(planePoint, forward);

    const ray = this.scene.createPickingRay(
      this.scene.pointerX,
      this.scene.pointerY,
      null,
      cam,
    );
    const dist = ray.intersectsPlane(plane);
    if (dist === null) return null;

    const hit = ray.origin.add(ray.direction.scale(dist));
    return [hit.x, hit.y, hit.z];
  }
}

export function createDrawing(scene: Scene, config: SimConfig): Drawing {
  return new DrawingImpl(scene, config);
}
