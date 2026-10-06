import { expect, Locator, Page } from "@playwright/test";

const USER_RESPONSE_TIMEOUT = 30000;

// The admin UI "locks" a user by banning them (status "banned")
export class AdminUsersPage {
  private page: Page;
  private searchInput: Locator;
  private userRows: Locator;
  private toastMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.getByTestId("admin-user-search");
    this.userRows = page.getByTestId("admin-user-row");
    this.toastMessage = page.locator(".Toastify__toast-body[role='alert']");
  }

  async navigateToUsersPage() {
    await this.page.goto("/admin/users");
    await expect(this.page.getByTestId("admin-users-table")).toBeVisible({
      timeout: USER_RESPONSE_TIMEOUT,
    });
  }

  private userRow(email: string): Locator {
    return this.userRows.filter({ hasText: email });
  }

  async findUser(email: string) {
    await this.searchInput.fill(email);
    await expect(this.userRow(email)).toHaveCount(1, {
      timeout: USER_RESPONSE_TIMEOUT,
    });
  }

  private async setStatus(email: string, button: string, status: string) {
    const updated = this.page.waitForResponse(
      (response) =>
        /\/api\/admin\/users\/[^/]+$/.test(response.url()) &&
        response.request().method() === "PATCH",
      { timeout: USER_RESPONSE_TIMEOUT },
    );
    await this.userRow(email).getByTestId(button).click();
    expect((await updated).ok()).toBeTruthy();
    await expect(
      this.userRow(email).getByTestId("admin-user-status"),
    ).toHaveText(status);
  }

  async banUser(email: string) {
    await this.setStatus(email, "btn-ban-user", "banned");
    await expect(this.toastMessage.filter({ hasText: "User banned" })).toBeVisible();
  }

  async unbanUser(email: string) {
    await this.setStatus(email, "btn-unban-user", "active");
  }
}
