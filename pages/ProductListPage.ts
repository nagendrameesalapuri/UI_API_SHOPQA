import { expect, Locator, Page } from "@playwright/test";
import { ProductSort } from "../api/models/product.models";

const PRODUCTS_RESPONSE_TIMEOUT = 30000;

export class ProductListPage {
  private page: Page;
  private navSearchInput: Locator;
  private navSearchButton: Locator;
  private productCount: Locator;
  private sortSelect: Locator;
  private minPriceInput: Locator;
  private maxPriceInput: Locator;
  private productCards: Locator;
  private productPrices: Locator;
  private emptyState: Locator;

  constructor(page: Page) {
    this.page = page;
    this.navSearchInput = page.getByTestId("nav-search-input");
    this.navSearchButton = page.getByTestId("nav-search-btn");
    this.productCount = page.getByTestId("product-count");
    this.sortSelect = page.getByTestId("sort-select");
    this.minPriceInput = page.getByTestId("filter-min-price");
    this.maxPriceInput = page.getByTestId("filter-max-price");
    this.productCards = page.getByTestId("product-card");
    this.productPrices = page.getByTestId("product-price");
    this.emptyState = page.getByTestId("empty-state");
  }

  // Every filter/sort change fires a new GET /api/products; waiting for it
  // avoids reading the grid while a stale response is still rendering
  private waitForProductsResponse(name: string, value: string | number) {
    return this.page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          url.pathname.endsWith("/api/products") &&
          url.searchParams.get(name) === String(value) &&
          response.ok()
        );
      },
      { timeout: PRODUCTS_RESPONSE_TIMEOUT },
    );
  }

  async navigateToProductListPage() {
    const productsLoaded = this.waitForProductsResponse("page", 1);
    await this.page.goto("/products");
    await productsLoaded;
  }

  async searchFor(query: string) {
    const productsLoaded = this.waitForProductsResponse("search", query);
    await this.navSearchInput.fill(query);
    await this.navSearchButton.click();
    await productsLoaded;
  }

  async filterByPriceRange(min: number, max: number) {
    // Fill one field at a time: the min-price fetch re-renders the panel
    const minApplied = this.waitForProductsResponse("minPrice", min);
    await this.minPriceInput.fill(String(min));
    await minApplied;

    const maxApplied = this.waitForProductsResponse("maxPrice", max);
    await this.maxPriceInput.fill(String(max));
    await maxApplied;
  }

  async sortBy(sort: ProductSort) {
    const sorted = this.waitForProductsResponse("sort", sort);
    await this.sortSelect.selectOption(sort);
    await sorted;
  }

  // "₹1,29,990" -> 129990
  async getDisplayedPrices(): Promise<number[]> {
    await expect(this.productCards.first()).toBeVisible();
    const prices = await this.productPrices.allInnerTexts();
    return prices.map((price) => Number(price.replace(/[^\d.]/g, "")));
  }

  async verifyAllPricesWithin(min: number, max: number) {
    const prices = await this.getDisplayedPrices();
    expect(prices.length).toBeGreaterThan(0);
    for (const price of prices) {
      expect(price, `Price ${price} outside ${min}-${max}`).toBeGreaterThanOrEqual(min);
      expect(price, `Price ${price} outside ${min}-${max}`).toBeLessThanOrEqual(max);
    }
  }

  async verifyPricesSorted(direction: "asc" | "desc") {
    const prices = await this.getDisplayedPrices();
    expect(prices.length).toBeGreaterThan(1);
    const expected = [...prices].sort((a, b) =>
      direction === "asc" ? a - b : b - a,
    );
    expect(prices).toEqual(expected);
  }

  async verifyUrlContains(param: string) {
    await expect(this.page).toHaveURL(new RegExp(param));
  }

  async verifyEmptyState() {
    await expect(this.productCount).toHaveText("0 products");
    await expect(this.productCards).toHaveCount(0);
    await expect(this.emptyState).toBeVisible();
    await expect(this.emptyState).toContainText("No products found");
  }

  async verifyProductListed(name: string) {
    await expect(this.productCardByName(name)).toHaveCount(1);
  }

  async verifyProductNotListed(name: string) {
    await expect(this.productCards).toHaveCount(0);
    await expect(this.productCardByName(name)).toHaveCount(0);
  }

  async openProduct(name: string) {
    await this.productCardByName(name).getByTestId("product-name").click();
    await expect(this.page).toHaveURL(/\/products\/[^/?]+$/);
  }

  private productCardByName(name: string): Locator {
    return this.productCards.filter({
      has: this.page.getByTestId("product-name").getByText(name, { exact: true }),
    });
  }

  productCardById(productId: string): Locator {
    return this.page.locator(
      `[data-testid="product-card"][data-product-id="${productId}"]`,
    );
  }

  async verifyProductOutOfStock(productId: string) {
    const card = this.productCardById(productId);
    await expect(card).toBeVisible();
    await expect(card.getByTestId("out-of-stock-badge")).toBeVisible();
    await expect(card.getByTestId("out-of-stock-badge")).toHaveText(
      "Out of Stock",
    );
    await expect(card.getByTestId("product-stock")).toHaveText("Out of Stock");
    await expect(card.getByTestId("add-to-cart-btn")).toBeDisabled();
  }
}
