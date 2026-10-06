import { test, expect } from "../../fixtures/ui.fixture";
import { buildAddress, buildNewUser } from "../../test-data/users";

// Bought only by this journey, so the stock assertion is not disturbed by other suites
const PRODUCT_SLUG = "system-design-interview";
const SUCCESS_CARD = "4111111111111111";
const WELCOME_COUPON = "WELCOME10";

test("@E2E TC-072 Guest to first order (happy path)", async ({
  registerPage,
  emailVerificationPage,
  loginPage,
  productListPage,
  productDetailPage,
  cartPage,
  checkoutPage,
  ordersPage,
  qaApi,
  authApi,
  productApi,
  orderApi,
}) => {
  const user = buildNewUser();
  const product = await productApi.getProduct(PRODUCT_SLUG);

  await test.step("Register and verify email", async () => {
    await registerPage.navigateToRegisterPage();
    await registerPage.registerWith(user);
    await registerPage.verifyRegistrationSuccessful();

    const token = await qaApi.getVerificationToken(user.email);
    await emailVerificationPage.openVerificationLink(token);
    await emailVerificationPage.verifyEmailVerified();
  });

  await test.step("Log in", async () => {
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(user.email, user.password);
    await loginPage.verifyUserIsLoggedIn();
  });

  await test.step("Search for the product and add it to the cart", async () => {
    await productListPage.navigateToProductListPage();
    await productListPage.searchFor(product.name);
    await productListPage.openProduct(product.name);
    await productDetailPage.addToCart();
    await productDetailPage.verifyToast("Added to cart!");
  });

  await test.step(`Apply ${WELCOME_COUPON}`, async () => {
    await cartPage.navigateToCartPage();
    await cartPage.verifyItemInCart(product.name, 1);
    await cartPage.applyCoupon(WELCOME_COUPON);
    await cartPage.verifyCouponCodeApplied(WELCOME_COUPON);
  });

  const placedOrder = await test.step("Check out with the 4111 card", async () => {
    await cartPage.proceedToCheckout();
    await checkoutPage.fillShippingAddress(buildAddress());
    await checkoutPage.continueToPayment();
    await checkoutPage.payByCard(SUCCESS_CARD);

    const response = await checkoutPage.placeOrder();
    expect(response.status()).toBe(201);
    const { order } = await response.json();
    await checkoutPage.verifyOrderConfirmed(order.order_number);
    return order;
  });

  await test.step("Order is in the history with the 10% discount", async () => {
    await ordersPage.navigateToOrdersPage();
    await ordersPage.verifyOrderListed(placedOrder.order_number, "confirmed");

    const { accessToken } = await authApi.login({
      email: user.email,
      password: user.password,
    });
    const order = await orderApi.getOrder(accessToken, placedOrder.id);
    // WELCOME10 is 10% off the subtotal
    expect(order.coupon_id).not.toBeNull();
    expect(Number(order.discount_amt)).toBeCloseTo(Number(order.subtotal) * 0.1, 2);
  });

  await test.step("Stock is reduced", async () => {
    expect((await productApi.getProduct(PRODUCT_SLUG)).stock).toBe(product.stock - 1);
  });
});
