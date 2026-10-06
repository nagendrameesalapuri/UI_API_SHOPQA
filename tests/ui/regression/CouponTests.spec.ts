import { test, expect } from "../../../fixtures/ui.fixture";

const FLAT_COUPON = { code: "FLAT500", discount: 500 };
const EXPIRED_COUPON = "EXPIRED50";
const EXHAUSTED_COUPON = "MAXUSED";

test.describe("Coupon Tests", () => {
  test.describe.configure({ timeout: 120000 });

  // Every test starts logged in on a cart that meets FLAT500's ₹2000 minimum
  test.beforeEach(async ({ loginPage, cartPage, verifiedUser, userWithCart }) => {
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
    await loginPage.verifyUserIsLoggedIn();
    await cartPage.navigateToCartPage();
    await cartPage.verifyItemInCart(userWithCart.productName, 4);
  });

  test("@Regression TC-033 Apply flat coupon FLAT500", async ({
    cartPage,
    cartApi,
    userWithCart,
  }) => {
    const before = await cartPage.getTotals();

    await cartPage.applyCoupon(FLAT_COUPON.code);
    await cartPage.verifyCouponApplied(FLAT_COUPON.code, FLAT_COUPON.discount);

    const after = await cartPage.getTotals();
    expect(after.subtotal).toBe(before.subtotal);
    expect(after.discount).toBe(FLAT_COUPON.discount);
    // 500 comes off the pre-tax amount; GST is then charged on the reduced amount
    expect(after.total - after.tax).toBeCloseTo(
      before.total - before.tax - FLAT_COUPON.discount,
      2,
    );

    const cart = await cartApi.getCart(userWithCart.accessToken);
    expect(cart.coupon?.code).toBe(FLAT_COUPON.code);
    expect(after.total).toBeCloseTo(cart.total, 2);
  });

  test("@Regression TC-034 Apply expired coupon", async ({ cartPage }) => {
    const before = await cartPage.getTotals();

    await cartPage.applyCoupon(EXPIRED_COUPON);
    await cartPage.verifyCouponError("Invalid or expired coupon");

    expect(await cartPage.getTotals()).toEqual(before);
  });

  test("@Regression TC-035 Apply exhausted coupon", async ({ cartPage }) => {
    const before = await cartPage.getTotals();

    await cartPage.applyCoupon(EXHAUSTED_COUPON);
    await cartPage.verifyCouponError("Coupon usage limit reached");

    expect(await cartPage.getTotals()).toEqual(before);
  });

  test("@Regression TC-036 Remove applied coupon", async ({
    cartPage,
    cartApi,
    userWithCart,
  }) => {
    const before = await cartPage.getTotals();

    await cartPage.applyCoupon(FLAT_COUPON.code);
    await cartPage.verifyCouponApplied(FLAT_COUPON.code, FLAT_COUPON.discount);

    await cartPage.removeCoupon();

    expect(await cartPage.getTotals()).toEqual(before);
    const cart = await cartApi.getCart(userWithCart.accessToken);
    expect(cart.coupon).toBeNull();
    expect(cart.discount).toBe(0);
  });
});
