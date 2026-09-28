import { defineConfig } from "vite";

// VITE_BASE lets the same build serve from a sub-path — e.g. GitHub Pages
// project sites live at /<repo>/ (set in .github/workflows/pages.yml). Local dev,
// preview, tests, and playthroughs keep the root base.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    include: ["@babylonjs/core"],
  },
});
