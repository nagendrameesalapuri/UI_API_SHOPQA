import { test, expect } from "../../fixtures/ui.fixture";

// Bought only by this journey, so the stock assertions are not disturbed by other suites
const PRODUCT_SLUG = "jbl-flip-6";

test("@E2E TC-076 Wishlist to purchase", async ({
  loginPage,
  productDetailPage,
  wishlistPage,
  checkoutPage,
  orderDetailPage,
  productApi,
  verifiedUser,
  savedAddresses,
}) => {
  const product = await productApi.getProduct(PRODUCT_SLUG);

  await loginPage.navigateToLoginPage();
  await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
  await loginPage.verifyUserIsLoggedIn();

  await test.step("Wishlist the product", async () => {
    await productDetailPage.navigateToProduct(product.slug, product.name);
    await productDetailPage.addToWishlist();
  });

  await test.step("Move it from the wishlist to the cart", async () => {
    await wishlistPage.navigateToWishlistPage();
    await wishlistPage.verifyItemInWishlist(product.name);
    await wishlistPage.addToCart(product.name);
    await wishlistPage.verifyCartBadge(1);
  });

  const order = await test.step("Check out with cash on delivery", async () => {
    await checkoutPage.navigateToCheckoutPage();
    await checkoutPage.verifyAddressSelected(savedAddresses.home.id);
    await checkoutPage.continueToPayment();
    await checkoutPage.payByCashOnDelivery();
    const response = await checkoutPage.placeOrder();
    expect(response.status()).toBe(201);
    const { order } = await response.json();
    await checkoutPage.verifyOrderConfirmed(order.order_number);
    return order;
  });

  expect((await productApi.getProduct(PRODUCT_SLUG)).stock).toBe(product.stock - 1);

  await test.step("Cancel the order; stock is restored", async () => {
    await orderDetailPage.navigateToOrder(order.id);
    await orderDetailPage.cancelOrder();
    await orderDetailPage.verifyStatus("cancelled");

    expect((await productApi.getProduct(PRODUCT_SLUG)).stock).toBe(product.stock);
  });
});
