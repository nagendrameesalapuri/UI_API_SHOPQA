import { test, expect } from "../../../fixtures/api.fixture";
import { couponSchema } from "../../../api/schemas/coupon.schema";
import { expectError, expectStatus } from "../../../utils/api-assertions";

const uniqueCode = () => `QAAPI${Date.now().toString().slice(-7)}`;

test.describe("@API Admin - coupons", () => {
  test("Create a coupon; customers can use it until it is disabled", async ({
    api,
    cartApi,
    productApi,
    adminAccessToken,
    accessToken,
    couponsToCleanUp,
  }) => {
    const code = uniqueCode();
    const created = await expectStatus(
      await api
        .path("admin/coupons")
        .auth(adminAccessToken)
        .body({ code, type: "percentage", value: 15, usageLimit: 3, minOrderAmt: 100, maxDiscount: 50 })
        .postRequest(),
      201,
    );
    couponsToCleanUp.push(code);
    const coupon = couponSchema.parse(created.coupon);
    expect(coupon).toMatchObject({
      code,
      type: "percentage",
      value: "15.00",
      min_order_amt: "100.00",
      max_discount: "50.00",
      usage_limit: 3,
      usage_count: 0,
      is_active: true,
    });

    await test.step("Customer applies it; the discount is capped at ₹50", async () => {
      const product = await productApi.getProduct("dune");
      await cartApi.addItem(accessToken, product.id, 1);
      const applied = await expectStatus(
        await api.path("cart/coupon").auth(accessToken).body({ code }).postRequest(),
        200,
      );
      // 15% of 599 is 89.85, above the cap
      expect(applied.coupon.discount).toBe(50);
      await expectStatus(await api.path("cart/coupon").auth(accessToken).deleteRequest(), 200);
    });

    await test.step("Disabled coupon is no longer valid", async () => {
      const updated = await expectStatus(
        await api.path(`admin/coupons/${coupon.id}`).auth(adminAccessToken).body({ isActive: false }).putRequest(),
        200,
      );
      expect(updated.coupon.is_active).toBe(false);

      const validate = await api.path(`coupons/validate/${code}`).auth(accessToken).getRequest();
      await expectError(validate, 404, "INVALID_COUPON");
    });

    await test.step("Unused coupon can be deleted", async () => {
      const deleted = await expectStatus(
        await api.path(`admin/coupons/${coupon.id}`).auth(adminAccessToken).deleteRequest(),
        200,
      );
      expect(deleted.message).toBe("Coupon deleted");
    });
  });

  test("Duplicate code is rejected with 409", async ({ api, adminAccessToken }) => {
    const response = await api
      .path("admin/coupons")
      .auth(adminAccessToken)
      .body({ code: "WELCOME10", type: "fixed", value: 10 })
      .postRequest();
    // Today: 500 with a raw unique-constraint error
    await expectError(response, 409);
  });

  test("Missing type and value are rejected with 400", async ({ api, adminAccessToken }) => {
    const response = await api
      .path("admin/coupons")
      .auth(adminAccessToken)
      .body({ code: uniqueCode() })
      .postRequest();
    // Today: 500 with a raw not-null error
    await expectError(response, 400);
  });
});
