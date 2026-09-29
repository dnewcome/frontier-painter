// src/input/paintTrace.ts
// The paint gesture. Walking up to a broken surface puts a PAINT marker over
// it; pressing PAINT (touch button / Space / F) opens this overlay, which shows
// the selected property's glyph (paint/glyphs.ts) over the surface as a dotted
// guide. Trace it from the glowing start dot to the end with a finger or the
// mouse: straying too far off the line resets the stroke; finishing it applies
// the paint (still subject to "right property, right place").
//
// Pure UI (pointer events + SVG); the sim is touched only through the
// onTraced callback, never on the scripted window.game path.
import type { PaintProperty } from "../types";
import { glyphFor, type Pt } from "../paint/glyphs";
import { feel } from "./haptics";

export type TraceOutcome = "repaired" | "wrong" | "locked";

export interface PaintTrace {
  /** Open the overlay for `prop`, centered near screen point `at` (CSS px).
   *  `onTraced` runs once the stroke is complete and returns the outcome. */
  open(prop: PaintProperty, label: string, at: [number, number] | null, onTraced: () => TraceOutcome): void;
  isOpen(): boolean;
  close(): void;
  /** Per frame: the in-range target to mark ("PAINT ▼"), or null. */
  setTarget(target: { label: string; screen: [number, number] | null } | null): void;
}

const COLOR: Record<PaintProperty, string> = {
  cold: "#8cd9ff",
  conductive: "#ffa829",
  magnetic: "#b86bff",
};
const SAMPLES = 64;
/** Progress may only advance this many samples per move (no shortcutting
 *  across the spiral's rings or the bolt's corners). */
const LOOKAHEAD = 7;

const CSS = `
#paint-trace { position: fixed; inset: 0; z-index: 40; display: none; touch-action: none;
  -webkit-user-select: none; user-select: none; font-family: system-ui, -apple-system, sans-serif;
  color: #eef6ff; background: rgba(3,6,12,0.28); }
#paint-trace.open { display: block; }
body.tracing #hud, body.tracing #exit-cue { visibility: hidden; }
#paint-trace svg { position: absolute; inset: 0; width: 100%; height: 100%; }
#paint-trace .head { position: absolute; left: 50%; top: max(12px, env(safe-area-inset-top)); transform: translateX(-50%);
  padding: 8px 16px; border-radius: 999px; background: rgba(6,12,24,0.85); font-weight: 700; font-size: 14px;
  letter-spacing: 0.04em; white-space: nowrap; }
#paint-trace .head b { letter-spacing: 0.1em; }
#paint-trace .cancel { position: absolute; right: max(14px, env(safe-area-inset-right)); top: max(10px, env(safe-area-inset-top));
  width: 44px; height: 44px; border: 0; border-radius: 12px; background: rgba(6,12,24,0.85); color: inherit; font-size: 20px; }
#paint-trace .msg { position: absolute; left: 50%; bottom: max(18px, env(safe-area-inset-bottom)); transform: translateX(-50%);
  padding: 8px 16px; border-radius: 999px; background: rgba(6,12,24,0.85); font-size: 14px; font-weight: 600; white-space: nowrap; }
#paint-trace .msg.good { box-shadow: inset 0 0 0 2px #4fe08a; }
#paint-trace .msg.bad { box-shadow: inset 0 0 0 2px #ff5a5a; }
#paint-trace .msg.warn { box-shadow: inset 0 0 0 2px #ffc04d; }
@keyframes pt-pulse { 50% { r: 22px; opacity: 0.55; } }
#paint-trace .start { animation: pt-pulse 1s ease-in-out infinite; }
#paint-mark { position: fixed; z-index: 25; pointer-events: none; transform: translate(-50%, -100%); display: none;
  flex-direction: column; align-items: center; font-family: system-ui, -apple-system, sans-serif; }
#paint-mark .pill { padding: 4px 10px; border-radius: 999px; background: rgba(24,18,4,0.85); color: #fff3d6;
  box-shadow: 0 0 0 2px #ffc04d, 0 0 14px rgba(255,192,77,0.55); font: 700 12px/1.1 ui-monospace, Menlo, monospace;
  letter-spacing: 0.06em; white-space: nowrap; }
#paint-mark .chev { color: #ffc04d; font-size: 18px; line-height: 1; animation: pm-bob 0.9s ease-in-out infinite; }
@keyframes pm-bob { 50% { transform: translateY(5px); } }
`;

