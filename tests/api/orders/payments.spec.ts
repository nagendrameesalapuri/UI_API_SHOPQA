import { test, expect } from "../../../fixtures/api.fixture";
import {
  createOrderResponseSchema,
  paymentFailedResponseSchema,
} from "../../../api/schemas/order.schema";
import { expectError, expectStatus } from "../../../utils/api-assertions";
import { buildAddress } from "../../../test-data/users";
import { cardPayment, TEST_CARDS } from "../../../test-data/api";

// Every test buys one copy of the checkoutCart product; successful orders are
// cancelled afterwards so their stock goes back

test.describe("@API Payments", () => {
  const checkout = (
    api: import("../../../utils/request-handler").RequestHandler,
    token: string,
    payment: object,
  ) =>
    api
      .path("orders")
      .auth(token)
      .body({ shippingAddress: buildAddress(), ...payment })
      .postRequest();

  const successfulPayments = [
    ["Card 4111 (success)", cardPayment(TEST_CARDS.success), "credit_card"],
    ["UPI", { paymentMethod: "upi", paymentData: { upiId: "qa.automation@upi" } }, "upi"],
    ["PayPal", { paymentMethod: "paypal" }, "paypal"],
  ] as const;

  for (const [label, payment, method] of successfulPayments) {
    test(`${label} is paid`, async ({ api, orderApi, cartApi, accessToken, checkoutCart }) => {
      const { order } = createOrderResponseSchema.parse(
        await expectStatus(await checkout(api, accessToken, payment), 201),
      );
      await orderApi.cancelOrder(accessToken, order.id);

      expect(order.payment_method).toBe(method);
      expect(order.payment_status).toBe("paid");
      expect((await cartApi.getCart(accessToken)).items).toHaveLength(0);
    });
  }

  const declines = [
    ["Card 4000…0002", cardPayment(TEST_CARDS.insufficientFunds), "INSUFFICIENT_FUNDS", "Payment declined. Insufficient funds."],
    ["Card 4000…0069", cardPayment(TEST_CARDS.expired), "EXPIRED_CARD", "Card expired."],
    // The API docs list 9995 as "do not honor"; today it answers INSUFFICIENT_FUNDS
    ["Card 4000…9995", cardPayment(TEST_CARDS.doNotHonor), "DO_NOT_HONOR", undefined],
    ["UPI fail@upi", { paymentMethod: "upi", paymentData: { upiId: "fail@upi" } }, "UPI_FAILED", "UPI payment failed"],
  ] as const;

  for (const [label, payment, paymentError, message] of declines) {
    test(`${label} is declined; no order, cart kept`, async ({
      api,
      orderApi,
      cartApi,
      accessToken,
      checkoutCart,
    }) => {
      const response = await checkout(api, accessToken, payment);
      expect(response.status()).toBe(402);
      const body = paymentFailedResponseSchema.parse(await response.json());
      expect(body.paymentError).toBe(paymentError);
      if (message) {
        expect(body.error).toBe(message);
      }

      expect(await orderApi.getOrders(accessToken)).toHaveLength(0);
      const cart = await cartApi.getCart(accessToken);
      expect(cart.items.map(({ name }) => name)).toEqual([checkoutCart]);
    });
  }

  test("Card payment without card details is refused", async ({
    api,
    orderApi,
    accessToken,
    checkoutCart,
  }) => {
    const response = await checkout(api, accessToken, { paymentMethod: "credit_card" });
    const orders = await orderApi.getOrders(accessToken);
    for (const order of orders) {
      await orderApi.cancelOrder(accessToken, order.id);
    }

    // Today: 201, and the order is marked paid without any card
    expect(response.status(), "no card details must not produce a paid order").not.toBe(201);
    await expectError(response, 400);
  });

  test("Cash on delivery leaves payment pending", async ({
    api,
    orderApi,
    accessToken,
    checkoutCart,
  }) => {
    const { order } = createOrderResponseSchema.parse(
      await expectStatus(await checkout(api, accessToken, { paymentMethod: "cod" }), 201),
    );
    await orderApi.cancelOrder(accessToken, order.id);

    expect(order.payment_method).toBe("cod");
    // Today: "paid", although nothing has been collected (same bug as UI TC-046)
    expect(order.payment_status).toBe("pending");
  });
});
