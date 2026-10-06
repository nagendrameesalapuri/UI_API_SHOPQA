import { expect, Locator, Page, Response } from "@playwright/test";

const PROFILE_RESPONSE_TIMEOUT = 30000;

// "My Profile": the Profile and Security tabs (Addresses lives in AddressBookPage)
export class ProfilePage {
  private page: Page;
  private firstNameInput: Locator;
  private lastNameInput: Locator;
  private emailInput: Locator;
  private saveProfileButton: Locator;
  private securityTab: Locator;
  private currentPasswordInput: Locator;
  private newPasswordInput: Locator;
  private confirmPasswordInput: Locator;
  private changePasswordButton: Locator;
  private currentPasswordError: Locator;
  private newPasswordError: Locator;
  private toastMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.firstNameInput = page.getByTestId("profile-first-name");
    this.lastNameInput = page.getByTestId("profile-last-name");
    this.emailInput = page.getByTestId("profile-email");
    this.saveProfileButton = page.getByTestId("save-profile-btn");
    this.securityTab = page.getByTestId("tab-security");
    this.currentPasswordInput = page.getByTestId("current-password");
    this.newPasswordInput = page.getByTestId("new-password");
    this.confirmPasswordInput = page.getByTestId("confirm-new-password");
    this.changePasswordButton = page.getByTestId("change-password-btn");
    this.currentPasswordError = page.getByTestId("current-password-error");
    this.newPasswordError = page.getByTestId("new-password-error");
    this.toastMessage = page.locator(".Toastify__toast-body[role='alert']");
  }

  private isPasswordChangeRequest(response: Response) {
    return (
      response.url().endsWith("/api/users/password") &&
      response.request().method() === "PUT"
    );
  }

  async navigateToProfilePage(email: string) {
    await this.page.goto("/profile");
    // The form fills in from /api/users/me after the page renders
    await expect(this.emailInput).toHaveValue(email, {
      timeout: PROFILE_RESPONSE_TIMEOUT,
    });
  }

  async updateName(firstName: string, lastName: string) {
    await this.firstNameInput.fill(firstName);
    await this.lastNameInput.fill(lastName);
    const saved = this.page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/users/me") &&
        response.request().method() === "PUT",
      { timeout: PROFILE_RESPONSE_TIMEOUT },
    );
    await this.saveProfileButton.click();
    expect((await saved).ok()).toBeTruthy();
  }

  async verifyName(firstName: string, lastName: string) {
    await expect(this.firstNameInput).toHaveValue(firstName);
    await expect(this.lastNameInput).toHaveValue(lastName);
  }

  async openSecurityTab() {
    await this.securityTab.click();
    await expect(this.currentPasswordInput).toBeVisible();
  }

  private async fillPasswordForm(current: string, newPassword: string) {
    await this.currentPasswordInput.fill(current);
    await this.newPasswordInput.fill(newPassword);
    await this.confirmPasswordInput.fill(newPassword);
  }

  // Submits the form and returns the API response
  async changePassword(current: string, newPassword: string): Promise<Response> {
    await this.fillPasswordForm(current, newPassword);
    const response = this.page.waitForResponse(
      (r) => this.isPasswordChangeRequest(r),
      { timeout: PROFILE_RESPONSE_TIMEOUT },
    );
    await this.changePasswordButton.click();
    return await response;
  }

  // Submits a password the client should reject; resolves to whether any request went out
  async submitPasswordChangeExpectingNoRequest(
    current: string,
    newPassword: string,
  ): Promise<boolean> {
    let requestSent = false;
    const onRequest = (request: { url(): string; method(): string }) => {
      if (request.url().endsWith("/api/users/password") && request.method() === "PUT") {
        requestSent = true;
      }
    };
    this.page.on("request", onRequest);
    await this.fillPasswordForm(current, newPassword);
    await this.changePasswordButton.click();
    await expect(this.newPasswordError).toBeVisible();
    // Give a wrongly-sent request time to show up before reporting
    await this.page.waitForTimeout(1000);
    this.page.off("request", onRequest);
    return requestSent;
  }

  async verifyCurrentPasswordError(message: string) {
    await expect(this.currentPasswordError).toHaveText(message);
    await expect(this.currentPasswordInput).toHaveClass(/\berror\b/);
  }

  async verifyNewPasswordError(message: string) {
    await expect(this.newPasswordError).toHaveText(message);
  }

  async verifyToast(message: string) {
    await expect(this.toastMessage.filter({ hasText: message }).first()).toBeVisible();
  }
}
