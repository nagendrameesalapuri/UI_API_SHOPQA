import { test } from "../../../src/fixtures/dashboard.fixture";
import { aProgress, aResults, aRun, aTrend } from "../../../src/data/builders/dashboard.builder";

// Release Dashboard: results, trend and release history. Backend mocked with page.route.

test.describe("@dashboard Run results", () => {
  test.beforeEach(async ({ dashboardApi }) => {
    await dashboardApi.defaults();
    await dashboardApi.network.mockJson(
      "**/api/runs/4200/progress",
      aProgress(6, { passRate: 0.958 }),
    );
    await dashboardApi.network.mockJson("**/api/runs/4200/results", aResults());
  });

  test("@smoke shows KPI tiles for a finished run", async ({ dashboardPage }) => {
    await dashboardPage.open("runs/4200");
    await dashboardPage.verifyStep("Results published to Test Plan", "Done");
    await dashboardPage.verifyKpi("Total", "120");
    await dashboardPage.verifyKpi("Failed", "4");
    await dashboardPage.verifyKpi("Flaky", "1");
    await dashboardPage.verifyKpi("Pass rate", "95.8%");
    await dashboardPage.verifyKpi("Duration", "22m 0s");
  });

  test("groups failures by triage category", async ({ dashboardPage }) => {
    await dashboardPage.open("runs/4200");
    await dashboardPage.verifyFailureGroup("Environment", 2);
    await dashboardPage.verifyFailureGroup("Product bug", 1);
    await dashboardPage.verifyFailureGroup("Test issue", 1);
  });

  test("groups failures by root cause, with the bug draft link", async ({ dashboardPage }) => {
    await dashboardPage.open("runs/4200");
    await dashboardPage.groupFailuresBy("By root cause");
    await dashboardPage.verifyClusterShown("Place order failed. Status: 503");
    await dashboardPage.verifyClusterShown("Bug #9001");
  });

  test("shows an error with retry when the progress API fails", async ({
    dashboardPage,
    dashboardApi,
  }) => {
    await dashboardApi.network.mockJson(
      "**/api/runs/4200/progress",
      { error: "Internal error" },
      500,
    );
    await dashboardPage.open("runs/4200");
    await dashboardPage.verifyAlert("Internal error");
  });

  test("@a11y run page has no serious accessibility violations", async ({
    dashboardPage,
    a11y,
  }) => {
    await dashboardPage.open("runs/4200");
    await dashboardPage.verifyKpi("Total", "120");
    await a11y.check();
  });
});

test.describe("@dashboard Trend and releases", () => {
  test.beforeEach(async ({ dashboardApi }) => {
    await dashboardApi.defaults();
  });

  test("trend view charts the last runs", async ({ dashboardPage, dashboardApi }) => {
    await dashboardApi.network.mockJson("**/api/trend?n=*", aTrend(5));
    await dashboardPage.open();
    await dashboardPage.goTo("Trend");
    await dashboardPage.verifyTrendTable(5);
  });

  test("release history lists release, plan and outcome", async ({
    dashboardPage,
    dashboardApi,
  }) => {
    const run = aRun({ releaseVersion: "2026.09.2", status: "completed", passRate: 0.97 });
    await dashboardApi.network.mockJson("**/api/releases", [
      {
        releaseVersion: "2026.09.2",
        planId: 321,
        planUrl: run.planUrl,
        runs: [run],
        latestOutcome: "completed (97.0% pass)",
      },
    ]);
    await dashboardPage.open();
    await dashboardPage.goTo("Releases");
    await dashboardPage.verifyReleaseRow("2026.09.2", "completed (97.0% pass)");
  });
});
