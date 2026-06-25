// src/player/surfaceFrame.ts
// Pure box-surface math for the magnetic-boots locomotion state. NO Babylon
// mesh/scene state, NO wall-clock, NO RNG — every function is a deterministic
// pure function of its arguments (Quaternion is used only as a math value type).
//
// The interior of the room is an axis-aligned box (see src/world/room.ts):
//   X in [-8, 8], Y in [0, 6], Z in [-10, 10].
// Each of the 6 interior surfaces has an inward normal == the player "up" when
// planted on it. Walking is a tangential move in a surface's tangent plane;
// crossing a tangent-rect bound "unfolds" the player analytically onto the
// adjacent surface (the box is 90 degrees, so transitions need no raycasts).
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Vec3 } from "../types";

export type SurfaceId =
  | "floor"
  | "ceiling"
  | "wallNegX"
  | "wallPosX"
  | "wallNegZ"
  | "wallPosZ";

export interface Surface {
  id: SurfaceId;
  /** Inward normal == player up when planted on this surface. */
  normal: Vec3;
  /** Normal axis index (X=0, Y=1, Z=2). */
  axis: 0 | 1 | 2;
  /** Surface coordinate on `axis`. */
  planeValue: number;
  /** Direction of `normal` along `axis`. */
  inwardSign: 1 | -1;
  /** Tangent axis A. */
  tA: 0 | 1 | 2;
  /** Tangent axis B. */
  tB: 0 | 1 | 2;
  /** Rect bounds on tA. */
  minA: number;
  maxA: number;
  /** Rect bounds on tB. */
  minB: number;
  maxB: number;
}

// Interior bounds baked from room.ts (ROOM_X=16, ROOM_Y=6, ROOM_Z=20).
const HX = 8; // X half-extent
const Y0 = 0; // floor Y
const Y1 = 6; // ceiling Y
const HZ = 10; // Z half-extent

export const SURFACES: readonly Surface[] = [
  {
    id: "floor",
    normal: [0, 1, 0],
    axis: 1,
    planeValue: Y0,
    inwardSign: 1,
    tA: 0,
    tB: 2,
    minA: -HX,
    maxA: HX,
    minB: -HZ,
    maxB: HZ,
  },
  {
    id: "ceiling",
    normal: [0, -1, 0],
    axis: 1,
    planeValue: Y1,
    inwardSign: -1,
    tA: 0,
    tB: 2,
    minA: -HX,
    maxA: HX,
    minB: -HZ,
    maxB: HZ,
  },
  {
    id: "wallNegX",
    normal: [1, 0, 0],
    axis: 0,
    planeValue: -HX,
    inwardSign: 1,
    tA: 1,
    tB: 2,
    minA: Y0,
    maxA: Y1,
    minB: -HZ,
    maxB: HZ,
  },
  {
    id: "wallPosX",
    normal: [-1, 0, 0],
    axis: 0,
    planeValue: HX,
    inwardSign: -1,
    tA: 1,
    tB: 2,
    minA: Y0,
    maxA: Y1,
    minB: -HZ,
    maxB: HZ,
  },
  {
    id: "wallNegZ",
    normal: [0, 0, 1],
    axis: 2,
    planeValue: -HZ,
    inwardSign: 1,
    tA: 0,
    tB: 1,
    minA: -HX,
    maxA: HX,
    minB: Y0,
    maxB: Y1,
  },
  {
    id: "wallPosZ",
    normal: [0, 0, -1],
    axis: 2,
    planeValue: HZ,
    inwardSign: -1,
    tA: 0,
    tB: 1,
    minA: -HX,
    maxA: HX,
    minB: Y0,
    maxB: Y1,
  },
];

