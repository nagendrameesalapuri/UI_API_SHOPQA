import { expect, Locator, Page } from "@playwright/test";

const ADMIN_LOAD_TIMEOUT = 20000;

export class AdminDashboardPage {
  private page: Page;
  private sidebar: Locator;
  private dashboard: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebar = page.getByTestId("admin-sidebar");
    this.dashboard = page.getByTestId("admin-dashboard");
  }

  async navigateToAdmin() {
    await this.page.goto("/admin");
  }

  async verifyAdminPanelShown() {
    // Also used right after login, while the redirect to /admin is still loading
    await expect(this.sidebar).toBeVisible({ timeout: ADMIN_LOAD_TIMEOUT });
    await expect(this.dashboard).toBeVisible();
  }

  // Non-admins get an "Access Denied" screen (no data-testids) instead of the panel
  async verifyAccessDenied() {
    await expect(
      this.page.getByRole("heading", { name: "Access Denied" }),
    ).toBeVisible();
    await expect(
      this.page.getByText("You need admin privileges to access this page."),
    ).toBeVisible();
    await expect(this.sidebar).toBeHidden();
    await expect(this.dashboard).toBeHidden();
  }
}
