// src/hud/hud.ts
// Plain DOM overlay (no Babylon GUI) rendered into the #hud element. Shows live
// state (grab flag, handhold count, distance-to-goal, controls hint) and a win
// banner. Stateless beyond DOM nodes + a tiny render cache; refreshed each frame
// from a GameState snapshot.
import type { GameState } from "../types";

export interface Hud {
  /** Refresh overlay text from the latest snapshot (call each frame). */
  update(state: GameState): void;
  /** Show/hide the win banner (idempotent). */
  setWin(won: boolean): void;
  dispose(): void;
}

// Goal sphere center for slice 1 (world space, meters). GameState does not carry
// the goal pose, so the HUD mirrors the spec constant to report distance-to-goal.
const GOAL_CENTER: readonly [number, number, number] = [0, 1, 8];
// Distance (m) from goal center that latches the win (matches SimConfig.goalRadius).
const GOAL_RADIUS = 1.0;

class HudImpl implements Hud {
  private readonly root: HTMLElement;
  private readonly info: HTMLDivElement;
  private readonly banner: HTMLDivElement;

  // Render caches: skip DOM writes when nothing visible changed.
  private lastText = "";
  private lastWon: boolean | null = null;

  constructor(root: HTMLElement) {
    this.root = root;

    this.info = document.createElement("div");
    this.info.className = "hud-info";

    this.banner = document.createElement("div");
    this.banner.className = "win-banner";
    this.banner.textContent = "GOAL REACHED — WIN!";

    this.root.appendChild(this.info);
    this.root.appendChild(this.banner);

    // Hidden until the goal latches. Drives display inline so the banner works
    // even if the page-level CSS is absent.
    this.setWin(false);
  }

  update(state: GameState): void {
    const p = state.playerPos;
    const distGoal = distance(p, GOAL_CENTER);
    const speed = magnitude(state.velocity);

    const grabLine = state.grabbing
      ? `grabbing: yes (${state.grabbedHandholdId ?? "?"}` +
        `${state.grabT != null ? " @ t=" + state.grabT.toFixed(2) : ""})`
      : "grabbing: no";

    const goalLine = state.goalReached
      ? `dist→goal: ${distGoal.toFixed(2)}m  (REACHED)`
      : distGoal <= GOAL_RADIUS
        ? `dist→goal: ${distGoal.toFixed(2)}m  (in range)`
        : `dist→goal: ${distGoal.toFixed(2)}m`;

    const bootsLine = state.booted
      ? `boots: ON  surface↑: ${fmtVec(state.surfaceNormal)}  facing: ${fmtVec(state.facing)}`
      : "boots: off (floating)";

    const lines = [
      "FRONTIER PAINTER — Slice 1",
      `ready: ${state.ready ? "yes" : "no"}   camera: ${state.cameraMode}`,
      `pos: ${fmtVec(p)}`,
      `vel: ${fmtVec(state.velocity)}  |v|=${speed.toFixed(2)} m/s`,
      grabLine,
      bootsLine,
      `handholds: ${state.handholds.length}   ${goalLine}`,
      `elapsed: ${state.elapsed.toFixed(2)}s`,
      "controls: B boots · WASD walk/thrust · mouse look · Space jump/grab · C cam · R reset",
    ];

    const text = lines.join("\n");
    if (text !== this.lastText) {
      this.info.textContent = text;
      this.lastText = text;
    }

    this.setWin(state.goalReached);
  }

  setWin(won: boolean): void {
    if (won === this.lastWon) return;
    this.lastWon = won;
    // Class hook for page-level CSS; inline display makes it self-contained.
    this.root.classList.toggle("won", won);
    this.banner.style.display = won ? "inline-block" : "none";
  }

  dispose(): void {
    this.info.remove();
    this.banner.remove();
    this.root.classList.remove("won");
  }
}

function fmtVec(v: readonly [number, number, number]): string {
  return `[${v[0].toFixed(2)}, ${v[1].toFixed(2)}, ${v[2].toFixed(2)}]`;
}

function distance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function magnitude(v: readonly [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/** `root` is the #hud overlay div from index.html. */
export function createHud(root: HTMLElement): Hud {
  return new HudImpl(root);
}
