import { expect, Locator, Page } from "@playwright/test";

const RESET_RESPONSE_TIMEOUT = 30000;

export class ForgotPasswordPage {
  private page: Page;
  private emailInput: Locator;
  private submitButton: Locator;
  private resetSentMessage: Locator;
  private resetLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByTestId("input-forgot-email");
    this.submitButton = page.getByTestId("btn-forgot-submit");
    this.resetSentMessage = page.getByTestId("reset-sent-message");
    this.resetLink = page.getByTestId("reset-link");
  }

  async navigateToForgotPasswordPage() {
    await this.page.goto("/forgot-password");
  }

  async requestPasswordReset(email: string) {
    await this.emailInput.fill(email);
    await this.submitButton.click();
  }

  async verifyResetLinkSent(email: string) {
    await expect(this.resetSentMessage).toContainText(email, {
      timeout: RESET_RESPONSE_TIMEOUT,
    });
  }

  // The dev-mode reset link points at the backend's configured frontend host,
  // so only the token is taken from it and opened against the current baseURL.
  async getResetToken(): Promise<string> {
    const href = await this.resetLink.getAttribute("href");
    const token = href?.split("/reset-password/")[1];
    if (!token) {
      throw new Error(`Reset token not found in reset link: ${href}`);
    }
    return token;
  }
}
