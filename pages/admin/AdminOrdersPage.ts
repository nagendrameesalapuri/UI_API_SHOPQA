import { expect, Locator, Page } from "@playwright/test";

const ORDER_RESPONSE_TIMEOUT = 30000;

export class AdminOrdersPage {
  private page: Page;
  private searchInput: Locator;
  private orderRows: Locator;
  private statusModal: Locator;
  private newStatusSelect: Locator;
  private confirmStatusButton: Locator;
  private toastMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.getByTestId("admin-order-search");
    this.orderRows = page.getByTestId("admin-order-row");
    this.statusModal = page.getByTestId("update-status-modal");
    this.newStatusSelect = page.getByTestId("new-status-select");
    this.confirmStatusButton = page.getByTestId("btn-confirm-status-update");
    this.toastMessage = page.locator(".Toastify__toast-body[role='alert']");
  }

  async navigateToOrdersPage() {
    await this.page.goto("/admin/orders");
    await expect(this.page.getByTestId("admin-orders-table")).toBeVisible({
      timeout: ORDER_RESPONSE_TIMEOUT,
    });
  }

  private orderRow(orderNumber: string): Locator {
    return this.orderRows.filter({
      has: this.page.getByTestId("admin-order-number").getByText(orderNumber, {
        exact: true,
      }),
    });
  }

  async findOrder(orderNumber: string) {
    await this.searchInput.fill(orderNumber);
    await expect(this.orderRow(orderNumber)).toHaveCount(1, {
      timeout: ORDER_RESPONSE_TIMEOUT,
    });
  }

  async updateStatus(orderNumber: string, status: string) {
    await this.orderRow(orderNumber).getByTestId("btn-update-order-status").click();
    await expect(this.statusModal).toContainText(orderNumber);
    await this.newStatusSelect.selectOption(status);

    const updated = this.page.waitForResponse(
      (response) =>
        /\/api\/orders\/admin\/[^/]+\/status$/.test(response.url()) &&
        response.request().method() === "PUT",
      { timeout: ORDER_RESPONSE_TIMEOUT },
    );
    await this.confirmStatusButton.click();
    expect((await updated).ok()).toBeTruthy();
    await expect(
      this.toastMessage.filter({ hasText: `Order status updated to ${status}` }),
    ).toBeVisible();
    await expect(this.statusModal).toBeHidden();
  }

  async verifyStatus(orderNumber: string, status: string) {
    await expect(
      this.orderRow(orderNumber).getByTestId("admin-order-status"),
    ).toHaveText(status);
  }
}
