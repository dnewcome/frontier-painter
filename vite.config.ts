import { defineConfig } from "vite";

// Vite config for slice 1. No special plugins needed for @babylonjs/core
// (no WASM in slice 1). optimizeDeps.include avoids dev pre-bundle churn.
export default defineConfig({
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
