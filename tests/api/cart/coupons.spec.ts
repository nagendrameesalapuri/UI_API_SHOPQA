import { test, expect } from "../../../fixtures/api.fixture";
import { applyCouponResponseSchema } from "../../../api/schemas/cart.schema";
import { expectError, expectStatus } from "../../../utils/api-assertions";
import { roundMoney } from "../../../test-data/api";

// These tests only apply coupons to carts; they never place orders with them,
// because seeded coupons have a shared, global usage limit.

test.describe("@API Coupons - validation endpoint", () => {
  test("Valid coupon is described", async ({ api, accessToken }) => {
    const body = await expectStatus(
      await api.path("coupons/validate/WELCOME10").auth(accessToken).getRequest(),
      200,
    );
    expect(body.coupon).toMatchObject({ code: "WELCOME10", type: "percentage", value: "10.00" });
  });

  for (const code of ["NOPE123", "EXPIRED50"]) {
    test(`${code} is reported as invalid`, async ({ api, accessToken }) => {
      const response = await api.path(`coupons/validate/${code}`).auth(accessToken).getRequest();
      await expectError(response, 404, "INVALID_COUPON");
    });
  }

  test("Exhausted coupon is reported", async ({ api, accessToken }) => {
    const response = await api.path("coupons/validate/MAXUSED").auth(accessToken).getRequest();
    await expectError(response, 400, "COUPON_EXHAUSTED");
  });

  test("Validation requires login", async ({ api }) => {
    await expectError(await api.path("coupons/validate/WELCOME10").getRequest(), 401, "MISSING_TOKEN");
  });
});

test.describe("@API Coupons - applying to the cart", () => {
  const apply = async (
    api: import("../../../utils/request-handler").RequestHandler,
    token: string,
    code: string,
  ) => api.path("cart/coupon").auth(token).body({ code }).postRequest();

  test("Percentage coupon takes 10% off the subtotal", async ({
    api,
    cartApi,
    productApi,
    accessToken,
  }) => {
    const product = await productApi.getProduct("dune");
    await cartApi.addItem(accessToken, product.id, 2);

    const body = applyCouponResponseSchema.parse(
      await expectStatus(await apply(api, accessToken, "WELCOME10"), 200),
    );
    const cart = await cartApi.getCart(accessToken);
    expect(body.coupon.discount).toBeCloseTo(roundMoney(cart.subtotal * 0.1), 2);
    expect(cart.discount).toBeCloseTo(body.coupon.discount, 2);
    expect(cart.coupon?.code).toBe("WELCOME10");
  });

  test("Codes are case-insensitive", async ({ api, cartApi, productApi, accessToken }) => {
    const product = await productApi.getProduct("dune");
    await cartApi.addItem(accessToken, product.id, 1);

    const body = await expectStatus(await apply(api, accessToken, "welcome10"), 200);
    expect(body.coupon.code).toBe("WELCOME10");
  });

  test("Percentage coupon is capped at its max discount", async ({
    api,
    cartApi,
    productApi,
    accessToken,
  }) => {
    // SUMMER25: 25% off, at most ₹1,000; a ₹1,34,900 phone hits the cap
    const product = await productApi.getProduct("iphone-15-pro");
    await cartApi.addItem(accessToken, product.id, 1);

    const body = await expectStatus(await apply(api, accessToken, "SUMMER25"), 200);
    expect(body.coupon.discount).toBe(1000);
  });

  test("Fixed coupon below its minimum order is refused", async ({
    api,
    cartApi,
    productApi,
    accessToken,
  }) => {
    const product = await productApi.getProduct("dune");
    await cartApi.addItem(accessToken, product.id, 1);

    const body = await expectError(await apply(api, accessToken, "FLAT500"), 400, "MIN_ORDER_NOT_MET");
    expect(body.error).toBe("Minimum order amount 2000.00 required");
    expect((await cartApi.getCart(accessToken)).discount).toBe(0);
  });

  test("Fixed coupon above its minimum order takes ₹500 off", async ({
    api,
    cartApi,
    productApi,
    accessToken,
  }) => {
    const product = await productApi.getProduct("the-pragmatic-programmer");
    await cartApi.addItem(accessToken, product.id, 3);

    const body = await expectStatus(await apply(api, accessToken, "FLAT500"), 200);
    expect(body.coupon.discount).toBe(500);
    const cart = await cartApi.getCart(accessToken);
    expect(cart.discount).toBe(500);
    // GST is charged on the discounted amount
    expect(cart.tax).toBeCloseTo(roundMoney((cart.subtotal - 500) * 0.18), 2);
  });

  for (const [code, status, errorCode] of [
    ["EXPIRED50", 400, "INVALID_COUPON"],
    ["MAXUSED", 400, "COUPON_EXHAUSTED"],
    ["NOPE123", 400, "INVALID_COUPON"],
  ] as const) {
    test(`${code} cannot be applied`, async ({ api, cartApi, productApi, accessToken }) => {
      const product = await productApi.getProduct("dune");
      await cartApi.addItem(accessToken, product.id, 1);

      await expectError(await apply(api, accessToken, code), status, errorCode);
    });
  }

  test("Removing the coupon restores the totals", async ({
    api,
    cartApi,
    productApi,
    accessToken,
  }) => {
    const product = await productApi.getProduct("dune");
    await cartApi.addItem(accessToken, product.id, 2);
    const before = await cartApi.getCart(accessToken);

    await expectStatus(await apply(api, accessToken, "WELCOME10"), 200);
    const body = await expectStatus(await api.path("cart/coupon").auth(accessToken).deleteRequest(), 200);
    expect(body.message).toBe("Coupon removed");

    const after = await cartApi.getCart(accessToken);
    expect(after.coupon).toBeNull();
    expect(after.total).toBe(before.total);
  });
});
