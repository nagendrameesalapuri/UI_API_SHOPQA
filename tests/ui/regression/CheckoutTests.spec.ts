import { test, expect } from "../../../fixtures/ui.fixture";

const CARDS = {
  insufficientFunds: "4000000000000002",
  expired: "4000000000000069",
};
const FAILING_UPI_ID = "fail@upi";
const WORKING_UPI_ID = "qa.automation@upi";

test.describe("Checkout Tests", () => {
  test.describe.configure({ timeout: 120000 });

  // Every test starts logged in on the shipping step, with a Home (default)
  // and a Work address saved and one product in the cart
  test.beforeEach(
    async ({ loginPage, checkoutPage, verifiedUser, savedAddresses, checkoutCart }) => {
      await loginPage.navigateToLoginPage();
      await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
      await loginPage.verifyUserIsLoggedIn();
      await checkoutPage.navigateToCheckoutPage();
      // Saved addresses load after the page; acting earlier races the prefill
      await checkoutPage.verifyAddressSelected(savedAddresses.home.id);
      await checkoutPage.verifyShippingFormMatches(savedAddresses.home);
    },
  );

  test("@Regression TC-039 Pick a different saved address", async ({
    checkoutPage,
    savedAddresses: { home, work },
  }) => {
    await checkoutPage.verifyAddressSelected(home.id);
    await checkoutPage.verifyShippingFormMatches(home);

    await checkoutPage.selectSavedAddress(work.id);

    await checkoutPage.verifyAddressSelected(work.id);
    await checkoutPage.verifyShippingFormMatches(work);
  });

  test("@Regression TC-040 Override saved address with manual entry", async ({
    checkoutPage,
    addressApi,
    orderApi,
    accessToken,
    savedAddresses: { work },
  }) => {
    const typedCity = "Hubballi";

    await checkoutPage.selectSavedAddress(work.id);
    await checkoutPage.fillShippingField("city", typedCity);
    await checkoutPage.verifyNoAddressSelected();

    await checkoutPage.continueToPayment();
    await checkoutPage.payByCashOnDelivery();
    const response = await checkoutPage.placeOrder();
    expect(response.status()).toBe(201);

    await test.step("Typed value is used for the order", async () => {
      const [order] = await orderApi.getOrders(accessToken);
      expect(order.shipping_address.city).toBe(typedCity);
      expect(order.shipping_address.line1).toBe(work.line1);
    });

    await test.step("Saved address is left unchanged", async () => {
      const addresses = await addressApi.getAddresses(accessToken);
      const savedWork = addresses.find(({ id }) => id === work.id);
      expect(savedWork?.city).toBe(work.city);
    });
  });

  test("@Regression TC-041 Address validation", async ({
    checkoutPage,
    orderApi,
    accessToken,
  }) => {
    await test.step("Empty address is rejected", async () => {
      await checkoutPage.clearShippingForm();
      await checkoutPage.continueToNextStep();
      await checkoutPage.verifyToast("Please fill in all required fields");
      await checkoutPage.verifyStillOnShippingStep();
    });

    await test.step("Invalid pincode is rejected", async () => {
      await checkoutPage.fillShippingField("full-name", "QA Automation");
      await checkoutPage.fillShippingField("phone", "9876543210");
      await checkoutPage.fillShippingField("line1", "1 Test Street");
      await checkoutPage.fillShippingField("city", "Bengaluru");
      await checkoutPage.selectState("Karnataka");
      await checkoutPage.fillShippingField("postal", "12ab");
      await checkoutPage.continueToNextStep();
      await checkoutPage.verifyToast("Invalid postal code");
      await checkoutPage.verifyStillOnShippingStep();
    });

    expect(await orderApi.getOrders(accessToken)).toHaveLength(0);
  });

  test("@Regression TC-043 Pay with insufficient funds card", async ({
    checkoutPage,
    orderApi,
    cartApi,
    accessToken,
    checkoutCart,
  }) => {
    await checkoutPage.continueToPayment();
    await checkoutPage.payByCard(CARDS.insufficientFunds);

    const response = await checkoutPage.placeOrder();
    expect(response.status()).toBe(402);
    await checkoutPage.verifyPaymentFailed("Payment declined. Insufficient funds.");

    expect(await orderApi.getOrders(accessToken)).toHaveLength(0);
    const cart = await cartApi.getCart(accessToken);
    expect(cart.items.map(({ name }) => name)).toEqual([checkoutCart]);
  });

  test("@Regression TC-044 Pay with expired card", async ({
    checkoutPage,
    orderApi,
    accessToken,
  }) => {
    await checkoutPage.continueToPayment();
    await checkoutPage.payByCard(CARDS.expired);

    const response = await checkoutPage.placeOrder();
    expect(response.status()).toBe(402);
    await checkoutPage.verifyPaymentFailed("Card expired.");

    expect(await orderApi.getOrders(accessToken)).toHaveLength(0);
  });

  test("@Regression TC-045 UPI payment failure", async ({
    checkoutPage,
    orderApi,
    accessToken,
  }) => {
    await checkoutPage.continueToPayment();
    await checkoutPage.payByUpi(FAILING_UPI_ID);

    const failed = await checkoutPage.placeOrder();
    expect(failed.status()).toBe(402);
    await checkoutPage.verifyPaymentFailed("UPI payment failed");
    expect(await orderApi.getOrders(accessToken)).toHaveLength(0);

    await test.step("User can retry with another UPI ID", async () => {
      await checkoutPage.backToPayment();
      await checkoutPage.payByUpi(WORKING_UPI_ID);

      const retried = await checkoutPage.placeOrder();
      expect(retried.status()).toBe(201);
      const { order } = await retried.json();
      await checkoutPage.verifyOrderConfirmed(order.order_number);
    });
  });

  test("@Regression TC-046 Cash on delivery order", async ({
    checkoutPage,
    orderApi,
    accessToken,
  }) => {
    await checkoutPage.continueToPayment();
    await checkoutPage.payByCashOnDelivery();

    const response = await checkoutPage.placeOrder();
    expect(response.status()).toBe(201);
    const { order } = await response.json();
    await checkoutPage.verifyOrderConfirmed(order.order_number);

    const [savedOrder] = await orderApi.getOrders(accessToken);
    expect(savedOrder.order_number).toBe(order.order_number);
    expect(savedOrder.payment_method).toBe("cod");
    // Nothing has been collected yet, so payment must still be pending
    expect(savedOrder.payment_status).toBe("pending");
  });
});
