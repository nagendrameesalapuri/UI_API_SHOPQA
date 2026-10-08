import { test } from "../../../src/fixtures/dashboard.fixture";
import { aProgress, aRun } from "../../../src/data/builders/dashboard.builder";

// Release Dashboard: starting a regression run. Backend mocked with page.route.

test.describe("@dashboard New regression run", () => {
  test.beforeEach(async ({ dashboardApi }) => {
    await dashboardApi.defaults();
  });

  test("@smoke shows an empty run list on first use", async ({ dashboardPage }) => {
    await dashboardPage.open();
    await dashboardPage.verifyEmptyRuns();
  });

  test("rejects a release version in the wrong format before calling the API", async ({
    dashboardPage,
  }) => {
    await dashboardPage.open();
    await dashboardPage.startRun({ releaseVersion: "release-10" });
    await dashboardPage.verifyFieldError(/Use the format YYYY\.MM/);
  });

  test("@smoke starting a run opens its live progress", async ({ dashboardPage, dashboardApi }) => {
    await dashboardApi.network.mockJson("**/api/runs", aRun({ id: "4200" }), 201, "POST");
    await dashboardApi.network.mockJson("**/api/runs/4200/progress", aProgress(2));
    await dashboardApi.network.mockJson(
      "**/api/runs/4200/results",
      { error: "Results are not available yet" },
      404,
    );

    await dashboardPage.open();
    await dashboardPage.startRun({ releaseVersion: "2026.10.1", environment: "uat" });

    await dashboardPage.verifyOnRunPage("4200");
    await dashboardPage.verifyStep("Test Plan created", "Done");
    await dashboardPage.verifyStep("Pipeline queued", "Done");
    await dashboardPage.verifyStep("Running tests", "In progress");
    await dashboardPage.verifyStep("Failures triaged", "Waiting");
    await dashboardPage.verifyResultsPending();
  });

  test("shows the server's reason when the run cannot be started", async ({
    dashboardPage,
    dashboardApi,
  }) => {
    await dashboardApi.network.mockJson(
      "**/api/runs",
      { error: "Azure DevOps error (401): unauthorized" },
      502,
      "POST",
    );
    await dashboardPage.open();
    await dashboardPage.startRun({ releaseVersion: "2026.10.1" });
    await dashboardPage.verifyAlert("Azure DevOps error (401)");
  });

  test("lists recent runs with status and pass rate", async ({ dashboardPage, dashboardApi }) => {
    await dashboardApi.network.mockJson(
      "**/api/runs",
      [aRun({ releaseVersion: "2026.09.2", status: "completed", passRate: 0.97 })],
      200,
      "GET",
    );
    await dashboardPage.open();
    await dashboardPage.verifyRunListed("2026.09.2");
  });

  test("@a11y home page has no serious accessibility violations", async ({
    dashboardPage,
    a11y,
  }) => {
    await dashboardPage.open();
    await dashboardPage.verifyEmptyRuns();
    await a11y.check();
  });
});
