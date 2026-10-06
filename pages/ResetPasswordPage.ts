import { expect, Locator, Page } from "@playwright/test";

const RESET_RESPONSE_TIMEOUT = 30000;

export class ResetPasswordPage {
  private page: Page;
  private newPasswordInput: Locator;
  private confirmPasswordInput: Locator;
  private resetButton: Locator;
  private successToast: Locator;

  constructor(page: Page) {
    this.page = page;
    this.newPasswordInput = page.getByTestId("input-new-password");
    this.confirmPasswordInput = page.getByTestId("input-confirm-new-password");
    this.resetButton = page.getByTestId("btn-reset-submit");
    this.successToast = page.locator(".Toastify__toast", {
      hasText: "Password reset successfully! Please login.",
    });
  }

  async navigateToResetPasswordPage(token: string) {
    await this.page.goto(`/reset-password/${token}`);
  }

  async resetPassword(newPassword: string) {
    await this.newPasswordInput.fill(newPassword);
    await this.confirmPasswordInput.fill(newPassword);
    await this.resetButton.click();
  }

  async verifyPasswordResetSuccessful() {
    await expect(this.successToast).toBeVisible({
      timeout: RESET_RESPONSE_TIMEOUT,
    });
    await expect(this.page).toHaveURL(/\/login$/);
  }
}
