import { readFileSync } from "node:fs";
import { test, expect } from "../../../fixtures/ui.fixture";
import { extractPdfText } from "../../../utils/pdf-text";

// Stock is asserted in this file, so buy a product the other suites leave alone
test.use({ orderProductSlug: "yoga-mat-premium" });

test.describe("Order Tests", () => {
  test.describe.configure({ timeout: 120000 });

  // Every test starts logged in, with one COD order already placed via the API
  test.beforeEach(async ({ loginPage, verifiedUser, placedOrder }) => {
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
    await loginPage.verifyUserIsLoggedIn();
  });

  test("@Regression TC-056 Cancel a pending order", async ({
    orderDetailPage,
    adminApi,
    adminAccessToken,
    orderApi,
    productApi,
    accessToken,
    placedOrder: { order, productId },
  }) => {
    // New orders start out "confirmed"; put this one back to pending first
    await adminApi.updateOrderStatus(adminAccessToken, order.id, "pending");
    const stockWithOrder = (await productApi.getProduct(productId)).stock;

    await orderDetailPage.navigateToOrder(order.id);
    await orderDetailPage.verifyStatus("pending");
    await orderDetailPage.cancelOrder();

    await orderDetailPage.verifyStatus("cancelled");
    await orderDetailPage.verifyCancelUnavailable();
    expect((await orderApi.getOrder(accessToken, order.id)).status).toBe("cancelled");
    expect((await productApi.getProduct(productId)).stock).toBe(stockWithOrder + 1);
  });

  test("@Regression TC-057 Return a delivered order", async ({
    orderDetailPage,
    adminApi,
    adminAccessToken,
    orderApi,
    accessToken,
    placedOrder: { order },
  }) => {
    await adminApi.updateOrderStatus(adminAccessToken, order.id, "delivered");

    await orderDetailPage.navigateToOrder(order.id);
    await orderDetailPage.verifyStatus("delivered");

    // The storefront offers no "Return" button, so the request goes through the API
    const response = await orderApi.requestReturn(accessToken, order.id, "Damaged on arrival");
    expect(response.status()).toBe(200);

    await orderDetailPage.navigateToOrder(order.id);
    await orderDetailPage.verifyStatus("return_requested");
    expect((await orderApi.getOrder(accessToken, order.id)).status).toBe(
      "return_requested",
    );
  });

  test("@Regression TC-058 Download invoice", async ({
    orderDetailPage,
    verifiedUser,
    placedOrder: { order, productName },
  }) => {
    await orderDetailPage.navigateToOrder(order.id);

    const download = await orderDetailPage.downloadInvoice();
    expect(download.suggestedFilename()).toBe(`invoice-${order.order_number}.pdf`);

    const pdf = readFileSync(await download.path());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    // Lines can split mid-value inside the PDF, so compare on single-spaced text
    const invoice = extractPdfText(pdf).replace(/\s+/g, " ");
    expect(invoice).toContain(`Order Number: ${order.order_number}`);
    expect(invoice).toContain(`Status: ${order.status}`);
    expect(invoice).toContain(`${verifiedUser.firstName} ${verifiedUser.lastName}`);
    expect(invoice).toContain(verifiedUser.email);
    expect(invoice).toContain(`${productName} 1 Rs.`);
    // The invoice groups thousands, e.g. "Rs. 2,948.82"
    const total = Number(order.total).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
    });
    expect(invoice).toContain(`Total: Rs. ${total}`);
  });
});