export function surfaceById(id: SurfaceId): Surface {
  const s = SURFACES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown surface id: ${id}`);
  return s;
}

/** Nearest surface to a world point, by perpendicular distance to each plane. */
export function nearestSurface(center: Vec3): { surface: Surface; dist: number } {
  let best = SURFACES[0];
  let bestDist = Infinity;
  for (const s of SURFACES) {
    const d = Math.abs(center[s.axis] - s.planeValue);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return { surface: best, dist: bestDist };
}

// ---- small tuple vector helpers (no allocation churn, fully deterministic) ----

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

function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function norm(a: Vec3, fallback: Vec3): Vec3 {
  const l = len(a);
  if (!(l > 1e-9)) return [fallback[0], fallback[1], fallback[2]];
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Project `v` onto the plane with unit normal `n` (removes the normal part). */
export function projectToTangent(v: Vec3, n: Vec3): Vec3 {
  const d = dot(v, n);
  return [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]];
}

/**
 * right = normalize(cross(up, forward)); falls back to a stable tangent basis if
 * forward is (near-)parallel to up so the result is never zero/NaN.
 */
export function tangentRight(up: Vec3, forward: Vec3): Vec3 {
  const r = cross(up, forward);
  if (len(r) > 1e-6) return norm(r, [1, 0, 0]);
  // forward ∥ up: build a stable tangent by crossing up with world axes.
  let alt = cross(up, [0, 0, 1]);
  if (len(alt) <= 1e-6) alt = cross(up, [1, 0, 0]);
  return norm(alt, [1, 0, 0]);
}

/** Rotate `v` about unit `axis` by `angle` radians (Rodrigues' formula). */
export function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = dot(axis, v) * (1 - c);
  const cx = axis[1] * v[2] - axis[2] * v[1];
  const cy = axis[2] * v[0] - axis[0] * v[2];
  const cz = axis[0] * v[1] - axis[1] * v[0];
  return [
    v[0] * c + cx * s + axis[0] * k,
    v[1] * c + cy * s + axis[1] * k,
    v[2] * c + cz * s + axis[2] * k,
  ];
}

/**
 * Shortest-arc quaternion mapping unit `nFrom` onto unit `nTo`. For the boots
 * transitions these are always orthogonal (a 90 degree fold about the shared
 * edge axis), so the rotation is well-defined and never antipodal/NaN; the
 * identity and 180 degree degeneracies are still guarded for safety.
 */
export function reorientQuat(nFrom: Vec3, nTo: Vec3): Quaternion {
  let d = dot(nFrom, nTo);
  if (d > 1) d = 1;
  if (d < -1) d = -1;
  if (d > 1 - 1e-9) return Quaternion.Identity();
  if (d < -1 + 1e-9) {
    // Antipodal: rotate 180 degrees about any axis perpendicular to nFrom.
    const perp = tangentRight(nFrom, [0, 0, 1]);
    return Quaternion.RotationAxis(new Vector3(perp[0], perp[1], perp[2]), Math.PI);
  }
  const ax = norm(cross(nFrom, nTo), [0, 1, 0]);
  const angle = Math.acos(d);
  return Quaternion.RotationAxis(new Vector3(ax[0], ax[1], ax[2]), angle);
}

export interface Replant {
  /** Re-pinned (and unfolded) center. */
  center: Vec3;
  /** Possibly the adjacent surface after an edge crossing. */
  surface: Surface;
  /** Facing rotated by R on each crossing (unit tangent of the result surface). */
  facing: Vec3;
  /** Accumulated reorientation R if a transition happened, else null. */
  reorient: Quaternion | null;
}

function boundExceed(c: number, lo: number, hi: number): number {
  // Signed overshoot: >0 if above hi (by that amount), <0 if below lo, else 0.
  if (c > hi) return c - hi;
  if (c < lo) return c - lo;
  return 0;
}

function clampNum(v: number, lo: number, hi: number): number {
  // Guard against a degenerate (inverted) window if inset ever exceeds the
  // half-extent: collapse to the midpoint so we never return NaN/inverted.
  if (lo > hi) return (lo + hi) * 0.5;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Re-plant after a tangential move: pin the center to `standHeight` along the
 * surface normal and unfold across any tangent-rect edge crossings onto the
 * adjacent surface(s). Pure: returns the resulting plant. Iterates until the
 * contact is in-bounds (at most ~2 iterations at walk speed, but a hard cap
 * guards against pathological input).
 *
 * `inset` (default 0) shrinks each face's walkable tangent rect by that amount
 * on every edge. It is the player's (ellipsoid radius + a small margin): a
 * planted center is never allowed to REST closer than `inset` to a perpendicular
 * wall, so its collision ellipsoid can't poke through that wall and pushOff's
 * moveWithCollisions can't eject the player out of the box at a corner. Because
 * the same inset edge is also the transition trigger, the floor->wall->ceiling
 * traversal still works: walking past the inset edge folds onto the neighbor
 * (placed at least `inset` clear of the just-crossed edge so it doesn't fold
 * straight back). `inset === 0` reproduces the original behavior exactly.
 */
export function replant(
  center: Vec3,
  surface: Surface,
  facing: Vec3,
  standHeight: number,
  inset = 0,
): Replant {
  let s = surface;
  let c: Vec3 = [center[0], center[1], center[2]];
  let f: Vec3 = [facing[0], facing[1], facing[2]];
  let acc: Quaternion | null = null;

  for (let iter = 0; iter < 8; iter++) {
    // Walkable tangent rect for this face, inset away from its perpendicular
    // walls so a resting center keeps its ellipsoid clear of them.
    const loA = s.minA + inset;
    const hiA = s.maxA - inset;
    const loB = s.minB + inset;
    const hiB = s.maxB - inset;

    // Contact = projection of the center onto this surface's plane.
    const ca = c[s.tA];
    const cb = c[s.tB];
    const overA = boundExceed(ca, loA, hiA);
    const overB = boundExceed(cb, loB, hiB);

    if (overA === 0 && overB === 0) {
      // In bounds: pin the normal coordinate to standHeight, and clamp the two
      // in-surface tangents inside the walkable rect so the rest pose never
      // overlaps a perpendicular wall.
      const out: Vec3 = [c[0], c[1], c[2]];
      out[s.axis] = s.planeValue + s.inwardSign * standHeight;
      out[s.tA] = clampNum(out[s.tA], loA, hiA);
      out[s.tB] = clampNum(out[s.tB], loB, hiB);
      return { center: out, surface: s, facing: f, reorient: acc };
    }

    // Resolve the larger overshoot first (deterministic; for a corner the other
    // axis is handled on the next iteration).
    const useA = Math.abs(overA) >= Math.abs(overB) && overA !== 0;
    const a = useA ? s.tA : s.tB;
    const over = useA ? overA : overB;
    // Real wall plane crossed (used to find the neighbor + place at standHeight).
    const B = over > 0 ? (useA ? s.maxA : s.maxB) : useA ? s.minA : s.minB;
    const d = Math.abs(over);
    const m = s.axis; // old surface normal axis
    const edge = a === s.tA ? s.tB : s.tA; // shared-edge axis (unchanged)

    // New surface: the one whose plane sits at `a = B`.
    const next = SURFACES.find(
      (x) => x.axis === a && Math.abs(x.planeValue - B) < 1e-6,
    );
    if (!next) {
      // No adjacent surface (should not happen for a closed box): pin & finish.
      const out: Vec3 = [c[0], c[1], c[2]];
      out[s.axis] = s.planeValue + s.inwardSign * standHeight;
      out[s.tA] = clampNum(out[s.tA], loA, hiA);
      out[s.tB] = clampNum(out[s.tB], loB, hiB);
      return { center: out, surface: s, facing: f, reorient: acc };
    }

    // Reorient: shortest 90 degree arc from old up to new up.
    const R = reorientQuat(s.normal, next.normal);
    acc = acc ? R.multiply(acc) : R;

    // Rotate facing by R and re-project onto the new tangent plane.
    const fv = new Vector3(f[0], f[1], f[2]).applyRotationQuaternion(R);
    let fNext: Vec3 = [fv.x, fv.y, fv.z];
    fNext = norm(projectToTangent(fNext, next.normal), refTangent(next));

    // Unfold onto the new face. Pin to standHeight off the real wall plane; the
    // old normal axis `m` becomes a tangent of the new face — place it at least
    // `inset` clear of the just-crossed edge (max(d, inset)) so the next
    // iteration doesn't immediately fold the player back across that edge.
    const out: Vec3 = [c[0], c[1], c[2]];
    out[a] = B + next.inwardSign * standHeight; // standHeight on the new face
    out[m] = s.planeValue + s.inwardSign * Math.max(d, inset); // climb onto it
    out[edge] = c[edge]; // shared-edge coordinate unchanged

    c = out;
    f = fNext;
    s = next;
    // Loop re-checks bounds on the new surface (handles corner double-folds).
  }

  // Fallback (cap reached): pin to standHeight on the current surface.
  const out: Vec3 = [c[0], c[1], c[2]];
  out[s.axis] = s.planeValue + s.inwardSign * standHeight;
  out[s.tA] = clampNum(out[s.tA], s.minA + inset, s.maxA - inset);
  out[s.tB] = clampNum(out[s.tB], s.minB + inset, s.maxB - inset);
  return { center: out, surface: s, facing: f, reorient: acc };
}

/**
 * Reference tangent for a surface (its tA positive axis), used as the yaw=0
 * heading for absolute setFacing and as a non-degenerate facing fallback. On
 * the floor this is +X (so setFacing(0) faces +X).
 */
export function refTangent(surface: Surface): Vec3 {
  const v: Vec3 = [0, 0, 0];
  v[surface.tA] = 1;
  return v;
}
