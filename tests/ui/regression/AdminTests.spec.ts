import { test, expect } from "../../../fixtures/ui.fixture";
import {
  DEFAULT_PASSWORD,
  EXISTING_USER_EMAIL,
} from "../../../test-data/users";
import { SAMPLE_PRODUCT_IMAGE } from "../../../test-data/images";

const uniqueName = (prefix: string) => `${prefix} ${Date.now()}`;

test.describe("Admin Tests", () => {
  test.describe.configure({ timeout: 150000 });

  test("@Regression TC-066 Customer cannot access admin", async ({
    loginPage,
    adminDashboardPage,
    authApi,
    adminApi,
  }) => {
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(EXISTING_USER_EMAIL, DEFAULT_PASSWORD);
    await loginPage.verifyUserIsLoggedIn();

    await adminDashboardPage.navigateToAdmin();
    await adminDashboardPage.verifyAccessDenied();

    await test.step("Admin API rejects the customer token", async () => {
      const { accessToken } = await authApi.login({
        email: EXISTING_USER_EMAIL,
        password: DEFAULT_PASSWORD,
      });
      const response = await adminApi.getDashboard(accessToken);
      expect(response.status()).toBe(403);
    });
  });

  test("@Regression TC-067 Create product", async ({
    adminProductsPage,
    productListPage,
    productsToDeactivate,
  }) => {
    const product = {
      name: uniqueName("QA Automation Lamp"),
      price: 2499,
      stock: 15,
      category: "Home & Kitchen",
      brand: "QA Brand",
      description: "Created by the TC-067 admin test.",
    };

    await adminProductsPage.navigateToProductsPage();
    const created = await adminProductsPage.createProduct(product);
    productsToDeactivate.push(created.id);

    await adminProductsPage.searchFor(product.name);
    await adminProductsPage.verifyProductRow(product.name, {
      category: product.category,
      price: "₹2,499",
      stock: product.stock,
    });

    await test.step("Product is visible in the storefront catalog", async () => {
      await productListPage.navigateToProductListPage();
      await productListPage.searchFor(product.name);
      await productListPage.verifyProductListed(product.name);
    });
  });

  test("@Regression TC-068 Edit and delete product", async ({
    adminProductsPage,
    productListPage,
    productDetailPage,
    adminApi,
    adminAccessToken,
    productApi,
    productsToDeactivate,
  }) => {
    const name = uniqueName("QA Automation Kettle");
    const created = await adminApi.createProduct(adminAccessToken, {
      name,
      price: 1500,
      stock: 10,
      categorySlug: "home-kitchen",
      brand: "QA Brand",
      description: "Created by the TC-068 admin test.",
    });
    productsToDeactivate.push(created.id);

    await adminProductsPage.navigateToProductsPage();
    await adminProductsPage.searchFor(name);

    await test.step("Edit price", async () => {
      await adminProductsPage.editPrice(name, 1299);
      await adminProductsPage.verifyProductRow(name, {
        category: "Home & Kitchen",
        price: "₹1,299",
        stock: 10,
      });
      expect((await productApi.getProduct(created.id)).price).toBe("1299.00");
    });

    await test.step("Delete product", async () => {
      await adminProductsPage.deleteProduct(name);
      productsToDeactivate.splice(productsToDeactivate.indexOf(created.id), 1);
      await adminProductsPage.verifyProductNotListed(name);
    });

    await test.step("Deleted product is gone from the catalog", async () => {
      await productListPage.navigateToProductListPage();
      await productListPage.searchFor(name);
      await productListPage.verifyProductNotListed(name);
    });
  });

  test("@Regression TC-069 Update order status", async ({
    loginPage,
    orderDetailPage,
    adminOrdersPage,
    verifiedUser,
    placedOrder: { order },
  }) => {
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
    await loginPage.verifyUserIsLoggedIn();
    await orderDetailPage.navigateToOrder(order.id);
    await orderDetailPage.verifyStatus("confirmed");
    await orderDetailPage.verifyLiveUpdatesConnected();

    await adminOrdersPage.navigateToOrdersPage();
    await adminOrdersPage.findOrder(order.order_number);
    await adminOrdersPage.updateStatus(order.order_number, "shipped");
    await adminOrdersPage.verifyStatus(order.order_number, "shipped");

    await test.step("Customer sees the update on the order detail", async () => {
      await orderDetailPage.verifyLiveStatusUpdate("shipped");
      await orderDetailPage.navigateToOrder(order.id);
      await orderDetailPage.verifyStatus("shipped");
    });
  });

  test("@Regression TC-070 Manage coupons and users", async ({
    loginPage,
    cartPage,
    adminCouponsPage,
    adminUsersPage,
    verifiedUser,
    checkoutCart,
    couponsToCleanUp,
  }) => {
    const coupon = {
      code: `QA${Date.now().toString().slice(-8)}`,
      type: "fixed" as const,
      value: 100,
      usageLimit: 5,
      minOrderAmount: 200,
    };

    await test.step("Admin creates a coupon", async () => {
      await adminCouponsPage.navigateToCouponsPage();
      await adminCouponsPage.createCoupon(coupon);
      couponsToCleanUp.push(coupon.code);
      await adminCouponsPage.verifyCouponActive(coupon.code);
    });

    await test.step("Customer can use the coupon in the cart", async () => {
      await loginPage.navigateToLoginPage();
      await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
      await loginPage.verifyUserIsLoggedIn();
      await cartPage.navigateToCartPage();
      await cartPage.verifyItemInCart(checkoutCart, 1);
      await cartPage.applyCoupon(coupon.code);
      await cartPage.verifyCouponApplied(coupon.code, coupon.value);
      // Release the coupon so cleanup can delete it
      await cartPage.removeCoupon();
      await loginPage.logout();
    });

    await test.step("Locked (banned) user cannot log in", async () => {
      await adminUsersPage.navigateToUsersPage();
      await adminUsersPage.findUser(verifiedUser.email);
      await adminUsersPage.banUser(verifiedUser.email);

      await loginPage.navigateToLoginPage();
      await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
      await loginPage.verifyLoginError("Account has been banned");
      await loginPage.verifyUserStaysOnLoginPage();
    });

    await test.step("Unlocked user can log in again", async () => {
      await adminUsersPage.unbanUser(verifiedUser.email);

      await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
      await loginPage.verifyUserIsLoggedIn();
    });
  });

  test("@Regression TC-071 Uploaded product image survives a backend restart", async ({
    request,
    adminProductsPage,
    productDetailPage,
    productsToDeactivate,
  }) => {
    test.info().annotations.push({
      type: "manual step",
      description:
        "Restarting/redeploying the backend cannot be triggered from the test. " +
        "The test proves the precondition instead: the image is served from " +
        "/api/products/images/:id (Postgres), not from the app server's disk.",
    });

    const name = uniqueName("QA Automation Poster");
    await adminProductsPage.navigateToProductsPage();
    const created = await adminProductsPage.createProduct({
      name,
      price: 799,
      stock: 5,
      category: "Books",
      brand: "QA Brand",
      description: "Created by the TC-071 admin test.",
      image: SAMPLE_PRODUCT_IMAGE,
    });
    productsToDeactivate.push(created.id);

    const imagePath: string = created.thumbnail;
    expect(imagePath).toMatch(/^\/api\/products\/images\/[0-9a-f-]{36}$/);

    await test.step("Image bytes are served from the database endpoint", async () => {
      const response = await request.get(`${process.env.API_BASE_URL}${imagePath}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("image/png");
      expect(Buffer.compare(await response.body(), SAMPLE_PRODUCT_IMAGE.buffer)).toBe(0);
    });

    await test.step("Image loads on the product page, also after a reload", async () => {
      await productDetailPage.navigateToProduct(created.slug, name);
      await productDetailPage.verifyMainImageLoaded(imagePath);
      await productDetailPage.navigateToProduct(created.slug, name);
      await productDetailPage.verifyMainImageLoaded(imagePath);
    });
  });
});
