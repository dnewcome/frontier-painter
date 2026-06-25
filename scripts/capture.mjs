// scripts/capture.mjs
// Placeholder for the deterministic video-capture pipeline (slice 1 scaffold).
// The real implementation will: launch headless chromium against `vite preview`,
// drive window.game.step(dt) in a loop, screenshot one frame per simulated step
// into the scratchpad, then assemble with ffmpeg
// (-framerate 60 -i frame_%05d.png -c:v libx264 -pix_fmt yuv420p out.mp4).
//
// It intentionally does nothing yet so `npm run capture:video` is a known no-op
// rather than a missing-file error.
console.log(
  "[capture] Not implemented in the scaffold. " +
    "Run the app via `npm run preview` and drive window.game.step() to record.",
);
