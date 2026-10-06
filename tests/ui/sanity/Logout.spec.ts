import { test } from "@playwright/test";
import { LoginPage } from "../../../pages/LoginPage";

test.describe("Authentication Tests", () => {
  test("@Sanity Login with valid credentials and Logout", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(
      process.env.UI_TEST_CUSTOMER_EMAIL!,
      process.env.UI_TEST_CUSTOMER_PASSWORD!,
    );
    await loginPage.verifyWelcomeToast();
    await loginPage.verifyUserIsLoggedIn();
    await loginPage.logout();
  });
});
