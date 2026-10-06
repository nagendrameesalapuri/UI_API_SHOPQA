import { expect, Locator, Page } from "@playwright/test";
import { Address } from "../api/models/auth.models";
import { SavedAddress } from "../api/models/address.models";

const ADDRESS_RESPONSE_TIMEOUT = 30000;

// The "Addresses" tab of the profile page
export class AddressBookPage {
  private page: Page;
  private addressesTab: Locator;
  private addAddressButton: Locator;
  private addressForm: Locator;
  private labelInput: Locator;
  private fullNameInput: Locator;
  private phoneInput: Locator;
  private line1Input: Locator;
  private line2Input: Locator;
  private cityInput: Locator;
  private stateSelect: Locator;
  private postalInput: Locator;
  private isDefaultCheckbox: Locator;
  private saveAddressButton: Locator;
  private addressCards: Locator;
  private toastMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.addressesTab = page.getByTestId("tab-addresses");
    this.addAddressButton = page.getByTestId("add-address-btn");
    this.addressForm = page.getByTestId("address-form");
    this.labelInput = page.getByTestId("address-label");
    this.fullNameInput = page.getByTestId("address-full-name");
    this.phoneInput = page.getByTestId("address-phone");
    this.line1Input = page.getByTestId("address-line1");
    this.line2Input = page.getByTestId("address-line2");
    this.cityInput = page.getByTestId("address-city");
    this.stateSelect = page.getByTestId("address-state");
    this.postalInput = page.getByTestId("address-postal");
    this.isDefaultCheckbox = page.getByTestId("address-is-default");
    this.saveAddressButton = page.getByTestId("save-address-btn");
    this.addressCards = page.locator('[data-testid^="address-card-"]');
    this.toastMessage = page.locator(".Toastify__toast-body[role='alert']");
  }

  private waitForAddressResponse(method: string, path: RegExp) {
    return this.page.waitForResponse(
      (response) =>
        path.test(new URL(response.url()).pathname) &&
        response.request().method() === method,
      { timeout: ADDRESS_RESPONSE_TIMEOUT },
    );
  }

  addressCard(addressId: string): Locator {
    return this.page.getByTestId(`address-card-${addressId}`);
  }

  async navigateToAddressBook() {
    const addressesLoaded = this.waitForAddressResponse(
      "GET",
      /\/api\/users\/addresses$/,
    );
    await this.page.goto("/profile");
    await this.addressesTab.click();
    await addressesLoaded;
  }

  async openAddAddressForm() {
    await this.addAddressButton.click();
    await expect(this.addressForm).toBeVisible();
  }

  async verifyDefaultCheckbox(checked: boolean) {
    if (checked) {
      await expect(this.isDefaultCheckbox).toBeChecked();
    } else {
      await expect(this.isDefaultCheckbox).not.toBeChecked();
    }
  }

  async fillAddressForm(address: Address) {
    await this.labelInput.fill(address.label);
    await this.fullNameInput.fill(address.fullName);
    await this.phoneInput.fill(address.phone);
    await this.line1Input.fill(address.line1);
    await this.line2Input.fill(address.line2);
    await this.cityInput.fill(address.city);
    await this.stateSelect.selectOption(address.state);
    await this.postalInput.fill(address.postalCode);
  }

  // Saves the open form and returns the address the API created or updated
  private async saveAddressForm(
    method: "POST" | "PUT",
    toast: string,
  ): Promise<SavedAddress> {
    const saved = this.waitForAddressResponse(
      method,
      /\/api\/users\/addresses(\/[^/]+)?$/,
    );
    await this.saveAddressButton.click();
    const response = await saved;
    expect(response.ok()).toBeTruthy();
    await this.verifyToast(toast);
    await expect(this.addressForm).toBeHidden();
    return (await response.json()).address;
  }

  async saveNewAddress(): Promise<SavedAddress> {
    return await this.saveAddressForm("POST", "Address added");
  }

  async addAddress(address: Address): Promise<SavedAddress> {
    await this.openAddAddressForm();
    await this.fillAddressForm(address);
    return await this.saveNewAddress();
  }

  async editAddress(
    addressId: string,
    changes: { city: string; postalCode: string },
  ): Promise<SavedAddress> {
    await this.page.getByTestId(`edit-address-${addressId}`).click();
    await expect(this.addressForm).toBeVisible();
    await this.cityInput.fill(changes.city);
    await this.postalInput.fill(changes.postalCode);
    return await this.saveAddressForm("PUT", "Address updated");
  }

  async setDefault(addressId: string) {
    const updated = this.waitForAddressResponse(
      "PATCH",
      new RegExp(`/api/users/addresses/${addressId}/default$`),
    );
    await this.page.getByTestId(`set-default-${addressId}`).click();
    expect((await updated).ok()).toBeTruthy();
  }

  async deleteAddress(addressId: string) {
    const deleted = this.waitForAddressResponse(
      "DELETE",
      new RegExp(`/api/users/addresses/${addressId}$`),
    );
    await this.page.getByTestId(`delete-address-${addressId}`).click();
    expect((await deleted).ok()).toBeTruthy();
    await this.verifyToast("Address deleted");
  }

  async verifyAddressCount(count: number) {
    await expect(this.addressCards).toHaveCount(count);
  }

  async verifyAddressCardShows(addressId: string, address: Address) {
    const card = this.addressCard(addressId);
    await expect(card).toContainText(address.label, { ignoreCase: true });
    await expect(card).toContainText(address.fullName);
    await expect(card).toContainText(address.line1);
    await expect(card).toContainText(`${address.city}, ${address.state} ${address.postalCode}`);
    await expect(card).toContainText(address.phone);
  }

  async verifyIsDefault(addressId: string) {
    const card = this.addressCard(addressId);
    await expect(card.getByTestId("default-badge")).toBeVisible();
    // The default card offers no "Set Default" button
    await expect(this.page.getByTestId(`set-default-${addressId}`)).toHaveCount(0);
  }

  async verifyIsNotDefault(addressId: string) {
    const card = this.addressCard(addressId);
    await expect(card.getByTestId("default-badge")).toHaveCount(0);
    await expect(this.page.getByTestId(`set-default-${addressId}`)).toBeVisible();
  }

  async verifyOnlyOneDefault() {
    await expect(this.page.getByTestId("default-badge")).toHaveCount(1);
  }

  async verifyAddressRemoved(addressId: string) {
    await expect(this.addressCard(addressId)).toHaveCount(0);
  }

  async verifyCardActions(addressId: string) {
    await expect(this.page.getByTestId(`edit-address-${addressId}`)).toBeEnabled();
    await expect(this.page.getByTestId(`delete-address-${addressId}`)).toBeEnabled();
  }

  async verifyToast(message: string) {
    await expect(this.toastMessage.filter({ hasText: message }).first()).toBeVisible();
  }
}
