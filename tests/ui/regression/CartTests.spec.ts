import { test } from "../../../fixtures/ui.fixture";

test.describe("Cart Tests", () => {
  test.describe.configure({ timeout: 120000 });

  test("@Regression TC-030 Quantity cannot exceed stock", async ({
    loginPage,
    productDetailPage,
    cartPage,
    verifiedUser,
    lowStockProduct,
  }) => {
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
    await loginPage.verifyUserIsLoggedIn();

    await productDetailPage.navigateToProduct(
      lowStockProduct.slug,
      lowStockProduct.name,
    );

    await test.step("Quantity selector stops at available stock", async () => {
      await productDetailPage.increaseQuantity(lowStockProduct.stock + 2);
      await productDetailPage.verifyQuantityCappedAt(lowStockProduct.stock);
    });

    await test.step("Adding beyond stock is rejected", async () => {
      await productDetailPage.addToCart();
      await productDetailPage.verifyToast("Added to cart!");

      await productDetailPage.addToCart();
      await productDetailPage.verifyToast(
        `Only ${lowStockProduct.stock} items available`,
      );
    });

    await test.step("Cart quantity is capped at stock", async () => {
      await cartPage.navigateToCartPage();
      await cartPage.verifyQuantityCappedAtStock(
        lowStockProduct.name,
        lowStockProduct.stock,
      );
    });
  });

  test("@Regression TC-031 Cart persists after re-login", async ({
    loginPage,
    productDetailPage,
    cartPage,
    verifiedUser,
  }) => {
    const product = { slug: "atomic-habits", name: "Atomic Habits" };

    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
    await loginPage.verifyUserIsLoggedIn();

    await productDetailPage.navigateToProduct(product.slug, product.name);
    await productDetailPage.addToCart();
    await productDetailPage.verifyToast("Added to cart!");

    await loginPage.logout();
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
    await loginPage.verifyUserIsLoggedIn();

    await cartPage.navigateToCartPage();
    await cartPage.verifyItemInCart(product.name, 1);
  });
});
