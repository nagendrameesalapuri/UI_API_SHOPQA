import { test, expect } from "../../../fixtures/api.fixture";
import { orderSchema } from "../../../api/schemas/order.schema";
import { expectError, expectStatus } from "../../../utils/api-assertions";

// Not covered on purpose, because they change the shared environment for
// everyone: POST /qa/seed, POST /qa/reset, POST /qa/chaos and /qa/chaos/reset,
// and POST /products/bulk-import (needs an Excel upload).

test.describe("@API QA helpers", () => {
  test("Environment status reports record counts", async ({ api }) => {
    const body = await expectStatus(await api.path("qa/status").getRequest(), 200);
    expect(body.status).toBe("ok");
    for (const key of ["users", "products", "orders", "coupons", "reviews"]) {
      expect(Number(body.counts[key]), key).toBeGreaterThan(0);
    }
  });

  test("Chaos settings can be read", async ({ api }) => {
    const body = await expectStatus(await api.path("qa/chaos").getRequest(), 200);
    expect(body.chaos).toEqual({
      latencyMs: expect.any(Number),
      errorRate: expect.any(Number),
      errorStatus: expect.any(Number),
    });
  });

  test("Set stock and restore it", async ({ qaApi, productApi }) => {
    const product = await productApi.getProduct("monopoly-board-game");
    try {
      const body = await qaApi.setProductStock(product.id, 0);
      expect(body.product).toEqual({ id: product.id, name: product.name, stock: 0 });
      expect((await productApi.getProduct(product.id)).stock).toBe(0);
    } finally {
      await qaApi.setProductStock(product.id, product.stock);
    }
    expect((await productApi.getProduct(product.id)).stock).toBe(product.stock);
  });

  test("Verification token is available only while pending", async ({
    qaApi,
    authApi,
    pendingUser,
  }) => {
    const token = await qaApi.getVerificationToken(pendingUser.email);
    expect(token).toBe(pendingUser.verificationToken);

    await authApi.verifyEmail(token);
    await expect(qaApi.getVerificationToken(pendingUser.email)).rejects.toThrow("Status: 404");
  });

  test("Expire tokens signs the user out everywhere", async ({ api, authApi, qaApi, verifiedUser }) => {
    const login = await authApi.login({ email: verifiedUser.email, password: verifiedUser.password });

    const body = await qaApi.expireTokens(login.user.id);
    expect(body.message).toBe("All tokens revoked for user");

    const refresh = await api.path("auth/refresh").body({ refreshToken: login.refreshToken }).postRequest();
    await expectError(refresh, 401, "TOKEN_REVOKED");
  });

  test("Lock and unlock a user", async ({ api, authApi, verifiedUser }) => {
    const login = await authApi.login({ email: verifiedUser.email, password: verifiedUser.password });
    const lock = (locked: boolean) =>
      api.path(`qa/users/${login.user.id}/lock`).body({ lock: locked }).patchRequest();

    expect((await expectStatus(await lock(true), 200)).message).toBe("User locked");
    const refused = await api
      .path("auth/login")
      .body({ email: verifiedUser.email, password: verifiedUser.password })
      .postRequest();
    await expectError(refused, 403, "ACCOUNT_LOCKED");

    expect((await expectStatus(await lock(false), 200)).message).toBe("User unlocked");
    await authApi.login({ email: verifiedUser.email, password: verifiedUser.password });
  });

  test("Generate fake orders for a user", async ({ api, authApi, orderApi, verifiedUser }) => {
    const login = await authApi.login({ email: verifiedUser.email, password: verifiedUser.password });

    const body = await expectStatus(
      await api.path("qa/orders/generate").body({ userId: login.user.id, count: 2 }).postRequest(),
      200,
    );
    expect(body.message).toBe("Generated 2 orders");
    expect(body.orders).toHaveLength(2);

    const orders = await orderApi.getOrders(login.accessToken);
    expect(orders).toHaveLength(2);
    orders.forEach((order) => orderSchema.parse(order));
  });

  test("Mock a payment failure on an order", async ({
    api,
    orderApi,
    accessToken,
    placedOrder: { order },
  }) => {
    const body = await expectStatus(
      await api.path("qa/payment/mock").body({ outcome: "failure", orderId: order.id }).postRequest(),
      200,
    );
    expect(body).toMatchObject({ success: false, outcome: "failure" });

    expect((await orderApi.getOrder(accessToken, order.id)).payment_status).toBe("failed");
  });
});
