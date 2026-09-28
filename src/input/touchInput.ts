// src/input/touchInput.ts
// On-screen twin-stick UI for phones/tablets. Drives the SAME HumanControls as
// the keyboard + mouse (humanInput.ts), so movement / look / boots / paint rules
// live in one place:
//
//   left thumb   floating joystick  -> thrust (floating) / walk (boots) /
//                                       pull along a grabbed handhold
//   right thumb  drag               -> look (finger up -> look up)
//   tap          a broken surface   -> paint it with the selected property
//   buttons      palette (top-left) · BOOTS + GRAB/JUMP (bottom-right) ·
//                menu (top-right: next room, reset, camera, gyro look)
//
// Pure UI + input: it perturbs the sim only through HumanControls (fixed-step
// intent + one-shot verbs), never on the scripted window.game path.
import type { Scene } from "@babylonjs/core/scene";
import type { HumanControls, PaintResult } from "./humanInput";
import { PAINT_PALETTE, type GameState, type PaintProperty } from "../types";

export interface TouchInputDeps {
  scene: Scene;
  controls: HumanControls;
  getState: () => GameState;
  selectColor: (color: PaintProperty) => void;
  cycleScenario: () => void;
  reset: () => void;
}

/** Finger travel (CSS px) for full stick deflection. */
const STICK_RADIUS = 56;
const DEAD_ZONE = 0.12;
/** Look sensitivity for a finger drag (rad per CSS px). */
const LOOK_SENS = 0.0045;
/** A touch shorter + stiller than this is a TAP (paint), not a drag. */
const TAP_MAX_MS = 280;
const TAP_MAX_PX = 12;
/** Touches starting in this left fraction of the screen drive the joystick. */
const STICK_ZONE = 0.42;
const DEG = Math.PI / 180;

const SWATCH: Record<PaintProperty, { hex: string; label: string }> = {
  cold: { hex: "#8cd9ff", label: "COLD" },
  conductive: { hex: "#ffa829", label: "CONDUCT" },
  magnetic: { hex: "#b86bff", label: "MAGNET" },
};

