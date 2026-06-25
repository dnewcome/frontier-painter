// src/dressing/textures.ts
// Procedural canvas/DynamicTexture generators for the ISS-style ship dressing.
// Everything here is pure geometry+canvas drawing: NO external/binary assets and
// NO non-deterministic input. Any "scatter" (rivets, stars) is driven by a tiny
// seeded PRNG (mulberry32) with a FIXED seed so every generated texture is
// byte-identical across runs and the demo screenshots stay reproducible.
import type { Scene } from "@babylonjs/core/scene";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";

/** Deterministic PRNG. Same seed => same sequence, no Math.random/Date.now. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx2D = CanvasRenderingContext2D;

function ctxOf(tex: DynamicTexture): Ctx2D {
  // getContext() returns the backing 2D canvas context for hand-drawing.
  return tex.getContext() as unknown as Ctx2D;
}

/**
 * Modular wall-panel skin: off-white / light-grey plating with inset panel-line
 * seams, corner fasteners, and a single cool blue-grey accent stripe banding the
 * upper third. Drawn at full wall height (V) and one panel wide (U) so it tiles
 * horizontally only and the accent band sits at a consistent height all around.
 */
export function makePanelTexture(scene: Scene, name: string): DynamicTexture {
  const W = 256;
  const H = 768; // 3 stacked 2 m panels => one full 6 m wall height.
  const tex = new DynamicTexture(name, { width: W, height: H }, scene, false);
  const c = ctxOf(tex);
  const rnd = mulberry32(1337);

  // Base plating.
  c.fillStyle = "#c9ced4";
  c.fillRect(0, 0, W, H);

  // Subtle vertical brushed shading.
  for (let x = 0; x < W; x += 4) {
    const v = 200 + Math.floor(rnd() * 18);
    c.fillStyle = `rgba(${v},${v + 3},${v + 8},0.12)`;
    c.fillRect(x, 0, 2, H);
  }

  const panelH = H / 3;
  // Three panels stacked: draw inset seam + bevel + fasteners per panel.
  for (let i = 0; i < 3; i++) {
    const y0 = i * panelH;
    // Recessed seam (dark groove).
    c.strokeStyle = "#7c828c";
    c.lineWidth = 6;
    c.strokeRect(8, y0 + 8, W - 16, panelH - 16);
    // Light bevel highlight inside the groove.
    c.strokeStyle = "rgba(255,255,255,0.55)";
    c.lineWidth = 2;
    c.strokeRect(12, y0 + 12, W - 24, panelH - 24);
    // Corner fasteners.
    const fast = (fx: number, fy: number) => {
      c.fillStyle = "#6b7178";
      c.beginPath();
      c.arc(fx, fy, 5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.5)";
      c.beginPath();
      c.arc(fx - 1, fy - 1, 2, 0, Math.PI * 2);
      c.fill();
    };
    fast(26, y0 + 26);
    fast(W - 26, y0 + 26);
    fast(26, y0 + panelH - 26);
    fast(W - 26, y0 + panelH - 26);
  }

  // Cool blue-grey accent stripe across the upper panel (visual "datum line").
  const sy = panelH * 0.55;
  c.fillStyle = "#5b6b80";
  c.fillRect(0, sy, W, 26);
  c.fillStyle = "#8fa0b6";
  c.fillRect(0, sy, W, 4);
  c.fillStyle = "rgba(0,0,0,0.25)";
  c.fillRect(0, sy + 22, W, 4);

  tex.update(false);
  return tex;
}

/**
 * Floor grating: dark structural base with a lighter raised diamond/grid mesh so
 * it reads as walk-on deck plating. Tiles in both axes.
 */
export function makeGratingTexture(scene: Scene, name: string): DynamicTexture {
  const S = 256;
  const tex = new DynamicTexture(name, { width: S, height: S }, scene, false);
  const c = ctxOf(tex);

  c.fillStyle = "#3a3f47";
  c.fillRect(0, 0, S, S);

  // Open grid cells (darker) leaving lighter bars between.
  const cell = 32;
  c.fillStyle = "#23262b";
  for (let y = 0; y < S; y += cell) {
    for (let x = 0; x < S; x += cell) {
      c.fillRect(x + 6, y + 6, cell - 12, cell - 12);
    }
  }
  // Raised bar highlights.
  c.strokeStyle = "rgba(180,188,198,0.5)";
  c.lineWidth = 2;
  for (let p = 0; p <= S; p += cell) {
    c.beginPath();
    c.moveTo(p, 0);
    c.lineTo(p, S);
    c.moveTo(0, p);
    c.lineTo(S, p);
    c.stroke();
  }
  // Diagonal tread accents.
  c.strokeStyle = "rgba(120,128,138,0.35)";
  c.lineWidth = 3;
  for (let d = -S; d < S; d += 24) {
    c.beginPath();
    c.moveTo(d, 0);
    c.lineTo(d + S, S);
    c.stroke();
  }

  tex.update(false);
  return tex;
}

