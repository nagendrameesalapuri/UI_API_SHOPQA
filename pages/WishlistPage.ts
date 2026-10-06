import { expect, Locator, Page } from "@playwright/test";

const CART_RESPONSE_TIMEOUT = 30000;

export class WishlistPage {
  private page: Page;
  private wishlistItems: Locator;
  private cartCount: Locator;
  private toastMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.wishlistItems = page.getByTestId("wishlist-item");
    this.cartCount = page.getByTestId("cart-count");
    this.toastMessage = page.locator(".Toastify__toast-body[role='alert']");
  }

  async navigateToWishlistPage() {
    await this.page.goto("/wishlist");
    await expect(this.page.getByTestId("wishlist-page")).toBeVisible();
  }

  private wishlistItem(productName: string): Locator {
    return this.wishlistItems.filter({
      has: this.page.getByTestId("wishlist-item-name").getByText(productName, {
        exact: true,
      }),
    });
  }

  async verifyItemInWishlist(productName: string) {
    await expect(this.wishlistItem(productName)).toHaveCount(1);
  }

  async addToCart(productName: string) {
    const added = this.page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/cart/items") &&
        response.request().method() === "POST",
      { timeout: CART_RESPONSE_TIMEOUT },
    );
    await this.wishlistItem(productName).getByTestId("wishlist-add-to-cart").click();
    expect((await added).ok()).toBeTruthy();
    await expect(this.toastMessage.filter({ hasText: "Added to cart!" })).toBeVisible();
  }

  async verifyCartBadge(count: number) {
    await expect(this.cartCount).toHaveText(String(count));
  }

  async verifyCartBadgeHidden() {
    await expect(this.cartCount).toBeHidden();
  }
}
