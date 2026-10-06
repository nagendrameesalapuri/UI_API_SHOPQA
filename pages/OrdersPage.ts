import { expect, Locator, Page } from "@playwright/test";

export class OrdersPage {
  private page: Page;
  private orderCards: Locator;

  constructor(page: Page) {
    this.page = page;
    this.orderCards = page.getByTestId("order-card");
  }

  async navigateToOrdersPage() {
    await this.page.goto("/orders");
    await expect(this.page.getByTestId("orders-page")).toBeVisible();
  }

  private orderCard(orderNumber: string): Locator {
    return this.orderCards.filter({
      has: this.page.getByTestId("order-number").getByText(orderNumber, {
        exact: true,
      }),
    });
  }

  async verifyOrderListed(orderNumber: string, status: string) {
    const card = this.orderCard(orderNumber);
    await expect(card).toHaveCount(1);
    // Unlike the order detail page, the list shows the raw status ("return_requested")
    await expect(card.getByTestId("order-status-badge")).toHaveText(status);
  }

  async verifyOrderCount(count: number) {
    await expect(this.orderCards).toHaveCount(count);
  }
}
