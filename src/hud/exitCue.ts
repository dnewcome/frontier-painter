// src/hud/exitCue.ts
// "Where do I go now?" cues once a room is clear:
//   - a big ROOM CLEAR flash the moment the last surface is repaired;
//   - an EXIT marker floating over the open door while it's on screen;
//   - an arrow pinned to the screen edge pointing at the door while it's off
//     screen or behind you.
// Plain DOM, updated per rendered frame; visual only (never touches the sim).
import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { GameState, Vec3 } from "../types";

const CSS = `
#exit-cue { position: fixed; inset: 0; z-index: 30; pointer-events: none;
  font-family: system-ui, -apple-system, sans-serif; color: #eafff1; }
#exit-cue .flash { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%) scale(0.9);
  text-align: center; opacity: 0; transition: opacity 0.35s, transform 0.35s; }
#exit-cue .flash.on { opacity: 1; transform: translate(-50%, -50%) scale(1); }
#exit-cue .flash b { display: block; font: 800 clamp(28px, 6vw, 56px)/1 ui-monospace, Menlo, monospace;
  letter-spacing: 0.12em; color: #4fe08a; text-shadow: 0 0 24px rgba(79,224,138,0.7), 0 2px 0 #03150a; }
#exit-cue .flash span { display: block; margin-top: 10px; font-size: clamp(13px, 2vw, 17px);
  font-weight: 600; text-shadow: 0 1px 3px #000; }
#exit-cue .mark { position: absolute; transform: translate(-50%, -100%); display: none;
  flex-direction: column; align-items: center; gap: 2px; }
#exit-cue .mark .pill { padding: 4px 10px; border-radius: 999px; background: rgba(8,40,20,0.85);
  box-shadow: 0 0 0 2px #4fe08a, 0 0 16px rgba(79,224,138,0.6); font: 700 13px/1.1 ui-monospace, Menlo, monospace;
  letter-spacing: 0.08em; white-space: nowrap; }
#exit-cue .mark .chev { font-size: 22px; line-height: 1; color: #4fe08a; animation: exit-bob 0.9s ease-in-out infinite; }
@keyframes exit-bob { 50% { transform: translateY(6px); } }
#exit-cue .edge { position: absolute; width: 0; height: 0; display: none; }
#exit-cue .edge i { position: absolute; left: -22px; top: -22px; width: 44px; height: 44px; border-radius: 50%;
  background: rgba(8,40,20,0.85); box-shadow: 0 0 0 2px #4fe08a, 0 0 16px rgba(79,224,138,0.6);
  display: flex; align-items: center; justify-content: center; font-style: normal; font-size: 22px; color: #4fe08a; }
`;

export interface ExitCueDeps {
  scene: Scene;
  getState: () => GameState;
  project: (p: Vec3) => [number, number] | null;
}

const FLASH_MS = 2600;
/** Keep the edge arrow this far (CSS px) inside the screen edge. */
const EDGE_PAD = 44;

export function createExitCue(deps: ExitCueDeps): void {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.id = "exit-cue";
  root.innerHTML =
    '<div class="flash"><b>ROOM CLEAR</b><span>The exit door is open — head for the green light</span></div>' +
    '<div class="mark"><div class="pill">EXIT</div><div class="chev">▼</div></div>' +
    '<div class="edge"><i>➜</i></div>';
  document.body.appendChild(root);
  const flash = root.querySelector(".flash") as HTMLDivElement;
  const mark = root.querySelector(".mark") as HTMLDivElement;
  const pill = root.querySelector(".pill") as HTMLDivElement;
  const edge = root.querySelector(".edge") as HTMLDivElement;
  const edgeIcon = edge.querySelector("i") as HTMLElement;

  let wasClear: boolean | null = null;
  let flashTimer = 0;
  const view = new Vector3();

  deps.scene.onBeforeRenderObservable.add(() => {
    const s = deps.getState();
    const clear = s.doorOpen && !s.roomCleared && s.paintSurfaces.length > 0;

    if (clear !== wasClear) {
      // Flash on the rising edge only (not when a page loads already clear).
      if (clear && wasClear === false) {
        flash.classList.add("on");
        window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => flash.classList.remove("on"), FLASH_MS);
      }
      if (!clear) flash.classList.remove("on");
      wasClear = clear;
    }
    if (!clear) {
      mark.style.display = "none";
      edge.style.display = "none";
      return;
    }

    const W = window.innerWidth;
    const H = window.innerHeight;
    const a = s.exitAnchor;
    const dist = Math.hypot(a[0] - s.playerPos[0], a[1] - s.playerPos[1], a[2] - s.playerPos[2]);
    const flashing = flash.classList.contains("on");
    const p = deps.project(a);
    if (flashing && p && p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H) {
      // The ROOM CLEAR flash already says it; don't stack the marker on it.
      mark.style.display = "none";
      edge.style.display = "none";
      return;
    }
    if (p && p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H) {
      mark.style.display = "flex";
      edge.style.display = "none";
      mark.style.left = `${p[0]}px`;
      // Float above the doorway center, clamped so it never leaves the top.
      mark.style.top = `${Math.max(64, p[1] - 70)}px`;
      pill.textContent = `EXIT · ${Math.round(dist)} m`;
      return;
    }

    // Off screen / behind: direction to the door in camera space (LH: +x
    // right, +y up, +z forward); behind the camera the x/y still say which
    // way to turn.
    const cam = deps.scene.activeCamera;
    if (!cam) return;
    Vector3.TransformCoordinatesToRef(new Vector3(a[0], a[1], a[2]), cam.getViewMatrix(), view);
    let dx = view.x;
    let dy = -view.y;
    if (Math.hypot(dx, dy) < 1e-4) {
      dx = 0;
      dy = 1;
    }
    // Project the direction from screen center onto the padded screen rect.
    const cx = W / 2;
    const cy = H / 2;
    const k = Math.min((cx - EDGE_PAD) / Math.abs(dx || 1e-6), (cy - EDGE_PAD) / Math.abs(dy || 1e-6));
    edge.style.display = "block";
    mark.style.display = "none";
    edge.style.left = `${cx + dx * k}px`;
    edge.style.top = `${cy + dy * k}px`;
    edgeIcon.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  });
}
