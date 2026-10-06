import { test, expect } from "../../../fixtures/api.fixture";
import { expectError, expectStatus } from "../../../utils/api-assertions";
import { UNKNOWN_ID } from "../../../test-data/api";

test.describe("@API Users - wishlist", () => {
  test("Add, list and remove a product", async ({ api, wishlistApi, productApi, accessToken }) => {
    const product = await productApi.getProduct("dune");

    const added = await expectStatus(
      await api.path("users/wishlist").auth(accessToken).body({ productId: product.id }).postRequest(),
      201,
    );
    expect(added.message).toBe("Added to wishlist");
    expect((await wishlistApi.getWishlist(accessToken)).map(({ id }) => id)).toEqual([product.id]);

    const removed = await expectStatus(
      await api.path(`users/wishlist/${product.id}`).auth(accessToken).deleteRequest(),
      200,
    );
    expect(removed.message).toBe("Removed from wishlist");
    expect(await wishlistApi.getWishlist(accessToken)).toHaveLength(0);
  });

  test("Adding the same product twice keeps one entry", async ({
    wishlistApi,
    productApi,
    accessToken,
  }) => {
    const product = await productApi.getProduct("dune");
    await wishlistApi.addItem(accessToken, product.id);
    await wishlistApi.addItem(accessToken, product.id);

    expect(await wishlistApi.getWishlist(accessToken)).toHaveLength(1);
  });

  test("Wishlists are private to each user", async ({
    wishlistApi,
    productApi,
    accessToken,
    secondUser,
  }) => {
    const product = await productApi.getProduct("dune");
    await wishlistApi.addItem(accessToken, product.id);

    expect(await wishlistApi.getWishlist(secondUser.accessToken)).toHaveLength(0);
  });

  test("Unknown product returns 404", async ({ api, accessToken }) => {
    const response = await api.path("users/wishlist").auth(accessToken).body({ productId: UNKNOWN_ID }).postRequest();
    // Today: 500 with a raw database foreign-key error
    await expectError(response, 404);
  });

  test("Wishlist requires login", async ({ api }) => {
    await expectError(await api.path("users/wishlist").getRequest(), 401, "MISSING_TOKEN");
  });
});
