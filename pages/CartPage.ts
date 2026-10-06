import { expect, Locator, Page } from "@playwright/test";
import { CartTotals } from "../api/models/cart.models";

const CART_RESPONSE_TIMEOUT = 30000;

// "-₹3,181.28" -> 3181.28
function parseAmount(text: string): number {
  return Number(text.replace(/[^\d.]/g, ""));
}

export class CartPage {
  private page: Page;
  private cartItems: Locator;
  private couponInput: Locator;
  private applyCouponButton: Locator;
  private removeCouponButton: Locator;
  private couponApplied: Locator;
  private couponError: Locator;
  private couponSuccess: Locator;
  private subtotal: Locator;
  private discount: Locator;
  private tax: Locator;
  private total: Locator;

  constructor(page: Page) {
    this.page = page;
    this.cartItems = page.getByTestId("cart-item");
    this.couponInput = page.getByTestId("coupon-input");
    this.applyCouponButton = page.getByTestId("apply-coupon-btn");
    this.removeCouponButton = page.getByTestId("remove-coupon-btn");
    this.couponApplied = page.getByTestId("coupon-applied");
    this.couponError = page.getByTestId("coupon-error");
    this.couponSuccess = page.getByTestId("coupon-success");
    this.subtotal = page.getByTestId("cart-subtotal");
    this.discount = page.getByTestId("discount-amount");
    this.tax = page.getByTestId("cart-tax");
    this.total = page.getByTestId("cart-total");
  }

  private waitForCouponResponse(method: "POST" | "DELETE") {
    return this.page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/cart/coupon") &&
        response.request().method() === method,
      { timeout: CART_RESPONSE_TIMEOUT },
    );
  }

  async navigateToCartPage() {
    await this.page.goto("/cart");
    await expect(this.total).toBeVisible({ timeout: CART_RESPONSE_TIMEOUT });
  }

  cartItem(productName: string): Locator {
    return this.cartItems.filter({
      has: this.page.getByTestId("cart-item-name").getByText(productName, {
        exact: true,
      }),
    });
  }

  async verifyItemInCart(productName: string, quantity: number) {
    const item = this.cartItem(productName);
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId("cart-qty")).toHaveText(String(quantity));
  }

  async verifyQuantityCappedAtStock(productName: string, stock: number) {
    const item = this.cartItem(productName);
    await expect(item.getByTestId("cart-qty")).toHaveText(String(stock));
    await expect(item.getByTestId("qty-increase")).toBeDisabled();
  }

  async getTotals(): Promise<CartTotals> {
    const hasDiscount = await this.discount.isVisible();
    return {
      subtotal: parseAmount(await this.subtotal.innerText()),
      discount: hasDiscount ? parseAmount(await this.discount.innerText()) : 0,
      tax: parseAmount(await this.tax.innerText()),
      total: parseAmount(await this.total.innerText()),
    };
  }

  async applyCoupon(code: string) {
    await this.couponInput.fill(code);
    const couponResponse = this.waitForCouponResponse("POST");
    await this.applyCouponButton.click();
    await couponResponse;
  }

  async removeCoupon() {
    const couponResponse = this.waitForCouponResponse("DELETE");
    await this.removeCouponButton.click();
    await couponResponse;
    await expect(this.couponApplied).toBeHidden();
    await expect(this.discount).toBeHidden();
  }

  async verifyCouponApplied(code: string, discount: number) {
    await expect(this.couponApplied).toContainText(code);
    await expect(this.couponSuccess).toHaveText(
      `Coupon applied! You saved ₹${discount.toFixed(2)}`,
    );
    await expect(this.discount).toHaveText(
      `-₹${discount.toLocaleString("en-IN")}`,
    );
  }

  async verifyCouponCodeApplied(code: string) {
    await expect(this.couponApplied).toContainText(code);
    await expect(this.couponSuccess).toContainText("Coupon applied! You saved");
    await expect(this.discount).toBeVisible();
  }

  async proceedToCheckout() {
    await this.page.getByTestId("proceed-checkout-btn").click();
    await expect(this.page).toHaveURL(/\/checkout$/);
  }

  async verifyCouponError(message: string) {
    await expect(this.couponError).toHaveText(message);
    await expect(this.couponApplied).toBeHidden();
    await expect(this.discount).toBeHidden();
  }
}
