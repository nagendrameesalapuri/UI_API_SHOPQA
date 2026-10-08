import { expect, type Locator, type Page, test } from "@playwright/test";

// Page object for the Release Dashboard (dashboard/web). Role/label locators only:
// the dashboard is our own accessible UI, so getByRole works everywhere.

export class DashboardPage {
  readonly releaseInput: Locator;
  readonly environmentSelect: Locator;
  readonly scopeInput: Locator;
  readonly startButton: Locator;
  readonly recentRuns: Locator;
  readonly progress: Locator;
  readonly results: Locator;

  constructor(private readonly page: Page) {
    this.releaseInput = page.getByLabel("Release version");
    this.environmentSelect = page.getByLabel("Environment");
    this.scopeInput = page.getByLabel("Test scope (tags / grep)");
    this.startButton = page.getByRole("button", { name: "Start regression run" });
    this.recentRuns = page.getByRole("region", { name: "Recent runs" });
    this.progress = page.getByRole("list", { name: "Run progress" });
    this.results = page.getByRole("region", { name: "Results" });
  }

  async open(path = "") {
    await this.page.goto(`/#/${path}`);
  }

  async startRun(run: { releaseVersion: string; environment?: string; grep?: string }) {
    await test.step(`Start a regression run for ${run.releaseVersion}`, async () => {
      await this.releaseInput.fill(run.releaseVersion);
      if (run.environment) await this.environmentSelect.selectOption(run.environment);
      if (run.grep) await this.scopeInput.fill(run.grep);
      await this.startButton.click();
    });
  }

  async goTo(tab: "Runs" | "Trend" | "Releases") {
    await this.page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: tab })
      .click();
  }

  async groupFailuresBy(mode: "By category" | "By root cause") {
    await this.page.getByRole("radio", { name: mode }).click();
  }

  async verifyFieldError(message: string | RegExp) {
    await expect(this.page.getByText(message)).toBeVisible();
  }

  async verifyOnRunPage(runId: string) {
    await expect(this.page).toHaveURL(new RegExp(`#/runs/${runId}$`));
  }

  async verifyStep(
    label: string,
    state: "Waiting" | "In progress" | "Done" | "Failed" | "Skipped",
  ) {
    await expect(this.progress.getByRole("listitem").filter({ hasText: label })).toContainText(
      state,
    );
  }

  async verifyKpi(label: string, value: string) {
    await expect(
      this.results.getByTestId(`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`),
    ).toContainText(value);
  }

  async verifyFailureGroup(category: string, count: number) {
    await expect(this.results.locator("summary").filter({ hasText: category })).toContainText(
      String(count),
    );
  }

  async verifyClusterShown(errorText: string) {
    await expect(this.results.getByRole("listitem").filter({ hasText: errorText })).toBeVisible();
  }

  async verifyRunListed(releaseVersion: string) {
    await expect(
      this.recentRuns.getByRole("link", { name: new RegExp(releaseVersion) }),
    ).toBeVisible();
  }

  async verifyEmptyRuns() {
    await expect(this.recentRuns).toContainText("No runs yet");
  }

  async verifyAlert(text: string | RegExp) {
    await expect(this.page.getByRole("alert").first()).toContainText(text);
  }

  async verifyResultsPending() {
    await expect(this.results.getByRole("status")).toContainText(
      "Results appear here once the run is triaged",
    );
  }

  async verifyTrendTable(rows: number) {
    await expect(this.page.getByRole("img", { name: /Pass rate over the last/ })).toBeVisible();
    await expect(this.page.getByRole("table").getByRole("row")).toHaveCount(rows + 1);
  }

  async verifyReleaseRow(releaseVersion: string, outcome: string) {
    await expect(this.page.getByRole("row", { name: new RegExp(releaseVersion) })).toContainText(
      outcome,
    );
  }
}
