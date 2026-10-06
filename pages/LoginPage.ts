import { expect, Locator, Page } from "@playwright/test";

const LOGIN_RESPONSE_TIMEOUT = 20000;

export class LoginPage {
  private page: Page;
  private emailInput: Locator;
  private passwordInput: Locator;
  private signInButton: Locator;
  private toastMessage: Locator;
  private loginError: Locator;
  private userMenuButton: Locator;
  private logoutButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByTestId("input-email");
    this.passwordInput = page.getByTestId("input-password");
    this.signInButton = page.getByTestId("btn-login");
    this.toastMessage = page.locator(".Toastify__toast-body[role='alert']");
    this.loginError = page.getByTestId("login-error");
    this.userMenuButton = page.getByTestId("user-menu-btn");
    this.logoutButton = page.getByTestId("menu-logout");
  }

  async navigateToLoginPage() {
    await this.page.goto("/login");
  }

  async loginWith(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }

  async verifyWelcomeToast() {
    // Other toasts (e.g. "Password reset successfully!") can still be on screen, so match by text
    await expect(
      this.toastMessage.filter({ hasText: "Welcome back" }),
    ).toBeVisible({ timeout: LOGIN_RESPONSE_TIMEOUT });
  }

  async verifyLoginError(message: string) {
    await expect(this.loginError).toHaveText(message, {
      timeout: LOGIN_RESPONSE_TIMEOUT,
    });
  }

  async verifyUserIsLoggedIn() {
    await expect(this.page).not.toHaveURL(/\/login/, {
      timeout: LOGIN_RESPONSE_TIMEOUT,
    });
    await expect(this.userMenuButton).toBeVisible();
  }

  async verifyUserStaysOnLoginPage() {
    await expect(this.page).toHaveURL(/\/login$/);
    await expect(this.userMenuButton).toBeHidden();
  }

  async verifyRedirectedToLogin() {
    await expect(this.page).toHaveURL(/\/login/, {
      timeout: LOGIN_RESPONSE_TIMEOUT,
    });
  }

  async verifyRedirectedToLoginFrom(route: string) {
    await expect(this.page).toHaveURL(
      `/login?redirect=${encodeURIComponent(route)}`,
      { timeout: LOGIN_RESPONSE_TIMEOUT },
    );
  }

  // The app keeps the signed-in user in localStorage under "user"
  async getLoggedInUserId(): Promise<string> {
    const user = await this.page.evaluate(() => localStorage.getItem("user"));
    if (!user) {
      throw new Error("No logged-in user found in the browser.");
    }
    return JSON.parse(user).id;
  }

  async logout() {
    await this.userMenuButton.click();
    await this.logoutButton.click();
  }
}
