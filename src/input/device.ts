// src/input/device.ts
// Input-device detection. Touch mode swaps the desktop keyboard/mouse affordances
// (pointer-lock, crosshair, free-draw) for the on-screen twin-stick UI.
//
// Override with ?touch=1 / ?touch=0 (handy for testing the phone UI on desktop).

let cached: boolean | null = null;

export function isTouchDevice(): boolean {
  if (cached !== null) return cached;
  const q = new URLSearchParams(window.location.search).get("touch");
  if (q === "1") return (cached = true);
  if (q === "0") return (cached = false);
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  cached = coarse || (navigator.maxTouchPoints ?? 0) > 0;
  return cached;
}

/** Developer controls (room skip, camera toggle) are hidden unless the page is
 *  opened with ?debug=1. */
export function isDebug(): boolean {
  return new URLSearchParams(window.location.search).get("debug") === "1";
}