const CSS = `
#touch-ui, #touch-ui * { -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
#touch-ui { position: fixed; inset: 0; z-index: 15; pointer-events: none;
  font: 600 12px/1.2 system-ui, -apple-system, sans-serif; color: #e6f4ff; }
#touch-ui .t-layer { position: absolute; inset: 0; pointer-events: auto; touch-action: none; }
#touch-ui button { pointer-events: auto; touch-action: none; border: 0; font: inherit; color: inherit; }
.t-stick-base, .t-stick-knob { position: absolute; border-radius: 50%; pointer-events: none; }
.t-stick-base { width: ${STICK_RADIUS * 2 + 24}px; height: ${STICK_RADIUS * 2 + 24}px;
  margin: -${STICK_RADIUS + 12}px 0 0 -${STICK_RADIUS + 12}px;
  border: 2px solid rgba(207,232,255,0.35); background: rgba(10,20,40,0.25); }
.t-stick-knob { width: 56px; height: 56px; margin: -28px 0 0 -28px;
  background: rgba(207,232,255,0.55); box-shadow: 0 0 16px rgba(140,217,255,0.5); }
.t-stick-base.idle { opacity: 0.45; }
.t-palette { position: absolute; top: max(10px, env(safe-area-inset-top));
  left: max(12px, env(safe-area-inset-left)); display: flex; gap: 10px; }
.t-swatch { width: 52px; height: 52px; border-radius: 50%; position: relative;
  background: rgba(8,14,28,0.55); box-shadow: inset 0 0 0 2px rgba(255,255,255,0.12); }
.t-swatch .dot { position: absolute; inset: 9px; border-radius: 50%; }
.t-swatch .lbl { position: absolute; left: 50%; top: 100%; transform: translateX(-50%);
  margin-top: 3px; font-size: 9px; letter-spacing: 0.06em; opacity: 0.75; white-space: nowrap; }
.t-swatch.sel { box-shadow: 0 0 0 3px #fff, 0 0 18px rgba(255,255,255,0.35); }
.t-swatch.sel .lbl { opacity: 1; }
.t-actions { position: absolute; right: max(14px, env(safe-area-inset-right));
  bottom: max(14px, env(safe-area-inset-bottom)); display: flex; gap: 12px; align-items: flex-end; }
.t-btn { width: 72px; height: 72px; border-radius: 50%; background: rgba(8,14,28,0.6);
  box-shadow: inset 0 0 0 2px rgba(207,232,255,0.3); font-size: 11px; letter-spacing: 0.05em; }
.t-btn.big { width: 88px; height: 88px; font-size: 13px; }
.t-btn.on { background: rgba(140,217,255,0.28); box-shadow: inset 0 0 0 2px #8cd9ff, 0 0 18px rgba(140,217,255,0.4); }
.t-btn:active, .t-swatch:active { transform: scale(0.94); }
.t-menu-btn { position: absolute; top: max(10px, env(safe-area-inset-top));
  right: max(12px, env(safe-area-inset-right)); width: 44px; height: 44px; border-radius: 12px;
  background: rgba(8,14,28,0.55); font-size: 20px; }
.t-menu { position: absolute; top: calc(max(10px, env(safe-area-inset-top)) + 52px);
  right: max(12px, env(safe-area-inset-right)); display: none; flex-direction: column; gap: 6px;
  padding: 10px; border-radius: 14px; background: rgba(6,12,24,0.88); min-width: 190px; pointer-events: auto; }
.t-menu.open { display: flex; }
.t-menu button { text-align: left; padding: 11px 12px; border-radius: 9px; background: rgba(255,255,255,0.06); font-size: 13px; }
.t-menu .tip { font-weight: 400; font-size: 11px; opacity: 0.65; padding: 4px 2px 0; max-width: 200px; }
.t-toast { position: absolute; left: 50%; top: calc(max(10px, env(safe-area-inset-top)) + 96px);
  transform: translateX(-50%); padding: 8px 14px; border-radius: 999px; font-size: 13px;
  background: rgba(6,12,24,0.8); opacity: 0; transition: opacity 0.18s; white-space: nowrap; }
.t-toast.show { opacity: 1; }
.t-toast.good { box-shadow: inset 0 0 0 2px #4fe08a; }
.t-toast.bad { box-shadow: inset 0 0 0 2px #ff5a5a; }
.t-toast.warn { box-shadow: inset 0 0 0 2px #ffc04d; }
.t-card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  display: none; flex-direction: column; align-items: center; gap: 12px; padding: 22px 26px;
  border-radius: 18px; background: rgba(6,12,24,0.9); pointer-events: auto; text-align: center; max-width: 86vw; }
.t-card.show { display: flex; }
.t-card h2 { margin: 0; font-size: 20px; letter-spacing: 0.08em; }
.t-card p { margin: 0; font-weight: 400; font-size: 13px; line-height: 1.45; opacity: 0.85; }
.t-card .row { display: flex; gap: 10px; }
.t-card button { padding: 12px 18px; border-radius: 10px; background: rgba(140,217,255,0.2);
  box-shadow: inset 0 0 0 2px rgba(140,217,255,0.6); font-size: 14px; }
.t-card.win h2 { color: #4fe08a; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** Fire on the earliest touch (pointerdown) for snappy game buttons. */
function onPress(b: HTMLElement, fn: () => void): void {
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  });
}

/** Screen rotation in degrees (0/90/180/270). iOS window.orientation is the
 *  well-documented source (90 = rotated counter-clockwise); fall back to the
 *  standard Screen Orientation API elsewhere. */
function orientationAngle(): number {
  const wo = (window as unknown as { orientation?: number }).orientation;
  const a = typeof wo === "number" ? wo : (screen.orientation?.angle ?? 0);
  return ((a % 360) + 360) % 360;
}

export function createTouchInput(deps: TouchInputDeps): void {
  const { scene, controls, getState } = deps;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = el("div", "", document.body);
  root.id = "touch-ui";
  const layer = el("div", "t-layer", root);

  // ---- joystick visuals ----------------------------------------------------
  const base = el("div", "t-stick-base idle", root);
  const knob = el("div", "t-stick-knob", root);
  const idlePos = (): [number, number] => [
    Math.max(24, window.innerWidth * 0.06) + STICK_RADIUS + 12,
    window.innerHeight - (STICK_RADIUS + 34),
  ];
  const placeStick = (bx: number, by: number, kx: number, ky: number): void => {
    base.style.left = `${bx}px`;
    base.style.top = `${by}px`;
    knob.style.left = `${kx}px`;
    knob.style.top = `${ky}px`;
  };
  const showIdleStick = (): void => {
    const [x, y] = idlePos();
    base.classList.add("idle");
    placeStick(x, y, x, y);
  };
  showIdleStick();
  window.addEventListener("resize", () => {
    if (stickId === null) showIdleStick();
  });

  // ---- toast ---------------------------------------------------------------
  const toast = el("div", "t-toast", root);
  let toastTimer = 0;
  const say = (msg: string, kind: "good" | "bad" | "warn" | "" = ""): void => {
    toast.textContent = msg;
    toast.className = `t-toast show ${kind}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1500);
  };
  const buzz = (pattern: number | number[]): void => {
    // Android vibrates; iOS Safari ignores this (native haptics come with the
    // Capacitor build).
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported */
    }
  };

  const labelOf = (id: string | null): string => {
    if (!id) return "";
    return getState().paintSurfaces.find((s) => s.id === id)?.label ?? id;
  };

  const onTap = (x: number, y: number): void => {
    const r: PaintResult = controls.paintAtScreen(x, y);
    switch (r.outcome) {
      case "repaired":
        say(`Repaired: ${labelOf(r.id)}`, "good");
        buzz(18);
        break;
      case "wrong":
        say("Rejected — wrong property", "bad");
        buzz([10, 40, 10]);
        break;
      case "locked":
        say("Locked — something's in the way", "warn");
        buzz([10, 40, 10]);
        break;
      case "far":
        say("Too far — get closer", "warn");
        break;
      case "miss":
        break; // tapping empty space is fine — no nagging
    }
  };

  // ---- gestures: joystick (left) + look (right) + tap-to-paint -------------
  interface Track {
    role: "stick" | "look";
    x0: number;
    y0: number;
    x: number;
    y: number;
    t0: number;
    moved: number;
  }
  const tracks = new Map<number, Track>();
  let stickId: number | null = null;

  const updateStick = (t: Track): void => {
    const vx = t.x - t.x0;
    const vy = t.y - t.y0;
    const len = Math.hypot(vx, vy);
    const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
    placeStick(t.x0, t.y0, t.x0 + vx * k, t.y0 + vy * k);
    const mag = Math.min(1, len / STICK_RADIUS);
    if (mag < DEAD_ZONE || len < 1e-6) {
      controls.setStick(0, 0);
      return;
    }
    const scaled = (mag - DEAD_ZONE) / (1 - DEAD_ZONE);
    // Screen y grows downward; pushing the stick UP means forward.
    controls.setStick((vx / len) * scaled, (-vy / len) * scaled);
  };

  layer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    layer.setPointerCapture?.(e.pointerId);
    const inStickZone = e.clientX < window.innerWidth * STICK_ZONE;
    const role: Track["role"] = inStickZone && stickId === null ? "stick" : "look";
    const t: Track = {
      role,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      t0: e.timeStamp,
      moved: 0,
    };
    tracks.set(e.pointerId, t);
    if (role === "stick") {
      stickId = e.pointerId;
      base.classList.remove("idle");
      placeStick(t.x0, t.y0, t.x0, t.y0);
    }
  });

  layer.addEventListener("pointermove", (e) => {
    const t = tracks.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    t.x = e.clientX;
    t.y = e.clientY;
    t.moved = Math.max(t.moved, Math.hypot(t.x - t.x0, t.y - t.y0));
    if (t.role === "stick") updateStick(t);
    else controls.lookRadians(dx * LOOK_SENS, -dy * LOOK_SENS); // finger up -> look up
  });

  const endTrack = (e: PointerEvent, isCancel: boolean): void => {
    const t = tracks.get(e.pointerId);
    if (!t) return;
    tracks.delete(e.pointerId);
    if (t.role === "stick") {
      stickId = null;
      controls.setStick(0, 0);
      showIdleStick();
    }
    const quick = e.timeStamp - t.t0 <= TAP_MAX_MS;
    if (!isCancel && quick && t.moved <= TAP_MAX_PX) onTap(e.clientX, e.clientY);
  };
  layer.addEventListener("pointerup", (e) => endTrack(e, false));
  layer.addEventListener("pointercancel", (e) => endTrack(e, true));

  // Kill iOS scroll / rubber-band / pinch-zoom / magnifier on the play surface.
  // (touch-action:none covers most browsers; iOS also needs the touch + gesture
  // events cancelled, and it ignores user-scalable=no.)
  const block = (e: Event): void => e.preventDefault();
  layer.addEventListener("touchstart", block, { passive: false });
  layer.addEventListener("touchmove", block, { passive: false });
  document.addEventListener("gesturestart", block, { passive: false });

  // ---- palette -------------------------------------------------------------
  const palette = el("div", "t-palette", root);
  const swatches = new Map<PaintProperty, HTMLButtonElement>();
  for (const c of PAINT_PALETTE) {
    const b = el("button", "t-swatch", palette);
    b.setAttribute("aria-label", `Brush: ${c}`);
    b.dataset.color = c;
    const dot = el("span", "dot", b);
    dot.style.background = SWATCH[c].hex;
    dot.style.boxShadow = `0 0 12px ${SWATCH[c].hex}`;
    el("span", "lbl", b, SWATCH[c].label);
    onPress(b, () => deps.selectColor(c));
    swatches.set(c, b);
  }

  // ---- action buttons ------------------------------------------------------
  const actions = el("div", "t-actions", root);
  const bootsBtn = el("button", "t-btn", actions, "BOOTS");
  bootsBtn.dataset.role = "boots";
  const actionBtn = el("button", "t-btn big", actions, "GRAB");
  actionBtn.dataset.role = "action";
  onPress(bootsBtn, () => controls.toggleBoots());
  onPress(actionBtn, () => controls.action());

  // ---- menu ----------------------------------------------------------------
  const menuBtn = el("button", "t-menu-btn", root, "☰");
  menuBtn.setAttribute("aria-label", "Menu");
  const menu = el("div", "t-menu", root);
  const mNext = el("button", "", menu, "▶  Next room");
  const mReset = el("button", "", menu, "↺  Restart room");
  const mCam = el("button", "", menu, "🎥  Camera: first-person");
  const mGyro = el("button", "", menu, "🧭  Gyro look: off");
  el(
    "div",
    "tip",
    menu,
    "Tip: Share → Add to Home Screen to play fullscreen.",
  );
  // Menu items use `click` (fires after touchend, which carries the user
  // activation iOS requires for the motion-permission prompt).
  menuBtn.addEventListener("click", () => menu.classList.toggle("open"));
  const closeMenu = (): void => menu.classList.remove("open");
  mNext.addEventListener("click", () => {
    deps.cycleScenario();
    closeMenu();
  });
  mReset.addEventListener("click", () => {
    deps.reset();
    closeMenu();
  });
  mCam.addEventListener("click", () => {
    controls.toggleCamera();
    closeMenu();
  });

  // ---- gyro look (optional) -------------------------------------------------
  let gyroOn = false;
  let lastMotionT = 0;
  const onMotion = (e: DeviceMotionEvent): void => {
    const rr = e.rotationRate;
    if (!rr) return;
    const t = e.timeStamp;
    const dt = lastMotionT ? Math.min(0.1, Math.max(0, (t - lastMotionT) / 1000)) : 0;
    lastMotionT = t;
    if (dt === 0) return;
    // rotationRate is deg/s about the DEVICE axes (beta: x, gamma: y). Map to
    // yaw-right / pitch-up about the SCREEN axes for the current rotation.
    const b = (rr.beta ?? 0) * DEG;
    const g = (rr.gamma ?? 0) * DEG;
    let yawRight = 0;
    let pitchUp = 0;
    switch (orientationAngle()) {
      case 90: // landscape, top of phone pointing LEFT
        yawRight = -b;
        pitchUp = -g;
        break;
      case 270: // landscape, top of phone pointing RIGHT
        yawRight = b;
        pitchUp = g;
        break;
      case 180:
        yawRight = g;
        pitchUp = -b;
        break;
      default: // portrait
        yawRight = -g;
        pitchUp = b;
    }
    controls.lookRadians(yawRight * dt, pitchUp * dt);
  };
  const setGyro = (on: boolean): void => {
    gyroOn = on;
    lastMotionT = 0;
    if (on) window.addEventListener("devicemotion", onMotion);
    else window.removeEventListener("devicemotion", onMotion);
    mGyro.textContent = `🧭  Gyro look: ${on ? "on" : "off"}`;
  };
  mGyro.addEventListener("click", () => {
    if (gyroOn) {
      setGyro(false);
      return;
    }
    if (!window.isSecureContext) {
      say("Gyro needs HTTPS", "warn");
      return;
    }
    const DME = window.DeviceMotionEvent as unknown as
      | { requestPermission?: () => Promise<string> }
      | undefined;
    if (typeof DME?.requestPermission === "function") {
      DME.requestPermission()
        .then((r) => (r === "granted" ? setGyro(true) : say("Motion access denied", "bad")))
        .catch(() => say("Motion access denied", "bad"));
    } else {
      setGyro(true);
    }
    closeMenu();
  });

  // ---- win card ------------------------------------------------------------
  const win = el("div", "t-card win", root);
  el("h2", "", win, "CONSOLE ONLINE");
  el("p", "", win, "The ship's reality holds — for now.");
  const winRow = el("div", "row", win);
  const wNext = el("button", "", winRow, "Next room ▶");
  const wAgain = el("button", "", winRow, "Replay");
  wNext.addEventListener("click", () => deps.cycleScenario());
  wAgain.addEventListener("click", () => deps.reset());

  // ---- first-run how-to ----------------------------------------------------
  const intro = el("div", "t-card show", root);
  el("h2", "", intro, "FRONTIER PAINTER");
  el(
    "p",
    "",
    intro,
    "The ship's software is failing and reality is glitching out. " +
      "Read each broken surface's symptom, pick the property that fixes it, " +
      "and tap the surface to paint it.",
  );
  el(
    "p",
    "",
    intro,
    "Left thumb: move · Right thumb: look · BOOTS: walk on any surface · GRAB: hold a rail",
  );
  const introGo = el("button", "", el("div", "row", intro), "Start");
  let seen = false;
  try {
    seen = localStorage.getItem("fp_intro_seen") === "1";
  } catch {
    /* storage unavailable (private mode) — just show it */
  }
  if (seen) intro.classList.remove("show");
  introGo.addEventListener("click", () => {
    intro.classList.remove("show");
    try {
      localStorage.setItem("fp_intro_seen", "1");
    } catch {
      /* ignore */
    }
  });

  // ---- per-frame state sync (cheap: only touches the DOM on change) --------
  let lastSel = "";
  let lastBoots: boolean | null = null;
  let lastAction = "";
  let lastWin: boolean | null = null;
  let lastArmed: boolean | null = null;
  let frame = 0;
  scene.onBeforeRenderObservable.add(() => {
    if (++frame % 3 !== 0) return;
    const s = getState();
    if (s.selectedColor !== lastSel) {
      lastSel = s.selectedColor;
      for (const [c, b] of swatches) b.classList.toggle("sel", c === s.selectedColor);
    }
    const armed = s.paintSurfaces.length > 0;
    if (armed !== lastArmed) {
      lastArmed = armed;
      palette.style.display = armed ? "flex" : "none";
    }
    if (s.booted !== lastBoots) {
      lastBoots = s.booted;
      bootsBtn.classList.toggle("on", s.booted);
      bootsBtn.textContent = s.booted ? "BOOTS ON" : "BOOTS";
    }
    const act = s.booted ? "JUMP" : s.grabbing ? "RELEASE" : "GRAB";
    if (act !== lastAction) {
      lastAction = act;
      actionBtn.textContent = act;
      actionBtn.classList.toggle("on", s.grabbing);
    }
    if (s.goalReached !== lastWin) {
      lastWin = s.goalReached;
      win.classList.toggle("show", s.goalReached);
      if (s.goalReached) toast.classList.remove("show"); // the card says it all
    }
  });
}
