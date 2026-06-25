import { defineConfig } from "@playwright/test";

// Playwright config. Tests run against the built output via `vite preview`
// for stability. Software WebGL is forced so headless Chromium can create a
// WebGL context for Babylon.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  reporter: "list",
  use: {
    headless: true,
    baseURL: "http://localhost:4173",
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
      ],
    },
  },
  webServer: {
    command: "npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
