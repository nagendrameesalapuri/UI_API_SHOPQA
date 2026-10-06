import { expect, Locator, Page } from "@playwright/test";

const COUPON_RESPONSE_TIMEOUT = 30000;

export interface CouponFormData {
  code: string;
  type: "percentage" | "fixed";
  value: number;
  usageLimit: number;
  minOrderAmount: number;
}

export class AdminCouponsPage {
  private page: Page;
  private createCouponButton: Locator;
  private couponModal: Locator;
  private codeInput: Locator;
  private typeSelect: Locator;
  private valueInput: Locator;
  private limitInput: Locator;
  private minOrderInput: Locator;
  private saveCouponButton: Locator;
  private toastMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.createCouponButton = page.getByTestId("btn-create-coupon");
    this.couponModal = page.getByTestId("create-coupon-modal");
    this.codeInput = page.getByTestId("coupon-code");
    this.typeSelect = page.getByTestId("coupon-type");
    this.valueInput = page.getByTestId("coupon-value");
    this.limitInput = page.getByTestId("coupon-limit");
    this.minOrderInput = page.getByTestId("coupon-min-order");
    this.saveCouponButton = page.getByTestId("btn-save-coupon");
    this.toastMessage = page.locator(".Toastify__toast-body[role='alert']");
  }

  async navigateToCouponsPage() {
    await this.page.goto("/admin/coupons");
    await expect(this.createCouponButton).toBeVisible({
      timeout: COUPON_RESPONSE_TIMEOUT,
    });
  }

  private couponRow(code: string): Locator {
    return this.page.locator("[data-testid=admin-coupons-page] tbody tr").filter({
      has: this.page.getByTestId("coupon-code-cell").getByText(code, { exact: true }),
    });
  }

  async createCoupon(coupon: CouponFormData) {
    await this.createCouponButton.click();
    await expect(this.couponModal).toBeVisible();
    await this.codeInput.fill(coupon.code);
    await this.typeSelect.selectOption(coupon.type);
    await this.valueInput.fill(String(coupon.value));
    await this.limitInput.fill(String(coupon.usageLimit));
    await this.minOrderInput.fill(String(coupon.minOrderAmount));

    const created = this.page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/coupons") &&
        response.request().method() === "POST",
      { timeout: COUPON_RESPONSE_TIMEOUT },
    );
    await this.saveCouponButton.click();
    expect((await created).status()).toBe(201);
    await expect(this.toastMessage.filter({ hasText: "Coupon created!" })).toBeVisible();
    await expect(this.couponModal).toBeHidden();
  }

  async verifyCouponActive(code: string) {
    const row = this.couponRow(code);
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("coupon-status")).toHaveText("Active");
  }
}
