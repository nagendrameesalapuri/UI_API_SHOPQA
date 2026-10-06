import { Download, expect, Locator, Page } from "@playwright/test";

const ORDER_RESPONSE_TIMEOUT = 30000;

export class OrderDetailPage {
  private page: Page;
  private orderStatus: Locator;
  private liveIndicator: Locator;
  private cancelOrderButton: Locator;
  private downloadInvoiceButton: Locator;
  private orderItems: Locator;
  private grandTotal: Locator;
  private toastMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.orderStatus = page.getByTestId("order-detail-status");
    this.liveIndicator = page.getByTestId("live-status-indicator");
    this.cancelOrderButton = page.getByTestId("cancel-order-btn");
    this.downloadInvoiceButton = page.getByTestId("download-invoice-btn");
    this.orderItems = page.getByTestId("order-item");
    this.grandTotal = page.getByTestId("order-grand-total");
    this.toastMessage = page.locator(".Toastify__toast-body[role='alert']");
  }

  async navigateToOrder(orderId: string) {
    await this.page.goto(`/orders/${orderId}`);
    await expect(this.orderStatus).toBeVisible({ timeout: ORDER_RESPONSE_TIMEOUT });
  }

  // Statuses render with spaces, e.g. "return_requested" shows as "return requested"
  async verifyStatus(status: string) {
    await expect(this.orderStatus).toHaveText(status.replace(/_/g, " "), {
      timeout: ORDER_RESPONSE_TIMEOUT,
    });
  }

  async verifyLiveUpdatesConnected() {
    await expect(this.liveIndicator).toContainText("Live");
  }

  // Call without reloading: the status must change on its own (pushed over a websocket)
  async verifyLiveStatusUpdate(status: string) {
    await this.verifyStatus(status);
    await expect(
      this.toastMessage.filter({ hasText: "Order status updated live" }).first(),
    ).toBeVisible();
  }

  async cancelOrder() {
    // The app asks "Cancel this order?" with a native confirm dialog
    this.page.once("dialog", (dialog) => dialog.accept());
    const cancelled = this.page.waitForResponse(
      (response) =>
        /\/api\/orders\/[^/]+\/cancel$/.test(response.url()) &&
        response.request().method() === "POST",
      { timeout: ORDER_RESPONSE_TIMEOUT },
    );
    await this.cancelOrderButton.click();
    expect((await cancelled).ok()).toBeTruthy();
  }

  async verifyCancelUnavailable() {
    await expect(this.cancelOrderButton).toBeHidden();
  }

  async downloadInvoice(): Promise<Download> {
    const download = this.page.waitForEvent("download", {
      timeout: ORDER_RESPONSE_TIMEOUT,
    });
    await this.downloadInvoiceButton.click();
    return await download;
  }

  async verifyItem(name: string, quantity: number) {
    const item = this.orderItems.filter({ hasText: name });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(`Qty: ${quantity}`);
  }

  async verifyGrandTotal(total: string) {
    await expect(this.grandTotal).toHaveText(total);
  }
}