/**
 * Starfield for a viewport: black space with a deterministic scatter of stars
 * (varying brightness, a few cool/warm tints) used as an EMISSIVE texture so the
 * "outside" glows against the sealed interior.
 */
export function makeStarfieldTexture(scene: Scene, name: string): DynamicTexture {
  const S = 512;
  const tex = new DynamicTexture(name, { width: S, height: S }, scene, false);
  const c = ctxOf(tex);
  const rnd = mulberry32(90210);

  c.fillStyle = "#04060d";
  c.fillRect(0, 0, S, S);

  // Faint nebula wash (cool).
  const grad = c.createRadialGradient(S * 0.35, S * 0.4, 10, S * 0.35, S * 0.4, S * 0.6);
  grad.addColorStop(0, "rgba(40,55,90,0.25)");
  grad.addColorStop(1, "rgba(4,6,13,0)");
  c.fillStyle = grad;
  c.fillRect(0, 0, S, S);

  const stars = 320;
  for (let i = 0; i < stars; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = rnd() * 1.6 + 0.3;
    const b = 140 + Math.floor(rnd() * 115);
    const tint = rnd();
    let col: string;
    if (tint < 0.15) col = `rgb(${b - 30},${b - 10},${b})`; // cool
    else if (tint < 0.22) col = `rgb(${b},${b - 15},${b - 30})`; // warm
    else col = `rgb(${b},${b},${b})`;
    c.fillStyle = col;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    // A few bright stars get a glow.
    if (rnd() > 0.965) {
      c.fillStyle = "rgba(200,215,255,0.25)";
      c.beginPath();
      c.arc(x, y, r * 4, 0, Math.PI * 2);
      c.fill();
    }
  }

  tex.update(false);
  return tex;
}

/**
 * Stencilled label / decal plate: dark plate with white stencil text (optionally
 * a small caution swatch). Opaque, so no alpha bookkeeping needed.
 */
export function makeLabelTexture(
  scene: Scene,
  name: string,
  line1: string,
  line2 = "",
): DynamicTexture {
  const W = 512;
  const H = 256;
  const tex = new DynamicTexture(name, { width: W, height: H }, scene, false);
  const c = ctxOf(tex);

  // Plate.
  c.fillStyle = "#2b2f36";
  c.fillRect(0, 0, W, H);
  c.strokeStyle = "#5b6b80";
  c.lineWidth = 10;
  c.strokeRect(8, 8, W - 16, H - 16);

  // Stencil text.
  c.fillStyle = "#e8edf2";
  c.textAlign = "center";
  c.textBaseline = "middle";
  if (line2) {
    c.font = "bold 96px monospace";
    c.fillText(line1, W / 2, H * 0.36);
    c.font = "bold 64px monospace";
    c.fillStyle = "#9fb0c4";
    c.fillText(line2, W / 2, H * 0.72);
  } else {
    c.font = "bold 120px monospace";
    c.fillText(line1, W / 2, H / 2);
  }

  tex.update(false);
  return tex;
}

/**
 * Caution chevron band, drawn in DESATURATED grey/dark tones (NOT amber/yellow)
 * so it never competes with the amber handhold or the green/gold goal.
 */
export function makeChevronTexture(scene: Scene, name: string): DynamicTexture {
  const W = 256;
  const H = 64;
  const tex = new DynamicTexture(name, { width: W, height: H }, scene, false);
  const c = ctxOf(tex);

  c.fillStyle = "#c2c7cd";
  c.fillRect(0, 0, W, H);
  c.fillStyle = "#3a3f47";
  const step = 48;
  for (let x = -H; x < W; x += step) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x + step / 2, 0);
    c.lineTo(x + step / 2 - H, H);
    c.lineTo(x - H, H);
    c.closePath();
    c.fill();
  }

  tex.update(false);
  return tex;
}

/** Dark louvered vent grille. */
export function makeVentTexture(scene: Scene, name: string): DynamicTexture {
  const S = 128;
  const tex = new DynamicTexture(name, { width: S, height: S }, scene, false);
  const c = ctxOf(tex);
  c.fillStyle = "#4a4f57";
  c.fillRect(0, 0, S, S);
  c.strokeStyle = "#5b6b80";
  c.lineWidth = 6;
  c.strokeRect(4, 4, S - 8, S - 8);
  c.fillStyle = "#1d2024";
  for (let y = 16; y < S - 12; y += 16) {
    c.fillRect(12, y, S - 24, 9);
  }
  tex.update(false);
  return tex;
}
