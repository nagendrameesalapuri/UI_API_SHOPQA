import { expect, Locator, Page, Response } from "@playwright/test";
import { SavedAddress } from "../api/models/address.models";
import { ShippingAddress } from "../api/models/order.models";

const ORDER_RESPONSE_TIMEOUT = 30000;

export type ShippingField = "full-name" | "phone" | "line1" | "city" | "postal";

export class CheckoutPage {
  private page: Page;
  private shippingStep: Locator;
  private deliveryStep: Locator;
  private paymentStep: Locator;
  private reviewStep: Locator;
  private savedAddressCards: Locator;
  private stateSelect: Locator;
  private nextButton: Locator;
  private backButton: Locator;
  private cardNumberInput: Locator;
  private cardExpiryInput: Locator;
  private cardCvvInput: Locator;
  private cardNameInput: Locator;
  private upiOption: Locator;
  private upiIdInput: Locator;
  private codOption: Locator;
  private placeOrderButton: Locator;
  private confirmTitle: Locator;
  private confirmOrderNumber: Locator;
  private toastMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.shippingStep = page.getByTestId("step-shipping");
    this.deliveryStep = page.getByTestId("step-delivery");
    this.paymentStep = page.getByTestId("step-payment");
    this.reviewStep = page.getByTestId("step-review");
    this.savedAddressCards = page.locator('[data-testid^="saved-address-"]');
    this.stateSelect = page.getByTestId("field-state");
    this.nextButton = page.getByTestId("btn-next");
    this.backButton = page.getByTestId("btn-back");
    this.cardNumberInput = page.getByTestId("card-number");
    this.cardExpiryInput = page.getByTestId("card-expiry");
    this.cardCvvInput = page.getByTestId("card-cvv");
    this.cardNameInput = page.getByTestId("card-name");
    this.upiOption = page.getByTestId("payment-upi");
    this.upiIdInput = page.getByTestId("upi-id");
    this.codOption = page.getByTestId("payment-cod");
    this.placeOrderButton = page.getByTestId("btn-place-order");
    this.confirmTitle = page.getByTestId("confirm-title");
    this.confirmOrderNumber = page.getByTestId("confirm-order-number");
    this.toastMessage = page.locator(".Toastify__toast-body[role='alert']");
  }

  private shippingInput(field: ShippingField): Locator {
    return this.page.getByTestId(`field-${field}`);
  }

  savedAddressCard(addressId: string): Locator {
    return this.page.getByTestId(`saved-address-${addressId}`);
  }

  async navigateToCheckoutPage() {
    await this.page.goto("/checkout");
    await expect(this.shippingStep).toBeVisible();
  }

  // ---- Shipping step ----

  async selectSavedAddress(addressId: string) {
    await this.savedAddressCard(addressId).click();
  }

  async verifyAddressSelected(addressId: string) {
    // Saved addresses load after the page; slow under parallel load
    await expect(this.savedAddressCard(addressId)).toHaveClass(/\bselected\b/, {
      timeout: ORDER_RESPONSE_TIMEOUT,
    });
    await expect(this.page.locator(".address-card.selected")).toHaveCount(1);
  }

  async verifyNoAddressSelected() {
    await expect(this.page.locator(".address-card.selected")).toHaveCount(0);
  }

  async verifyShippingFormMatches(address: SavedAddress) {
    await expect(this.shippingInput("full-name")).toHaveValue(address.full_name);
    await expect(this.shippingInput("phone")).toHaveValue(address.phone);
    await expect(this.shippingInput("line1")).toHaveValue(address.line1);
    await expect(this.shippingInput("city")).toHaveValue(address.city);
    await expect(this.stateSelect).toHaveValue(address.state);
    await expect(this.shippingInput("postal")).toHaveValue(address.postal_code);
  }

  async fillShippingField(field: ShippingField, value: string) {
    await this.shippingInput(field).fill(value);
  }

  // For users with no saved address: type the whole shipping address by hand
  async fillShippingAddress(address: ShippingAddress) {
    // The form prefills the name from the profile; typing earlier gets overwritten
    await expect(this.shippingInput("full-name")).not.toHaveValue("");
    await this.shippingInput("full-name").fill(address.fullName);
    await this.shippingInput("phone").fill(address.phone);
    await this.shippingInput("line1").fill(address.line1);
    await this.shippingInput("city").fill(address.city);
    await this.stateSelect.selectOption(address.state);
    await this.shippingInput("postal").fill(address.postalCode);
  }

  async verifyShippingFormMatchesAddress(address: ShippingAddress) {
    await expect(this.shippingInput("line1")).toHaveValue(address.line1);
    await expect(this.shippingInput("city")).toHaveValue(address.city);
    await expect(this.stateSelect).toHaveValue(address.state);
    await expect(this.shippingInput("postal")).toHaveValue(address.postalCode);
  }

  async verifyOnlySavedAddressSelected() {
    await expect(this.savedAddressCards).toHaveCount(1);
    await expect(this.savedAddressCards.first()).toHaveClass(/\bselected\b/);
    await expect(this.savedAddressCards.first()).toContainText("Default");
  }

  async selectState(state: string) {
    await this.stateSelect.selectOption(state);
  }

  async clearShippingForm() {
    for (const field of ["full-name", "phone", "line1", "city", "postal"] as const) {
      await this.shippingInput(field).clear();
    }
    await this.stateSelect.selectOption("");
  }

  async verifySavedAddressesOffered(addressIds: string[]) {
    await expect(this.savedAddressCards).toHaveCount(addressIds.length);
    for (const addressId of addressIds) {
      await expect(this.savedAddressCard(addressId)).toBeVisible();
    }
  }

  async verifySavedAddressNotOffered(addressId: string) {
    await expect(this.savedAddressCard(addressId)).toHaveCount(0);
  }

  async continueToNextStep() {
    await this.nextButton.click();
  }

  async verifyStillOnShippingStep() {
    await expect(this.shippingStep).toBeVisible();
    await expect(this.deliveryStep).toBeHidden();
  }

  // ---- Delivery / payment / review ----

  async continueToPayment() {
    await this.nextButton.click();
    await expect(this.deliveryStep).toBeVisible();
    await this.nextButton.click();
    await expect(this.paymentStep).toBeVisible();
  }

  async payByCard(cardNumber: string) {
    await this.cardNumberInput.fill(cardNumber);
    await this.cardExpiryInput.fill("12/30");
    await this.cardCvvInput.fill("123");
    await this.cardNameInput.fill("QA AUTOMATION");
    await this.continueToReview();
  }

  async payByUpi(upiId: string) {
    await this.upiOption.click();
    await this.upiIdInput.fill(upiId);
    await this.continueToReview();
  }

  async payByCashOnDelivery() {
    await this.codOption.click();
    await this.continueToReview();
  }

  private async continueToReview() {
    await this.nextButton.click();
    await expect(this.reviewStep).toBeVisible();
  }

  async backToPayment() {
    await this.backButton.click();
    await expect(this.paymentStep).toBeVisible();
  }

  async placeOrder(): Promise<Response> {
    const orderResponse = this.page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/orders") &&
        response.request().method() === "POST",
      { timeout: ORDER_RESPONSE_TIMEOUT },
    );
    await this.placeOrderButton.click();
    return await orderResponse;
  }

  async verifyPaymentFailed(message: string) {
    await this.verifyToast(`Payment failed: ${message}`);
    await expect(this.reviewStep).toBeVisible();
    await expect(this.placeOrderButton).toBeEnabled();
  }

  async verifyOrderConfirmed(orderNumber: string) {
    await expect(this.page).toHaveURL(/\/order-confirmation\//);
    await expect(this.confirmTitle).toHaveText("Order Confirmed!");
    await expect(this.confirmOrderNumber).toHaveText(orderNumber);
  }

  async verifyToast(message: string) {
    await expect(this.toastMessage.filter({ hasText: message })).toBeVisible();
  }
}
