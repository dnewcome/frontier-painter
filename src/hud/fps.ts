// src/hud/fps.ts
// Small FPS / frame-time readout for the WEB build (hidden in the native iOS
// app, and with ?fps=0). Averaged over ~0.5 s so it's readable, not jittery.
import type { Engine } from "@babylonjs/core/Engines/engine";
import { Capacitor } from "@capacitor/core";

export function createFpsCounter(engine: Engine): void {
  if (Capacitor.isNativePlatform()) return;
  if (new URLSearchParams(window.location.search).get("fps") === "0") return;

  const el = document.createElement("div");
  el.id = "fps";
  el.style.cssText =
    "position:fixed;left:max(6px,env(safe-area-inset-left));bottom:max(4px,env(safe-area-inset-bottom));" +
    "z-index:12;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,0.45);color:#cfe8ff;" +
    "font:600 11px/1.3 ui-monospace,Menlo,monospace;pointer-events:none;white-space:nowrap";
  document.body.appendChild(el);

  let frames = 0;
  let acc = 0;
  let last = performance.now();
  const tick = (): void => {
    const now = performance.now();
    acc += now - last;
    last = now;
    frames++;
    if (acc >= 500) {
      const ms = acc / frames;
      const fps = 1000 / ms;
      el.textContent = `${Math.round(fps)} fps · ${ms.toFixed(1)} ms`;
      el.style.color = fps >= 50 ? "#9be7b0" : fps >= 30 ? "#ffd27a" : "#ff8f7a";
      frames = 0;
      acc = 0;
    }
  };
  engine.onEndFrameObservable.add(tick);
}
