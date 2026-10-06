import { test, expect } from "../../../fixtures/api.fixture";
import { expectError, expectStatus } from "../../../utils/api-assertions";

// Stock is asserted here, so buy a product the other suites leave alone
const PRODUCT_SLUG = "car-seat-organizer";
test.use({ orderProductSlug: PRODUCT_SLUG });

test.describe("@API Order lifecycle", () => {
  test("Cancelling restores stock and cannot be repeated", async ({
    api,
    orderApi,
    productApi,
    accessToken,
    placedOrder: { order, productId },
  }) => {
    const stockWithOrder = (await productApi.getProduct(productId)).stock;

    await orderApi.cancelOrder(accessToken, order.id, "Ordered by mistake");

    const detail = await orderApi.getOrder(accessToken, order.id);
    expect(detail.status).toBe("cancelled");
    expect(detail.cancel_reason).toBe("Ordered by mistake");
    expect(detail.cancelled_at).not.toBeNull();
    expect((await productApi.getProduct(productId)).stock).toBe(stockWithOrder + 1);

    const again = await api.path(`orders/${order.id}/cancel`).auth(accessToken).body({}).postRequest();
    const body = await expectError(again, 400, "CANNOT_CANCEL");
    expect(body.error).toBe("Cannot cancel order in 'cancelled' status");
  });

  test("Shipped order cannot be cancelled", async ({
    api,
    adminApi,
    adminAccessToken,
    accessToken,
    placedOrder: { order },
  }) => {
    await adminApi.updateOrderStatus(adminAccessToken, order.id, "shipped");

    const response = await api.path(`orders/${order.id}/cancel`).auth(accessToken).body({}).postRequest();
    await expectError(response, 400, "CANNOT_CANCEL");
  });

  test("Only delivered orders can be returned", async ({
    adminApi,
    orderApi,
    adminAccessToken,
    accessToken,
    placedOrder: { order },
  }) => {
    const early = await orderApi.requestReturn(accessToken, order.id, "Too early");
    await expectError(early, 400, "CANNOT_RETURN");

    await adminApi.updateOrderStatus(adminAccessToken, order.id, "delivered");
    const response = await orderApi.requestReturn(accessToken, order.id, "Damaged on arrival");
    const body = await expectStatus(response, 200);
    expect(body.message).toBe("Return request submitted successfully");

    const detail = await orderApi.getOrder(accessToken, order.id);
    expect(detail.status).toBe("return_requested");
    expect(detail.return_reason).toBe("Damaged on arrival");
  });

  test("Each admin status change is recorded in the customer's history", async ({
    api,
    orderApi,
    adminAccessToken,
    accessToken,
    placedOrder: { order },
  }) => {
    for (const status of ["processing", "shipped", "delivered"]) {
      await expectStatus(
        await api
          .path(`orders/admin/${order.id}/status`)
          .auth(adminAccessToken)
          .body({ status, comment: `Moved to ${status}` })
          .putRequest(),
        200,
      );
    }

    const detail = await orderApi.getOrder(accessToken, order.id);
    expect(detail.status).toBe("delivered");
    expect(detail.history.map(({ status }) => status)).toEqual(
      expect.arrayContaining(["confirmed", "processing", "shipped", "delivered"]),
    );
  });
});
