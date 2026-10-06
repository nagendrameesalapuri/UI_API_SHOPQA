import { test, expect } from "../../../fixtures/api.fixture";
import { buildAddress } from "../../../test-data/users";
import { errorResponseSchema } from "../../../api/schemas/common.schema";
import { applyCouponResponseSchema } from "../../../api/schemas/cart.schema";
import {
  invoiceResponseSchema,
  paymentFailedResponseSchema,
} from "../../../api/schemas/order.schema";

// Every API client parses its responses with the matching zod schema, so calling
// a client method is itself the contract check; .parse() throws on any mismatch.
// Endpoints without a client method are parsed explicitly below.

const API = process.env.API_BASE_URL!;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

test.describe("API schema contracts", () => {
  test.describe.configure({ timeout: 90000 });

  test("Catalog endpoints match their schemas", async ({ productApi, reviewApi }) => {
    const list = await productApi.listProducts({ page: 1, limit: 5 });
    expect(list.products.length).toBeGreaterThan(0);

    const product = await productApi.getProduct(list.products[0].slug);
    expect(product.id).toBe(list.products[0].id);

    const categories = await productApi.getCategories();
    expect(categories.length).toBeGreaterThan(0);

    const reviews = await reviewApi.getReviews(product.id);
    expect(reviews.page).toBe(1);
  });

  test("Customer endpoints match their schemas", async ({
    request,
    userApi,
    addressApi,
    cartApi,
    wishlistApi,
    orderApi,
    productApi,
    accessToken,
    verifiedUser,
  }) => {
    const profile = await userApi.getProfile(accessToken);
    expect(profile.email).toBe(verifiedUser.email);

    await addressApi.addAddress(accessToken, buildAddress(), true);
    expect(await addressApi.getAddresses(accessToken)).toHaveLength(1);

    const product = await productApi.getProduct("atomic-habits");
    await wishlistApi.addItem(accessToken, product.id);
    expect(await wishlistApi.getWishlist(accessToken)).toHaveLength(1);

    await cartApi.addItem(accessToken, product.id, 1);
    const applied = await request.post(`${API}/api/cart/coupon`, {
      headers: bearer(accessToken),
      data: { code: "WELCOME10" },
    });
    expect(applied.status()).toBe(200);
    applyCouponResponseSchema.parse(await applied.json());
    expect((await cartApi.getCart(accessToken)).coupon?.code).toBe("WELCOME10");

    const order = await orderApi.placeCodOrder(accessToken, buildAddress());
    expect(await orderApi.getOrders(accessToken)).toHaveLength(1);
    const detail = await orderApi.getOrder(accessToken, order.id);
    expect(detail.items[0].product_name).toBe(product.name);

    const invoice = await request.get(`${API}/api/orders/${order.id}/invoice`, {
      headers: bearer(accessToken),
    });
    expect(invoice.status()).toBe(200);
    invoiceResponseSchema.parse(await invoice.json());
  });

  test("Admin endpoints match their schemas", async ({
    adminApi,
    adminAccessToken,
    placedOrder: { order },
    verifiedUser,
  }) => {
    const dashboard = await adminApi.getDashboardStats(adminAccessToken);
    expect(Number(dashboard.stats.total_products)).toBeGreaterThan(0);

    expect((await adminApi.getCoupons(adminAccessToken)).length).toBeGreaterThan(0);

    const { users } = await adminApi.getUsers(adminAccessToken, verifiedUser.email);
    expect(users.map(({ email }) => email)).toContain(verifiedUser.email);

    const shipped = await adminApi.updateOrderStatus(adminAccessToken, order.id, "shipped");
    expect(shipped.status).toBe("shipped");
  });

  test("Error responses match the error schema", async ({
    request,
    adminApi,
    productApi,
    cartApi,
    qaApi,
    accessToken,
    verifiedUser,
  }) => {
    await test.step("400 invalid coupon", async () => {
      const response = await request.post(`${API}/api/cart/coupon`, {
        headers: bearer(accessToken),
        data: { code: "EXPIRED50" },
      });
      expect(response.status()).toBe(400);
      expect(errorResponseSchema.parse(await response.json()).code).toBe("INVALID_COUPON");
    });

    await test.step("401 wrong current password", async () => {
      const response = await request.put(`${API}/api/users/password`, {
        headers: bearer(accessToken),
        data: { currentPassword: "WrongPassword1!", newPassword: "NewPassword456!" },
      });
      expect(response.status()).toBe(401);
      expect(errorResponseSchema.parse(await response.json()).code).toBe("INVALID_PASSWORD");
    });

    await test.step("402 declined payment", async () => {
      const product = await productApi.getProduct("atomic-habits");
      await cartApi.addItem(accessToken, product.id, 1);
      const response = await request.post(`${API}/api/orders`, {
        headers: bearer(accessToken),
        data: {
          shippingAddress: buildAddress(),
          paymentMethod: "credit_card",
          paymentData: {
            cardNumber: "4000000000000002",
            expiry: "12/30",
            cvv: "123",
            name: "QA AUTOMATION",
          },
        },
      });
      expect(response.status()).toBe(402);
      const body = paymentFailedResponseSchema.parse(await response.json());
      expect(body.paymentError).toBe("INSUFFICIENT_FUNDS");
    });

    await test.step("403 customer on an admin endpoint", async () => {
      const response = await adminApi.getDashboard(accessToken);
      expect(response.status()).toBe(403);
      errorResponseSchema.parse(await response.json());
    });

    await test.step("404 no pending verification", async () => {
      await expect(qaApi.getVerificationToken(verifiedUser.email)).rejects.toThrow(
        "Status: 404",
      );
    });
  });
});
