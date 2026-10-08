import { defineConfig, devices } from "@playwright/test";

// Config for the deliberately broken demo suite (see broken.spec.ts). Offline; no .env needed.
export default defineConfig({
  testDir: ".",
  retries: 1,
  workers: 4,
  outputDir: "../../../test-results/broken-suite",
  reporter: [["list"], ["json", { outputFile: "results.json" }]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
});
