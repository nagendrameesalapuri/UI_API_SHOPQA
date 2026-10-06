import { test, expect } from "../../../fixtures/api.fixture";
import { createReviewResponseSchema } from "../../../api/schemas/review.schema";
import { expectError, expectStatus } from "../../../utils/api-assertions";
import { UNKNOWN_ID } from "../../../test-data/api";

const PRODUCT_SLUG = "atomic-habits";

test.describe("@API Reviews - reading", () => {
  test("Rating summary is consistent with the distribution", async ({
    productApi,
    reviewApi,
  }) => {
    const product = await productApi.getProduct(PRODUCT_SLUG);
    const summary = await reviewApi.getReviews(product.id);

    const counted = summary.distribution.reduce((n, { count }) => n + Number(count), 0);
    expect(counted).toBe(summary.total);

    const ratingSum = summary.distribution.reduce(
      (sum, { rating, count }) => sum + rating * Number(count),
      0,
    );
    expect(summary.avgRating).toBeCloseTo(ratingSum / summary.total, 1);
  });

  for (const [sort, direction] of [
    ["highest", "desc"],
    ["lowest", "asc"],
  ] as const) {
    test(`Sort ${sort}`, async ({ api, productApi }) => {
      const product = await productApi.getProduct(PRODUCT_SLUG);
      const { reviews } = await expectStatus(
        await api.path("reviews").params({ productId: product.id, sort }).getRequest(),
        200,
      );
      const ratings: number[] = reviews.map(({ rating }: { rating: number }) => rating);
      const sorted = [...ratings].sort((a, b) => (direction === "asc" ? a - b : b - a));
      expect(ratings).toEqual(sorted);
    });
  }

  test("productId is required", async ({ api }) => {
    // Today the body is { error } with no code, unlike every other error
    await expectError(await api.path("reviews").getRequest(), 400);
  });
});

test.describe("@API Reviews - writing", () => {
  test("Writing a review requires login", async ({ api, productApi }) => {
    const product = await productApi.getProduct(PRODUCT_SLUG);
    const response = await api
      .path("reviews")
      .body({ productId: product.id, rating: 5, title: "x", body: "y" })
      .postRequest();
    await expectError(response, 401, "MISSING_TOKEN");
  });

  test("Review lifecycle: create, edit, vote, delete", async ({
    api,
    productApi,
    reviewApi,
    accessToken,
    secondUser,
  }) => {
    const product = await productApi.getProduct(PRODUCT_SLUG);
    const created = await expectStatus(
      await api
        .path("reviews")
        .auth(accessToken)
        .body({ productId: product.id, rating: 4, title: "API review", body: "Solid read" })
        .postRequest(),
      201,
    );
    const { review } = createReviewResponseSchema.parse(created);
    expect(review).toMatchObject({ rating: 4, title: "API review", body: "Solid read" });

    try {
      await test.step("It is listed for the product", async () => {
        const { reviews } = await reviewApi.getReviews(product.id);
        expect(reviews.map(({ id }) => id)).toContain(review.id);
      });

      await test.step("A second review by the same user is refused", async () => {
        const response = await api
          .path("reviews")
          .auth(accessToken)
          .body({ productId: product.id, rating: 5, title: "Again", body: "Again" })
          .postRequest();
        await expectError(response, 409, "ALREADY_REVIEWED");
      });

      await test.step("Author can edit it", async () => {
        const body = await expectStatus(
          await api
            .path(`reviews/${review.id}`)
            .auth(accessToken)
            .body({ rating: 2, title: "Changed my mind", body: "Edited" })
            .putRequest(),
          200,
        );
        expect(body.review).toMatchObject({ rating: 2, title: "Changed my mind" });
      });

      await test.step("Another user cannot edit or delete it", async () => {
        await expectStatus(
          await api
            .path(`reviews/${review.id}`)
            .auth(secondUser.accessToken)
            .body({ rating: 1 })
            .putRequest(),
          404,
        );
        await expectStatus(
          await api.path(`reviews/${review.id}`).auth(secondUser.accessToken).deleteRequest(),
          404,
        );
      });

      await test.step("Helpful votes are counted", async () => {
        const body = await expectStatus(
          await api
            .path(`reviews/${review.id}/helpful`)
            .auth(secondUser.accessToken)
            .postRequest(),
          200,
        );
        expect(body.helpfulCount).toBe(1);
      });
    } finally {
      await reviewApi.deleteReview(review.id, accessToken);
    }

    await test.step("Deleted review is gone", async () => {
      const { reviews } = await reviewApi.getReviews(product.id);
      expect(reviews.map(({ id }) => id)).not.toContain(review.id);
      await expectStatus(
        await api.path(`reviews/${review.id}`).auth(accessToken).deleteRequest(),
        404,
      );
    });
  });

  for (const rating of [0, 6]) {
    test(`Rating ${rating} is rejected`, async ({ api, productApi, accessToken }) => {
      const product = await productApi.getProduct(PRODUCT_SLUG);
      const response = await api
        .path("reviews")
        .auth(accessToken)
        .body({ productId: product.id, rating, title: "x", body: "y" })
        .postRequest();
      await expectStatus(response, 400);
    });
  }

  test("Review for an unknown product returns 404", async ({ api, accessToken }) => {
    const response = await api
      .path("reviews")
      .auth(accessToken)
      .body({ productId: UNKNOWN_ID, rating: 4, title: "x", body: "y" })
      .postRequest();
    // Today: 500 with a raw database foreign-key error
    await expectError(response, 404);
  });
});
