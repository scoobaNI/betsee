import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/ecosystem/tests",
  outputDir: "/tmp/betsee-f16-tests",
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "1920", use: { viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: {
    command: "VITE_BETSEE_MOCK=1 npm run dev:ecosystem",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
