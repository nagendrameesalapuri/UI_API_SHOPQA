import { test, expect } from "../../../fixtures/api.fixture";
import {
  createOrderResponseSchema,
  invoiceResponseSchema,
} from "../../../api/schemas/order.schema";
import { expectError, expectStatus } from "../../../utils/api-assertions";
import { extractPdfText } from "../../../utils/pdf-text";
import { buildAddress } from "../../../test-data/users";
import { roundMoney, STANDARD_SHIPPING, TAX_RATE, UNKNOWN_ID } from "../../../test-data/api";

// Stock is asserted here, so buy a product the other suites leave alone
const PRODUCT_SLUG = "resistance-bands-set";
test.use({ orderProductSlug: PRODUCT_SLUG });

test.describe("@API Orders - checkout", () => {
  test("Checkout with an empty cart is refused", async ({ api, accessToken }) => {
    const response = await api
      .path("orders")
      .auth(accessToken)
      .body({ shippingAddress: buildAddress(), paymentMethod: "cod" })
      .postRequest();
    await expectError(response, 400, "EMPTY_CART");
  });

  test("Checkout requires address and payment method", async ({
    api,
    accessToken,
    checkoutCart,
  }) => {
    const response = await api
      .path("orders")
      .auth(accessToken)
      .body({ paymentMethod: "cod" })
      .postRequest();
    // Today the body is { error } with no code
    await expectError(response, 400);
  });

  test("Unknown payment method is rejected with 400", async ({
    api,
    accessToken,
    checkoutCart,
  }) => {
    const response = await api
      .path("orders")
      .auth(accessToken)
      .body({ shippingAddress: buildAddress(), paymentMethod: "bitcoin" })
      .postRequest();
    // Today: 500 with a raw database enum error
    await expectError(response, 400);
  });

  test("COD order: totals, cart emptied, stock reduced", async ({
    api,
    cartApi,
    productApi,
    orderApi,
    accessToken,
  }) => {
    const product = await productApi.getProduct(PRODUCT_SLUG);
    await cartApi.addItem(accessToken, product.id, 2);

    const created = createOrderResponseSchema.parse(
      await expectStatus(
        await api
          .path("orders")
          .auth(accessToken)
          .body({
            shippingAddress: buildAddress(),
            paymentMethod: "cod",
            deliveryMethod: "standard",
          })
          .postRequest(),
        201,
      ),
    );
    const { order } = created;
    expect(created.message).toBe("Order placed successfully");
    expect(order.status).toBe("confirmed");

    await test.step("Totals add up", async () => {
      const subtotal = Number(product.price) * 2;
      const shipping = subtotal >= 500 ? 0 : STANDARD_SHIPPING;
      const tax = roundMoney(subtotal * TAX_RATE);
      expect(Number(order.subtotal)).toBe(subtotal);
      expect(Number(order.shipping_cost)).toBe(shipping);
      expect(Number(order.tax_amt)).toBeCloseTo(tax, 2);
      expect(Number(order.total)).toBeCloseTo(subtotal + shipping + tax, 2);
    });

    await test.step("Cart is emptied and stock reduced", async () => {
      expect((await cartApi.getCart(accessToken)).items).toHaveLength(0);
      expect((await productApi.getProduct(PRODUCT_SLUG)).stock).toBe(product.stock - 2);
    });

    await test.step("Order is listed with its items and history", async () => {
      const orders = await orderApi.getOrders(accessToken);
      expect(orders.map(({ id }) => id)).toEqual([order.id]);

      const detail = await orderApi.getOrder(accessToken, order.id);
      expect(detail.items).toHaveLength(1);
      expect(detail.items[0]).toMatchObject({
        product_id: product.id,
        quantity: 2,
      });
      expect(detail.history.map(({ status }) => status)).toContain("confirmed");
    });

    await orderApi.cancelOrder(accessToken, order.id);
  });

  // Store pickup is shown as FREE in checkout
  for (const [method, cost] of [
    ["standard", 49],
    ["express", 149],
    ["overnight", 299],
    ["pickup", 0],
  ] as const) {
    test(`Delivery "${method}" costs ₹${cost} below the free-shipping threshold`, async ({
      api,
      cartApi,
      productApi,
      orderApi,
      accessToken,
    }) => {
      const product = await productApi.getProduct("atomic-habits");
      await cartApi.addItem(accessToken, product.id, 1);

      const { order } = createOrderResponseSchema.parse(
        await expectStatus(
          await api
            .path("orders")
            .auth(accessToken)
            .body({
              shippingAddress: buildAddress(),
              paymentMethod: "cod",
              deliveryMethod: method,
            })
            .postRequest(),
          201,
        ),
      );
      await orderApi.cancelOrder(accessToken, order.id);

      expect(order.delivery_method).toBe(method);
      // Today pickup is charged ₹49
      expect(Number(order.shipping_cost)).toBe(cost);
    });
  }
});

