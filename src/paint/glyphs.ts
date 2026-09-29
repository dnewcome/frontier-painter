// src/paint/glyphs.ts
// The stroke you trace to lay down each paint property. One continuous stroke
// per property, in a normalized box ([-1, 1] on both axes, +y DOWN like the
// screen), resampled to evenly spaced points so tracing progress is uniform.
//
//   cold        an inward spiral — a freezing coil
//   conductive  a lightning-bolt zigzag
//   magnetic    a horseshoe
import type { PaintProperty } from "../types";

export type Pt = [number, number];

function spiral(): Pt[] {
  const out: Pt[] = [];
  const turns = 1.5;
  const steps = 90;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = -Math.PI / 2 + t * turns * 2 * Math.PI;
    const r = 1 - 0.78 * t;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

function horseshoe(): Pt[] {
  const out: Pt[] = [[-0.62, -0.95]];
  const cy = 0.1;
  const r = 0.62;
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI - (i / 24) * Math.PI; // left -> bottom -> right
    out.push([Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  out.push([0.62, -0.95]);
  return out;
}

const RAW: Record<PaintProperty, Pt[]> = {
  cold: spiral(),
  conductive: [
    [0.38, -1],
    [-0.36, 0.06],
    [0.32, 0.06],
    [-0.34, 1],
  ],
  magnetic: horseshoe(),
};

/** Evenly resample a polyline to `n` points along its arc length. */
export function resample(pts: Pt[], n: number): Pt[] {
  const seg: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    seg.push(seg[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = seg[seg.length - 1];
  const out: Pt[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const d = (k / (n - 1)) * total;
    while (j < pts.length - 1 && seg[j] < d) j++;
    const span = seg[j] - seg[j - 1] || 1;
    const t = Math.min(1, Math.max(0, (d - seg[j - 1]) / span));
    out.push([
      pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t,
      pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * t,
    ]);
  }
  return out;
}

/** The glyph for `prop`, resampled to `n` evenly spaced normalized points. */
export function glyphFor(prop: PaintProperty, n = 64): Pt[] {
  return resample(RAW[prop], n);
}
