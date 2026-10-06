import { expect, Locator, Page } from "@playwright/test";
import { Review, ReviewInput } from "../api/models/review.models";

const API_RESPONSE_TIMEOUT = 30000;

export class ProductDetailPage {
  private page: Page;
  private productName: Locator;
  private reviewsTab: Locator;
  private specsTab: Locator;
  private specsContent: Locator;
  private specRows: Locator;
  private reviewsSummary: Locator;
  private avgRating: Locator;
  private writeReviewButton: Locator;
  private reviewForm: Locator;
  private reviewTitleInput: Locator;
  private reviewBodyInput: Locator;
  private submitReviewButton: Locator;
  private reviewCards: Locator;
  private quantityValue: Locator;
  private increaseQuantityButton: Locator;
  private addToCartButton: Locator;
  private toastMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.quantityValue = page.getByTestId("quantity-value");
    this.increaseQuantityButton = page.getByTestId("qty-btn-plus");
    this.addToCartButton = page.getByTestId("detail-add-to-cart");
    this.toastMessage = page.locator(".Toastify__toast-body[role='alert']");
    this.productName = page.getByTestId("product-detail-name");
    this.reviewsTab = page.getByTestId("tab-reviews");
    this.specsTab = page.getByTestId("tab-specs");
    this.specsContent = page.getByTestId("specs-content");
    this.specRows = this.specsContent.locator("tr");
    this.reviewsSummary = page.getByTestId("reviews-summary");
    this.avgRating = page.getByTestId("avg-rating");
    this.writeReviewButton = page.getByTestId("write-review-btn");
    this.reviewForm = page.getByTestId("review-form");
    this.reviewTitleInput = page.getByTestId("review-title");
    this.reviewBodyInput = page.getByTestId("review-body");
    this.submitReviewButton = page.getByTestId("submit-review-btn");
    this.reviewCards = page.getByTestId("review-card");
  }

  async navigateToProduct(slug: string, name: string) {
    await this.page.goto(`/products/${slug}`);
    await expect(this.productName).toHaveText(name);
  }

  // Clicks "+" the given number of times, stopping early if it becomes disabled
  async increaseQuantity(times: number) {
    for (let i = 0; i < times; i++) {
      if (await this.increaseQuantityButton.isDisabled()) return;
      await this.increaseQuantityButton.click();
    }
  }

  async verifyQuantityCappedAt(stock: number) {
    await expect(this.quantityValue).toHaveText(String(stock));
    await expect(this.increaseQuantityButton).toBeDisabled();
  }

  async addToCart() {
    const itemAdded = this.page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/cart/items") &&
        response.request().method() === "POST",
      { timeout: API_RESPONSE_TIMEOUT },
    );
    await this.addToCartButton.click();
    return await itemAdded;
  }

  async addToWishlist() {
    const wishlistButton = this.page.getByTestId("wishlist-btn");
    const added = this.page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/users/wishlist") &&
        response.request().method() === "POST",
      { timeout: API_RESPONSE_TIMEOUT },
    );
    await wishlistButton.click();
    expect((await added).ok()).toBeTruthy();
    await expect(wishlistButton).toHaveAttribute("aria-pressed", "true");
  }

  // The image must come from the given URL path and actually decode in the browser
  async verifyMainImageLoaded(srcPath: string) {
    const image = this.page.getByTestId("main-product-image");
    await expect(image).toHaveAttribute("src", new RegExp(`${srcPath}$`));
    await expect
      .poll(
        () => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
        {
          message:
            "Product image did not render (a cross-origin response header such as " +
            "Cross-Origin-Resource-Policy: same-origin makes the browser block it)",
        },
      )
      .toBeGreaterThan(0);
  }

  async verifyToast(message: string) {
    await expect(this.toastMessage.filter({ hasText: message })).toBeVisible();
  }

  async openReviewsTab() {
    await this.reviewsTab.click();
    await expect(this.reviewsSummary).toBeVisible();
  }

  async openSpecificationsTab() {
    await this.specsTab.click();
    await expect(this.specsContent).toBeVisible();
  }

  // Returns the review the API created, so the test can clean it up
  async submitReview(review: ReviewInput): Promise<Review> {
    await this.writeReviewButton.click();
    await expect(this.reviewForm).toBeVisible();

    // The form's star picker defaults to 5; the summary has its own star-N spans
    await this.reviewForm.getByTestId(`star-${review.rating}`).click();
    await this.reviewTitleInput.fill(review.title);
    await this.reviewBodyInput.fill(review.body);

    const reviewCreated = this.page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/reviews") &&
        response.request().method() === "POST",
      { timeout: API_RESPONSE_TIMEOUT },
    );
    await this.submitReviewButton.click();
    const response = await reviewCreated;
    expect(response.status()).toBe(201);

    const body = await response.json();
    return body.review ?? body;
  }

  async verifyReviewInList(reviewerName: string, review: ReviewInput) {
    const card = this.reviewCards.filter({ hasText: review.title });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("reviewer-name")).toHaveText(reviewerName);
    await expect(card.getByTestId("review-title-display")).toHaveText(
      review.title,
    );
    await expect(card.getByTestId("review-body-display")).toHaveText(
      review.body,
    );
    await expect(card.locator(".star.filled")).toHaveCount(review.rating);
  }

  async verifyRatingSummary(avgRating: string, reviewCount: number) {
    await expect(this.avgRating).toHaveText(avgRating);
    await expect(this.reviewsSummary).toContainText(
      `Based on ${reviewCount} reviews`,
    );
  }

  async getSpecifications(): Promise<Record<string, string>> {
    await expect(this.specRows.first()).toBeVisible();
    const rows = await this.specRows.evaluateAll((trs) =>
      trs.map((tr) => {
        const cells = tr.querySelectorAll("td");
        return [cells[0].textContent!.trim(), cells[1].textContent!.trim()];
      }),
    );
    return Object.fromEntries(rows);
  }
}