test.describe("@API Orders - reading", () => {
  test("Orders can be filtered by status", async ({ api, accessToken, placedOrder }) => {
    const confirmed = await expectStatus(
      await api.path("orders").auth(accessToken).params({ status: "confirmed" }).getRequest(),
      200,
    );
    expect(confirmed.orders.map(({ id }: { id: string }) => id)).toEqual([placedOrder.order.id]);

    const cancelled = await expectStatus(
      await api.path("orders").auth(accessToken).params({ status: "cancelled" }).getRequest(),
      200,
    );
    expect(cancelled.orders).toHaveLength(0);
  });

  test("Tracking returns the order and its timeline", async ({ api, accessToken, placedOrder }) => {
    const body = await expectStatus(
      await api.path(`orders/${placedOrder.order.id}/track`).auth(accessToken).getRequest(),
      200,
    );
    expect(body.tracking.order_number).toBe(placedOrder.order.order_number);
    expect(body.tracking.status).toBe("confirmed");
  });

  test("Invoice JSON matches the order", async ({
    api,
    accessToken,
    verifiedUser,
    placedOrder,
  }) => {
    const { invoice } = invoiceResponseSchema.parse(
      await expectStatus(
        await api.path(`orders/${placedOrder.order.id}/invoice`).auth(accessToken).getRequest(),
        200,
      ),
    );
    expect(invoice.order.order_number).toBe(placedOrder.order.order_number);
    expect(invoice.order.total).toBe(placedOrder.order.total);
    expect(invoice.order.email).toBe(verifiedUser.email);
    expect(invoice.items.map(({ product_name }) => product_name)).toEqual([
      placedOrder.productName,
    ]);
  });

  test("Invoice PDF downloads with the order number", async ({ api, accessToken, placedOrder }) => {
    const { order } = placedOrder;
    const response = await api
      .path(`orders/${order.id}/invoice/pdf`)
      .auth(accessToken)
      .getRequest();

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect(response.headers()["content-disposition"]).toBe(
      `attachment; filename="invoice-${order.order_number}.pdf"`,
    );
    const text = extractPdfText(await response.body()).replace(/\s+/g, " ");
    expect(text).toContain(`Order Number: ${order.order_number}`);
    expect(text).toContain(placedOrder.productName);
  });

  test("Unknown order returns 404", async ({ api, accessToken }) => {
    await expectStatus(await api.path(`orders/${UNKNOWN_ID}`).auth(accessToken).getRequest(), 404);
  });

  test("Another user's order is invisible to them", async ({ api, secondUser, placedOrder }) => {
    const { id } = placedOrder.order;
    for (const [label, send] of [
      ["detail", () => api.path(`orders/${id}`).auth(secondUser.accessToken).getRequest()],
      ["track", () => api.path(`orders/${id}/track`).auth(secondUser.accessToken).getRequest()],
      ["invoice", () => api.path(`orders/${id}/invoice`).auth(secondUser.accessToken).getRequest()],
      [
        "cancel",
        () => api.path(`orders/${id}/cancel`).auth(secondUser.accessToken).body({}).postRequest(),
      ],
    ] as const) {
      await test.step(label, async () => {
        await expectStatus(await send(), 404);
      });
    }
  });

  test("Orders require login", async ({ api }) => {
    await expectError(await api.path("orders").getRequest(), 401, "MISSING_TOKEN");
  });
});
