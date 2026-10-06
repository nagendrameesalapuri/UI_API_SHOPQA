import { test, expect } from "../../../fixtures/ui.fixture";
import { ProductReviews, ReviewInput } from "../../../api/models/review.models";

// Dune averages 4.5, so a 4-star review visibly moves the average
const REVIEW_PRODUCT = { slug: "dune", name: "Dune" };

// One seeded product per category, each with its own category-specific specs
const SPEC_PRODUCTS = [
  { slug: "iphone-15-pro", name: "iPhone 15 Pro" },
  { slug: "nike-air-force-1", name: "Nike Air Force 1" },
  { slug: "dune", name: "Dune" },
];

// Average after adding one rating, formatted the way the page shows it ("4.4")
function expectedAverageAfter(summary: ProductReviews, newRating: number) {
  const ratingSum = summary.distribution.reduce(
    (sum, { rating, count }) => sum + rating * Number(count),
    0,
  );
  return ((ratingSum + newRating) / (summary.total + 1)).toFixed(1);
}

test.describe("Product Detail Tests", () => {
  test.describe.configure({ timeout: 120000 });

  test("@Regression TC-024 Submit product review", async ({
    loginPage,
    productDetailPage,
    productApi,
    reviewApi,
    verifiedUser,
    reviewsToDelete,
  }) => {
    const review: ReviewInput = {
      rating: 4,
      title: `Solid read ${Date.now()}`,
      body: "Dense world-building, but worth the effort. Automated review.",
    };

    const product = await productApi.getProduct(REVIEW_PRODUCT.slug);
    const before = await reviewApi.getReviews(product.id);
    const expectedAverage = expectedAverageAfter(before, review.rating);
    expect(
      expectedAverage,
      "Pick a product whose average changes with this rating",
    ).not.toBe(before.avgRating.toFixed(1));

    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
    await loginPage.verifyUserIsLoggedIn();

    await productDetailPage.navigateToProduct(
      REVIEW_PRODUCT.slug,
      REVIEW_PRODUCT.name,
    );
    await productDetailPage.openReviewsTab();

    const createdReview = await productDetailPage.submitReview(review);
    reviewsToDelete.push(createdReview.id);

    await productDetailPage.verifyReviewInList(
      `${verifiedUser.firstName} ${verifiedUser.lastName}`,
      review,
    );
    await productDetailPage.verifyRatingSummary(
      expectedAverage,
      before.total + 1,
    );
  });

  for (const { slug, name } of SPEC_PRODUCTS) {
    test(`@Regression TC-025 View product specifications - ${name}`, async ({
      productDetailPage,
      productApi,
    }) => {
      const product = await productApi.getProduct(slug);
      expect(Object.keys(product.specifications).length).toBeGreaterThan(0);

      await productDetailPage.navigateToProduct(slug, name);
      await productDetailPage.openSpecificationsTab();

      expect(await productDetailPage.getSpecifications()).toEqual({
        Brand: product.brand,
        SKU: product.sku,
        Weight: `${product.weight} kg`,
        Category: product.category_name,
        Stock: `${product.stock} units`,
        ...product.specifications,
      });
    });
  }
});
