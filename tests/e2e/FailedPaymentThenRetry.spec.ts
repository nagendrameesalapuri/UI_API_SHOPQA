import { test, expect } from "../../fixtures/ui.fixture";

const DECLINED_CARD = "4000000000000002";
const SUCCESS_CARD = "4111111111111111";

test("@E2E TC-075 Failed payment then successful retry", async ({
  loginPage,
  checkoutPage,
  ordersPage,
  orderApi,
  accessToken,
  verifiedUser,
  savedAddresses,
  checkoutCart,
}) => {
  await loginPage.navigateToLoginPage();
  await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
  await loginPage.verifyUserIsLoggedIn();

  await checkoutPage.navigateToCheckoutPage();
  await checkoutPage.verifyAddressSelected(savedAddresses.home.id);
  await checkoutPage.continueToPayment();

  await test.step("First attempt is declined", async () => {
    await checkoutPage.payByCard(DECLINED_CARD);
    const response = await checkoutPage.placeOrder();
    expect(response.status()).toBe(402);
    await checkoutPage.verifyPaymentFailed("Payment declined. Insufficient funds.");
  });

  const order = await test.step("Second attempt succeeds", async () => {
    await checkoutPage.backToPayment();
    await checkoutPage.payByCard(SUCCESS_CARD);
    const response = await checkoutPage.placeOrder();
    expect(response.status()).toBe(201);
    const { order } = await response.json();
    await checkoutPage.verifyOrderConfirmed(order.order_number);
    return order;
  });

  await test.step("Exactly one order was created", async () => {
    const orders = await orderApi.getOrders(accessToken);
    expect(orders.map(({ order_number }) => order_number)).toEqual([order.order_number]);

    await ordersPage.navigateToOrdersPage();
    await ordersPage.verifyOrderCount(1);
    await ordersPage.verifyOrderListed(order.order_number, "confirmed");
  });
});
