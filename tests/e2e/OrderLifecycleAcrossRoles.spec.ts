import { test, expect } from "../../fixtures/ui.fixture";

test("@E2E TC-074 Order lifecycle across roles", async ({
  loginPage,
  checkoutPage,
  orderDetailPage,
  ordersPage,
  adminOrdersPage,
  orderApi,
  accessToken,
  verifiedUser,
  savedAddresses,
  checkoutCart,
}) => {
  const order = await test.step("Customer places a COD order", async () => {
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
    await loginPage.verifyUserIsLoggedIn();

    await checkoutPage.navigateToCheckoutPage();
    await checkoutPage.verifyAddressSelected(savedAddresses.home.id);
    await checkoutPage.continueToPayment();
    await checkoutPage.payByCashOnDelivery();
    const response = await checkoutPage.placeOrder();
    expect(response.status()).toBe(201);
    return (await response.json()).order;
  });

  await orderDetailPage.navigateToOrder(order.id);
  await orderDetailPage.verifyStatus("confirmed");
  await orderDetailPage.verifyLiveUpdatesConnected();

  await adminOrdersPage.navigateToOrdersPage();
  await adminOrdersPage.findOrder(order.order_number);

  for (const status of ["shipped", "delivered"]) {
    await test.step(`Admin marks the order ${status}; customer sees it live`, async () => {
      await adminOrdersPage.updateStatus(order.order_number, status);
      // The customer page is not reloaded: the change has to arrive on its own
      await orderDetailPage.verifyLiveStatusUpdate(status);
    });
  }

  await test.step("Customer requests a return", async () => {
    // The storefront has no "Return" button, so the request goes through the API
    const response = await orderApi.requestReturn(accessToken, order.id, "Changed my mind");
    expect(response.status()).toBe(200);

    await orderDetailPage.navigateToOrder(order.id);
    await orderDetailPage.verifyStatus("return_requested");
    await ordersPage.navigateToOrdersPage();
    await ordersPage.verifyOrderListed(order.order_number, "return_requested");
  });
});
