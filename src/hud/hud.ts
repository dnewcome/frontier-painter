// src/hud/hud.ts
// Plain DOM overlay (no Babylon GUI) rendered into the #hud element. Shows live
// state (grab flag, handhold count, distance-to-goal, controls hint) and a win
// banner. Stateless beyond DOM nodes + a tiny render cache; refreshed each frame
// from a GameState snapshot.
import { PAINT_PALETTE, type GameState } from "../types";
import { levelNumber, levelOf } from "../levels";
import type { ScenarioName } from "../paint/paintField";

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

export interface HudOptions {
  /** Phone layout: hide the debug readout and show a compact objective panel
   *  that describes each broken surface by its SYMPTOM (not the answer). */
  compact?: boolean;
}

class HudImpl implements Hud {
  private readonly root: HTMLElement;
  private readonly info: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly objective: HTMLDivElement | null = null;

  // Render caches: skip DOM writes when nothing visible changed.
  private lastText = "";
  private lastObjective = "";
  private lastWon: boolean | null = null;

  constructor(root: HTMLElement, opts: HudOptions = {}) {
    this.root = root;
    if (opts.compact) {
      root.classList.add("compact");
      this.objective = document.createElement("div");
      this.objective.className = "hud-objective";
      root.appendChild(this.objective);
    }

    this.info = document.createElement("div");
    this.info.className = "hud-info";

    this.banner = document.createElement("div");
    this.banner.className = "win-banner";
    this.banner.textContent = "CONSOLE ONLINE — EXIT DOOR OPEN";

    this.root.appendChild(this.info);
    this.root.appendChild(this.banner);

    // Hidden until the goal latches. Drives display inline so the banner works
    // even if the page-level CSS is absent.
    this.setWin(false);
  }

  update(state: GameState): void {
    if (this.objective) this.renderObjective(state);
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

    // Property-paint palette + repair checklist (only while a scenario is armed).
    const paintLines: string[] = [];
    if (state.paintSurfaces.length > 0) {
      const palette = PAINT_PALETTE.map((c) =>
        c === state.selectedColor ? `[${c}]` : ` ${c} `,
      ).join(" ");
      paintLines.push(`brush: ${palette}`);
      for (const s of state.paintSurfaces) {
        if (!s.available) {
          // Prerequisite unrepaired: don't reveal the required property yet.
          paintLines.push(`  ⊘ ${s.label} — LOCKED (blocked by another surface)`);
          continue;
        }
        const status = s.satisfied
          ? "repaired"
          : s.painted
            ? `painted ${s.painted}?`
            : "BROKEN";
        paintLines.push(`  ${s.satisfied ? "✓" : "✗"} ${s.label} — needs ${s.required} · ${status}`);
      }
      paintLines.push(
        state.goalReached
          ? "  console: ONLINE — exit door open, go through it"
          : state.paintComplete
            ? "  console: POWERED (get to it)"
            : "  console: locked (repair all surfaces)",
      );
    }

    const lvl = levelOf(state.scenario as ScenarioName);
    const lines = [
      lvl
        ? `FRONTIER PAINTER — ROOM ${levelNumber(lvl.id)}: ${lvl.title}`
        : "FRONTIER PAINTER",
      `ready: ${state.ready ? "yes" : "no"}   camera: ${state.cameraMode}`,
      `pos: ${fmtVec(p)}`,
      `vel: ${fmtVec(state.velocity)}  |v|=${speed.toFixed(2)} m/s`,
      grabLine,
      bootsLine,
      ...paintLines,
      `handholds: ${state.handholds.length}   ${goalLine}`,
      `elapsed: ${state.elapsed.toFixed(2)}s`,
      "controls: 1/2/3 color · F paint · B boots · WASD move · mouse look · Space grab/jump · R reset",
    ];

    const text = lines.join("\n");
    if (text !== this.lastText) {
      this.info.textContent = text;
      this.lastText = text;
    }

    this.setWin(state.goalReached);
  }

  /** Compact objective: surface name + symptom + status. Never shows the
   *  required property — diagnosing it is the puzzle. */
  private renderObjective(state: GameState): void {
    const obj = this.objective;
    if (!obj) return;
    let html = "";
    if (state.paintSurfaces.length > 0) {
      const lvl = levelOf(state.scenario as ScenarioName);
      if (lvl) {
        html += `<div class="obj-room">ROOM ${levelNumber(lvl.id)} · ${esc(lvl.title)}</div>`;
      }
      const title = state.goalReached
        ? "DOOR OPEN — GO THROUGH IT"
        : state.paintComplete
          ? "CONSOLE POWERED — GET TO IT"
          : "REPAIR THE SHIP";
      html += `<div class="obj-title${state.goalReached ? " go" : ""}">${title}</div>`;
      for (const s of state.paintSurfaces) {
        const cls = s.satisfied ? "ok" : s.available ? "bad" : "lock";
        const icon = s.satisfied ? "✓" : s.available ? "✗" : "🔒";
        const detail = s.satisfied
          ? "repaired"
          : s.available
            ? esc(s.symptom)
            : "blocked by another surface";
        html +=
          `<div class="obj-row ${cls}"><span class="ic">${icon}</span>` +
          `<b>${esc(s.label)}</b><span class="sym">${detail}</span></div>`;
      }
    }
    if (html !== this.lastObjective) {
      obj.innerHTML = html;
      this.lastObjective = html;
    }
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

function esc(t: string): string {
  return t.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
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
export function createHud(root: HTMLElement, opts: HudOptions = {}): Hud {
  return new HudImpl(root, opts);
}
