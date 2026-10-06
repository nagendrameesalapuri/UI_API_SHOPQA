import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config();

const browserUse = {
  ...devices["Desktop Chrome"],
  // Open the browser maximized: null viewport lets the page fill the window.
  // deviceScaleFactor from the device preset is not allowed with a null viewport.
  viewport: null,
  deviceScaleFactor: undefined,
  launchOptions: {
    args: ["--start-maximized"],
  },
  contextOptions: {
    reducedMotion: "reduce" as const,
  },
};

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ["html", { outputFolder: "playwright-report" }],
    ["json", { outputFile: "test-results/results.json" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
    ["list"],
  ],

  expect: {
    timeout: 5000,
  },

  use: {
    headless: false,
    // UI application
    baseURL: process.env.UI_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10000,
  },

  projects: [
    {
      name: "chromium",
      testDir: "./tests/ui",
      use: browserUse,
    },

    // Cross-module, multi-role journeys: npx playwright test --project=e2e
    {
      name: "e2e",
      testDir: "./tests/e2e",
      timeout: 180000,
      use: browserUse,
    },

    {
      name: "api",
      testDir: "./tests/api",
      timeout: 90000,
      // The shared staging backend starts answering 500s under heavier load
      workers: 3,
      use: {
        actionTimeout: 60000,
      },
    },
  ],
});
