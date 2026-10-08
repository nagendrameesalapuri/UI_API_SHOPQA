import { defineConfig, devices, type ReporterDescription } from "@playwright/test";
import { env } from "./src/config/env";

// Validated config: fails fast with a readable list if a variable is missing.
const config = env();

// TF_BUILD is set by Azure Pipelines; CI by most other CI systems.
const isCI = !!process.env.TF_BUILD || !!process.env.CI;

// Tests tagged @quarantine are known-flaky and kept out of normal runs until fixed.
// Run them on purpose with INCLUDE_QUARANTINE=true.
const grepInvert = process.env.INCLUDE_QUARANTINE === "true" ? undefined : /@quarantine/;

const reporter: ReporterDescription[] = isCI
  ? [
      ["list"],
      // blob reports from every shard are merged into one HTML/JSON report later
      ["blob", { outputDir: "blob-report" }],
      ["junit", { outputFile: "reports/junit.xml" }],
      ["json", { outputFile: "reports/results.json" }],
    ]
  : [
      ["list"],
      ["html", { outputFolder: "playwright-report", open: "never" }],
      // Also written locally so `npm run triage` works after a local run, but not for
      // `--list`: that would overwrite the last real results with a list of skipped tests
      ...(process.argv.includes("--list")
        ? []
        : [["json", { outputFile: "reports/results.json" }] as ReporterDescription]),
    ];

const chromeMaximized = {
  ...devices["Desktop Chrome"],
  // Local runs open the browser maximized: a null viewport lets the page fill the window.
  // deviceScaleFactor from the device preset is not allowed with a null viewport.
  viewport: null,
  deviceScaleFactor: undefined,
  launchOptions: { args: ["--start-maximized"] },
};

// Headless in CI/Docker; headed locally unless HEADLESS=true.
const headless = isCI || process.env.HEADLESS === "true";
const chromium = headless ? { ...devices["Desktop Chrome"] } : chromeMaximized;

export default defineConfig({
  testDir: "./tests",
  // The shared staging backend (free tier) is sensitive to load, so files run in
  // parallel but tests inside a file run in order. Scale out in CI with shards.
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  grepInvert,
  reporter,

  expect: {
    timeout: 5000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}",

  use: {
    headless,
    baseURL: config.UI_BASE_URL,
    testIdAttribute: "data-testid",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10000,
    contextOptions: { reducedMotion: "reduce" },
  },

  projects: [
    // Logs in once per role and saves storageState to .auth/<role>.json
    {
      name: "setup",
      testDir: "./tests/setup",
      testMatch: /.*\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },

    {
      name: "chromium",
      testDir: "./tests",
      testMatch: ["ui/**/*.spec.ts", "seed.spec.ts"],
      // The dashboard has its own config (dashboard/playwright.config.ts)
      testIgnore: ["ui/dashboard/**"],
      dependencies: ["setup"],
      use: chromium,
    },

    {
      name: "firefox",
      testDir: "./tests",
      testMatch: ["ui/**/*.spec.ts", "seed.spec.ts"],
      // The dashboard has its own config (dashboard/playwright.config.ts)
      testIgnore: ["ui/dashboard/**"],
      dependencies: ["setup"],
      use: { ...devices["Desktop Firefox"] },
    },

    // Cross-module, multi-role journeys: npx playwright test --project=e2e
    {
      name: "e2e",
      testDir: "./tests/e2e",
      timeout: 180000,
      use: chromium,
    },

    {
      name: "api",
      testDir: "./tests/api",
      timeout: 90000,
      // The shared staging backend starts answering 500s under heavier load
      workers: 3,
      use: { actionTimeout: 60000 },
    },
  ],
});
