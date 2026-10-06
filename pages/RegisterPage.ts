import { expect, Locator, Page } from "@playwright/test";
import { Address, RegisterUserRequest } from "../api/models/auth.models";

const REGISTER_RESPONSE_TIMEOUT = 30000;

export class RegisterPage {
  private page: Page;
  private firstNameInput: Locator;
  private lastNameInput: Locator;
  private emailInput: Locator;
  private passwordInput: Locator;
  private confirmPasswordInput: Locator;
  private phoneInput: Locator;
  private addressToggle: Locator;
  private line1Input: Locator;
  private line2Input: Locator;
  private cityInput: Locator;
  private stateSelect: Locator;
  private postalCodeInput: Locator;
  private countrySelect: Locator;
  private registerButton: Locator;
  private emailError: Locator;
  private successToast: Locator;
  private verificationLinkToast: Locator;

  constructor(page: Page) {
    this.page = page;
    this.firstNameInput = page.getByTestId("input-reg-first-name");
    this.lastNameInput = page.getByTestId("input-reg-last-name");
    this.emailInput = page.getByTestId("input-reg-email");
    this.passwordInput = page.getByTestId("input-reg-password");
    this.confirmPasswordInput = page.getByTestId("input-reg-confirm-password");
    this.phoneInput = page.getByTestId("input-reg-phone");
    this.addressToggle = page.getByTestId("toggle-reg-address");
    this.line1Input = page.getByTestId("input-reg-line1");
    this.line2Input = page.getByTestId("input-reg-line2");
    this.cityInput = page.getByTestId("input-reg-city");
    this.stateSelect = page.getByTestId("input-reg-state");
    this.postalCodeInput = page.getByTestId("input-reg-postal");
    this.countrySelect = page.getByTestId("input-reg-country");
    this.registerButton = page.getByTestId("btn-register");
    this.emailError = page.getByTestId("reg-email-error");
    this.successToast = page.locator(".Toastify__toast", {
      hasText: "Registration successful",
    });
    this.verificationLinkToast = page.locator(".Toastify__toast", {
      hasText: "/verify-email/",
    });
  }

  async navigateToRegisterPage() {
    await this.page.goto("/register");
  }

  async fillAccountDetails(user: RegisterUserRequest) {
    await this.firstNameInput.fill(user.firstName);
    await this.lastNameInput.fill(user.lastName);
    await this.emailInput.fill(user.email);
    await this.passwordInput.fill(user.password);
    await this.confirmPasswordInput.fill(user.password);
    await this.phoneInput.fill(user.phone);
  }

  async fillAddress(address: Address) {
    await this.addressToggle.click();
    await this.line1Input.fill(address.line1);
    await this.line2Input.fill(address.line2);
    await this.cityInput.fill(address.city);
    if (address.state) {
      await this.stateSelect.selectOption({ label: address.state });
    }
    await this.postalCodeInput.fill(address.postalCode);
    await this.countrySelect.selectOption({ label: address.country });
  }

  async submit() {
    await this.registerButton.click();
  }

  async registerWith(user: RegisterUserRequest) {
    await this.fillAccountDetails(user);
    await this.submit();
  }

  async verifyRegistrationSuccessful() {
    await expect(this.successToast).toContainText(
      "Registration successful! Please verify your email.",
      { timeout: REGISTER_RESPONSE_TIMEOUT },
    );
    await expect(this.page).toHaveURL(/\/login$/);
  }

  // In dev mode the app shows the email-verification link in a toast instead of sending an email
  async getEmailVerificationToken(): Promise<string> {
    await expect(this.verificationLinkToast).toBeVisible({
      timeout: REGISTER_RESPONSE_TIMEOUT,
    });
    const text = await this.verificationLinkToast.innerText();
    const token = text.match(/\/verify-email\/(\w+)/)?.[1];
    if (!token) {
      throw new Error(`Verification token not found in toast: ${text}`);
    }
    return token;
  }

  async verifyEmailError(message: string) {
    await expect(this.emailError).toHaveText(message, {
      timeout: REGISTER_RESPONSE_TIMEOUT,
    });
  }

  async verifyCityError(message: string) {
    await expect(this.fieldError(this.cityInput)).toHaveText(message);
  }

  async verifyStateError(message: string) {
    await expect(this.fieldError(this.stateSelect)).toHaveText(message);
  }

  async verifyPostalCodeError(message: string) {
    await expect(this.fieldError(this.postalCodeInput)).toHaveText(message);
  }

  async verifyFormNotSubmitted() {
    await expect(this.page).toHaveURL(/\/register$/);
    await expect(this.registerButton).toBeVisible();
    await expect(this.successToast).toBeHidden();
  }

  // Inline errors are rendered as a sibling <p class="form-error"> inside the field's form-group
  private fieldError(field: Locator): Locator {
    return this.page.locator(".form-group", { has: field }).locator(".form-error");
  }
}
