import { test, expect } from "../../../fixtures/api.fixture";
import { orderListResponseSchema } from "../../../api/schemas/order.schema";
import { expectStatus } from "../../../utils/api-assertions";
import { UNKNOWN_ID } from "../../../test-data/api";

test.describe("@API Admin - orders", () => {
  test("Search finds a customer's order by number", async ({ api, adminAccessToken, placedOrder }) => {
    const { orders } = orderListResponseSchema
      .pick({ orders: true })
      .parse(
        await expectStatus(
          await api
            .path("orders/admin/all")
            .auth(adminAccessToken)
            .params({ search: placedOrder.order.order_number })
            .getRequest(),
          200,
        ),
      );
    expect(orders.map(({ id }) => id)).toEqual([placedOrder.order.id]);
  });

  test("Status filter returns only that status", async ({ api, adminAccessToken }) => {
    const { orders } = await expectStatus(
      await api.path("orders/admin/all").auth(adminAccessToken).params({ status: "cancelled" }).getRequest(),
      200,
    );
    expect(orders.every(({ status }: { status: string }) => status === "cancelled")).toBe(true);
  });

  test("Status update stores the tracking number", async ({
    api,
    orderApi,
    adminAccessToken,
    accessToken,
    placedOrder: { order },
  }) => {
    const body = await expectStatus(
      await api
        .path(`orders/admin/${order.id}/status`)
        .auth(adminAccessToken)
        .body({ status: "shipped", comment: "Dispatched via FedEx", trackingNumber: "FX123456789" })
        .putRequest(),
      200,
    );
    expect(body.order).toMatchObject({ status: "shipped", tracking_number: "FX123456789" });

    const detail = await orderApi.getOrder(accessToken, order.id);
    expect(detail.tracking_number).toBe("FX123456789");
    expect(detail.history.find(({ status }) => status === "shipped")?.comment).toBe(
      "Dispatched via FedEx",
    );
  });

  test("Invalid status is rejected with the list of valid ones", async ({
    api,
    adminAccessToken,
    placedOrder: { order },
  }) => {
    const body = await expectStatus(
      await api.path(`orders/admin/${order.id}/status`).auth(adminAccessToken).body({ status: "teleported" }).putRequest(),
      400,
    );
    expect(body.error).toBe("Invalid status");
    expect(body.validStatuses).toEqual(
      expect.arrayContaining(["pending", "confirmed", "shipped", "delivered", "cancelled"]),
    );
  });

  test("Unknown order returns 404", async ({ api, adminAccessToken }) => {
    const response = await api
      .path(`orders/admin/${UNKNOWN_ID}/status`)
      .auth(adminAccessToken)
      .body({ status: "shipped" })
      .putRequest();
    await expectStatus(response, 404);
  });
});
