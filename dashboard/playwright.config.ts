import { defineConfig, devices } from "@playwright/test";

// Playwright config for the Release Dashboard's own UI tests (tests/ui/dashboard).
// Separate from the shop-app config: it needs no shop credentials, and it builds and
// serves the web app with `vite preview`. The API is mocked in every test (page.route).
//   npm run test:dashboard
const isCI = !!process.env.TF_BUILD || !!process.env.CI;

export default defineConfig({
  testDir: "../tests/ui/dashboard",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI
    ? [["list"], ["junit", { outputFile: "../reports/dashboard-junit.xml" }]]
    : [["list"]],
  outputDir: "../test-results/dashboard",
  use: {
    baseURL: "http://localhost:4310",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "dashboard-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "dashboard-mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dashboard:build && npx vite preview --config dashboard/web/vite.config.ts",
    cwd: "..",
    url: "http://localhost:4310",
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