const SVGNS = "http://www.w3.org/2000/svg";
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, parent: Element): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVGNS, tag);
  parent.appendChild(e);
  return e;
};
const ptsAttr = (pts: Pt[]): string => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

export interface TraceSound {
  start(): void;
  /** Stroke progress 0..1, or null to silence the tone. */
  progress(p: number | null): void;
  reset(): void;
}

export function createPaintTrace(opts: { keyHint?: string; sound?: TraceSound } = {}): PaintTrace {
  const snd = opts.sound;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "paint-trace";
  document.body.appendChild(root);
  const svg = svgEl("svg", root);
  const guide = svgEl("polyline", svg);
  const done = svgEl("polyline", svg);
  const trail = svgEl("polyline", svg);
  const endDot = svgEl("circle", svg);
  const startDot = svgEl("circle", svg);
  startDot.setAttribute("class", "start");
  for (const p of [guide, done, trail]) {
    p.setAttribute("fill", "none");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
  }
  trail.setAttribute("stroke", "rgba(255,255,255,0.85)");
  trail.setAttribute("stroke-width", "4");
  const head = document.createElement("div");
  head.className = "head";
  const cancel = document.createElement("button");
  cancel.className = "cancel";
  cancel.textContent = "✕";
  cancel.setAttribute("aria-label", "Cancel painting");
  const msg = document.createElement("div");
  msg.className = "msg";
  root.append(head, cancel, msg);

  const mark = document.createElement("div");
  mark.id = "paint-mark";
  mark.innerHTML = '<div class="pill"></div><div class="chev">▼</div>';
  document.body.appendChild(mark);
  const markPill = mark.querySelector(".pill") as HTMLDivElement;

  let open = false;
  let finishing = false;
  let S: Pt[] = [];
  let tol = 30;
  let progress = 0;
  let tracing: number | null = null;
  let trailPts: Pt[] = [];
  let onTraced: (() => TraceOutcome) | null = null;
  let closeTimer = 0;

  const say = (text: string, kind: "" | "good" | "bad" | "warn" = ""): void => {
    msg.textContent = text;
    msg.className = `msg ${kind}`;
  };
  const drawProgress = (): void => {
    done.setAttribute("points", ptsAttr(S.slice(0, progress + 1)));
    trail.setAttribute("points", ptsAttr(trailPts));
  };
  const resetStroke = (why: string): void => {
    snd?.progress(null);
    snd?.reset();
    tracing = null;
    progress = 0;
    trailPts = [];
    drawProgress();
    say(why, "warn");
    feel("warning");
  };

  const close = (): void => {
    snd?.progress(null);
    open = false;
    finishing = false;
    tracing = null;
    onTraced = null;
    window.clearTimeout(closeTimer);
    root.classList.remove("open");
    document.body.classList.remove("tracing");
  };

  const finish = (): void => {
    snd?.progress(null);
    finishing = true;
    tracing = null;
    const outcome = onTraced?.() ?? "wrong";
    if (outcome === "repaired") {
      say("Repaired!", "good");
      feel("success");
    } else if (outcome === "locked") {
      say("Locked — something's in the way", "warn");
      feel("warning");
    } else {
      say("Rejected — wrong property", "bad");
      feel("error");
    }
    closeTimer = window.setTimeout(close, 1000);
  };

  root.addEventListener("pointerdown", (e) => {
    if (!open || finishing || e.target === cancel) return;
    e.preventDefault();
    const d = Math.hypot(e.clientX - S[0][0], e.clientY - S[0][1]);
    if (d > tol * 1.4) {
      say("Start at the glowing dot");
      return;
    }
    tracing = e.pointerId;
    root.setPointerCapture?.(e.pointerId);
    progress = 0;
    trailPts = [[e.clientX, e.clientY]];
    say("Follow the line");
    snd?.start();
    snd?.progress(0);
    drawProgress();
  });
  root.addEventListener("pointermove", (e) => {
    if (tracing !== e.pointerId || finishing) return;
    e.preventDefault();
    const p: Pt = [e.clientX, e.clientY];
    trailPts.push(p);
    let best = -1;
    let bestD = Infinity;
    const lo = Math.max(0, progress - 3);
    const hi = Math.min(S.length - 1, progress + LOOKAHEAD);
    for (let i = lo; i <= hi; i++) {
      const d = Math.hypot(p[0] - S[i][0], p[1] - S[i][1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > tol * 1.7) {
      resetStroke("Off the line — start again at the dot");
      return;
    }
    if (bestD <= tol && best > progress) {
      progress = best;
      snd?.progress(progress / (S.length - 1));
    }
    drawProgress();
    if (progress >= S.length - 2) finish();
  });
  const lift = (e: PointerEvent): void => {
    if (tracing !== e.pointerId || finishing) return;
    resetStroke("Keep your finger down — start again at the dot");
  };
  root.addEventListener("pointerup", lift);
  root.addEventListener("pointercancel", lift);
  cancel.addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (open && e.code === "Escape") close();
  });

  return {
    open(prop, label, at, cb) {
      if (open) return;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const half = Math.min(W, H) * 0.3;
      const cx = Math.max(half + 20, Math.min(W - half - 20, at ? at[0] : W / 2));
      const cy = Math.max(half + 60, Math.min(H - half - 50, at ? at[1] : H / 2));
      S = glyphFor(prop, SAMPLES).map(([x, y]) => [cx + x * half, cy + y * half]);
      tol = Math.max(26, half * 0.22);
      root.dataset.points = JSON.stringify(S.map((p) => [Math.round(p[0]), Math.round(p[1])]));
      const c = COLOR[prop];
      guide.setAttribute("points", ptsAttr(S));
      guide.setAttribute("stroke", c);
      guide.setAttribute("stroke-opacity", "0.4");
      guide.setAttribute("stroke-width", String(Math.round(tol * 0.9)));
      guide.setAttribute("stroke-dasharray", "2 14");
      done.setAttribute("stroke", c);
      done.setAttribute("stroke-width", String(Math.round(tol * 0.55)));
      startDot.setAttribute("cx", String(S[0][0]));
      startDot.setAttribute("cy", String(S[0][1]));
      startDot.setAttribute("r", "16");
      startDot.setAttribute("fill", c);
      const last = S[S.length - 1];
      endDot.setAttribute("cx", String(last[0]));
      endDot.setAttribute("cy", String(last[1]));
      endDot.setAttribute("r", "9");
      endDot.setAttribute("fill", "none");
      endDot.setAttribute("stroke", c);
      endDot.setAttribute("stroke-width", "3");
      head.innerHTML = `Trace <b style="color:${c}">${prop.toUpperCase()}</b> onto ${label}`;
      progress = 0;
      trailPts = [];
      drawProgress();
      say("Start at the glowing dot");
      onTraced = cb;
      open = true;
      finishing = false;
      root.classList.add("open");
      document.body.classList.add("tracing");
      mark.style.display = "none";
    },
    isOpen: () => open,
    close,
    setTarget(t) {
      const p = t?.screen;
      if (open || !t || !p || p[0] < 0 || p[1] < 0 || p[0] > window.innerWidth || p[1] > window.innerHeight) {
        mark.style.display = "none";
        return;
      }
      mark.style.display = "flex";
      mark.style.left = `${p[0]}px`;
      mark.style.top = `${Math.max(56, p[1] - 30)}px`;
      const text = `PAINT · ${t.label}${opts.keyHint ? `  [${opts.keyHint}]` : ""}`;
      if (markPill.textContent !== text) markPill.textContent = text;
    },
  };
}

