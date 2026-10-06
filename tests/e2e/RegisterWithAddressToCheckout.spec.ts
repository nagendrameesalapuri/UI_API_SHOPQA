import { test } from "../../fixtures/ui.fixture";
import { buildAddress, buildNewUser } from "../../test-data/users";

test("@E2E TC-073 Register with address straight to checkout", async ({
  registerPage,
  emailVerificationPage,
  loginPage,
  productDetailPage,
  checkoutPage,
  qaApi,
}) => {
  const user = buildNewUser();
  const address = buildAddress();

  await test.step("Register with the delivery address filled in", async () => {
    await registerPage.navigateToRegisterPage();
    await registerPage.fillAccountDetails(user);
    await registerPage.fillAddress(address);
    await registerPage.submit();
    await registerPage.verifyRegistrationSuccessful();

    const token = await qaApi.getVerificationToken(user.email);
    await emailVerificationPage.openVerificationLink(token);
    await emailVerificationPage.verifyEmailVerified();
  });

  await test.step("Log in and add a product to the cart", async () => {
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(user.email, user.password);
    await loginPage.verifyUserIsLoggedIn();

    await productDetailPage.navigateToProduct("atomic-habits", "Atomic Habits");
    await productDetailPage.addToCart();
    await productDetailPage.verifyToast("Added to cart!");
  });

  await test.step("Registered address is pre-selected at checkout", async () => {
    await checkoutPage.navigateToCheckoutPage();
    await checkoutPage.verifyOnlySavedAddressSelected();
    await checkoutPage.verifyShippingFormMatchesAddress(address);
  });

  await test.step("Shipping step continues without re-entering anything", async () => {
    await checkoutPage.continueToPayment();
  });
});
