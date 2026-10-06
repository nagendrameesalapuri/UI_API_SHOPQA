import { test, expect } from "../../../fixtures/ui.fixture";

const STRONG_NEW_PASSWORD = "NewPassword456!";

test.describe("Profile & Wishlist Tests", () => {
  test.describe.configure({ timeout: 120000 });

  test.beforeEach(async ({ loginPage, verifiedUser }) => {
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
    await loginPage.verifyUserIsLoggedIn();
  });

  test("@Regression TC-059 Update profile", async ({
    page,
    profilePage,
    userApi,
    accessToken,
    verifiedUser,
  }) => {
    const firstName = "Updated";
    const lastName = `Name${Date.now()}`;

    await profilePage.navigateToProfilePage(verifiedUser.email);
    // The profile form has no phone field, so only the name can be changed here
    await profilePage.updateName(firstName, lastName);
    await profilePage.verifyToast("Profile updated");

    const saved = await userApi.getProfile(accessToken);
    expect(saved.first_name).toBe(firstName);
    expect(saved.last_name).toBe(lastName);

    await page.reload();
    await profilePage.navigateToProfilePage(verifiedUser.email);
    await profilePage.verifyName(firstName, lastName);
  });

  test("@Regression TC-061 Change password with wrong current password", async ({
    profilePage,
    authApi,
    verifiedUser,
  }) => {
    await profilePage.navigateToProfilePage(verifiedUser.email);
    await profilePage.openSecurityTab();

    const response = await profilePage.changePassword(
      "WrongPassword1!",
      STRONG_NEW_PASSWORD,
    );
    expect(response.status()).toBe(401);
    expect((await response.json()).code).toBe("INVALID_PASSWORD");
    await profilePage.verifyCurrentPasswordError("Current password is incorrect");

    await test.step("Password is unchanged", async () => {
      await authApi.login({ email: verifiedUser.email, password: verifiedUser.password });
      await expect(
        authApi.login({ email: verifiedUser.email, password: STRONG_NEW_PASSWORD }),
      ).rejects.toThrow("Login failed. Status: 401");
    });
  });

  test("@Regression TC-062 Change password with weak new password", async ({
    profilePage,
    authApi,
    verifiedUser,
  }) => {
    await profilePage.navigateToProfilePage(verifiedUser.email);
    await profilePage.openSecurityTab();

    await test.step("'abc123' (too short, no uppercase) is rejected", async () => {
      const requestSent = await profilePage.submitPasswordChangeExpectingNoRequest(
        verifiedUser.password,
        "abc123",
      );
      await profilePage.verifyNewPasswordError("At least 8 characters");
      expect(requestSent, "Weak password must not reach the API").toBe(false);
    });

    await test.step("'abc12345' (long enough, no uppercase) is rejected", async () => {
      const requestSent = await profilePage.submitPasswordChangeExpectingNoRequest(
        verifiedUser.password,
        "abc12345",
      );
      await profilePage.verifyNewPasswordError(
        "Must contain uppercase, lowercase, and number",
      );
      expect(requestSent, "Weak password must not reach the API").toBe(false);
    });

    // The original password still works
    await authApi.login({ email: verifiedUser.email, password: verifiedUser.password });
  });

  test("@Regression TC-064 Move wishlist item to cart", async ({
    wishlistPage,
    wishlistApi,
    productApi,
    cartApi,
    accessToken,
  }) => {
    const product = await productApi.getProduct("atomic-habits");
    await wishlistApi.addItem(accessToken, product.id);

    await wishlistPage.navigateToWishlistPage();
    await wishlistPage.verifyItemInWishlist(product.name);
    await wishlistPage.verifyCartBadgeHidden();

    await wishlistPage.addToCart(product.name);

    await wishlistPage.verifyCartBadge(1);
    const cart = await cartApi.getCart(accessToken);
    expect(cart.items.map(({ name }) => name)).toEqual([product.name]);
  });
});
