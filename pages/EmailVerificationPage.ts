import { expect, Locator, Page } from "@playwright/test";

const VERIFY_RESPONSE_TIMEOUT = 30000;

// The link a user clicks in their verification email. It is served by the
// backend host, so it is opened with the API base URL rather than the UI baseURL.
export class EmailVerificationPage {
  private page: Page;
  private body: Locator;

  constructor(page: Page) {
    this.page = page;
    this.body = page.locator("body");
  }

  async openVerificationLink(token: string) {
    await this.page.goto(
      `${process.env.API_BASE_URL}/api/auth/verify-email/${token}`,
      { timeout: VERIFY_RESPONSE_TIMEOUT },
    );
  }

  async verifyEmailVerified() {
    await expect(this.body).toContainText("Email verified successfully");
  }
}
