// src/drawing/strokeFreeze.ts
// Freezes a stroke into a collidable tube mesh (MeshBuilder.CreateTube) and
// provides the analytic centerline math (nearest point + arc-length t,
// sampleAt) that player grab/pull rely on.
//
// SLICE 1 SCAFFOLD: tube creation + centerline helpers are implemented because
// they are pure/simple, but the registry wiring is exercised only once gameplay
// is built. No physics is used for grabbing.
import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Vec3 } from "../types";

export interface FrozenStroke {
  mesh: Mesh;
  /** Cumulative arc length at each control point (length == points.length). */
  arcLengths: number[];
  totalLength: number;
}

/** Build a collidable tube mesh along `points`. checkCollisions = true. */
export function freezeStrokeMesh(
  scene: Scene,
  id: string,
  points: Vec3[],
  radius: number,
): FrozenStroke {
  const path = points.map((p) => new Vector3(p[0], p[1], p[2]));
  const mesh = MeshBuilder.CreateTube(
    `handhold:${id}`,
    { path, radius, tessellation: 12, cap: 2, updatable: false },
    scene,
  );
  mesh.checkCollisions = true;

  const mat = new StandardMaterial(`handholdMat:${id}`, scene);
  mat.diffuseColor = new Color3(0.85, 0.6, 0.2);
  mat.emissiveColor = new Color3(0.25, 0.15, 0.02);
  mesh.material = mat;

  const arcLengths: number[] = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Vector3.Distance(path[i - 1], path[i]);
    arcLengths.push(total);
  }

  return { mesh, arcLengths, totalLength: total };
}

/** Project `pos` onto the polyline; returns closest point, distance, and t. */
export function nearestOnPolyline(
  points: Vec3[],
  arcLengths: number[],
  totalLength: number,
  pos: Vec3,
): { point: Vec3; distance: number; t: number } {
  const p = new Vector3(pos[0], pos[1], pos[2]);
  let best = {
    point: points[0],
    distance: Number.POSITIVE_INFINITY,
    t: 0,
  };

  for (let i = 0; i < points.length - 1; i++) {
    const a = new Vector3(points[i][0], points[i][1], points[i][2]);
    const b = new Vector3(
      points[i + 1][0],
      points[i + 1][1],
      points[i + 1][2],
    );
    const ab = b.subtract(a);
    const abLen2 = ab.lengthSquared();
    let s = abLen2 > 1e-9 ? Vector3.Dot(p.subtract(a), ab) / abLen2 : 0;
    if (s < 0) s = 0;
    if (s > 1) s = 1;
    const proj = a.add(ab.scale(s));
    const dist = Vector3.Distance(p, proj);
    if (dist < best.distance) {
      const arcAt =
        totalLength > 1e-9
          ? (arcLengths[i] + s * (arcLengths[i + 1] - arcLengths[i])) /
            totalLength
          : 0;
      best = {
        point: [proj.x, proj.y, proj.z],
        distance: dist,
        t: arcAt,
      };
    }
  }
  return best;
}

/** World position at normalized arc parameter t in [0..1]. */
export function sampleAtT(
  points: Vec3[],
  arcLengths: number[],
  totalLength: number,
  t: number,
): Vec3 {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  if (totalLength <= 1e-9) return points[0];
  const target = clamped * totalLength;
  for (let i = 0; i < points.length - 1; i++) {
    const segLen = arcLengths[i + 1] - arcLengths[i];
    if (target <= arcLengths[i + 1] || i === points.length - 2) {
      const local = segLen > 1e-9 ? (target - arcLengths[i]) / segLen : 0;
      const a = points[i];
      const b = points[i + 1];
      return [
        a[0] + (b[0] - a[0]) * local,
        a[1] + (b[1] - a[1]) * local,
        a[2] + (b[2] - a[2]) * local,
      ];
    }
  }
  return points[points.length - 1];
}
