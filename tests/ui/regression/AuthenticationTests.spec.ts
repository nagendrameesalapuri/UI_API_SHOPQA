import { test } from "../../../fixtures/ui.fixture";
import {
  buildAddress,
  buildNewUser,
  DEFAULT_PASSWORD,
  EXISTING_USER_EMAIL,
} from "../../../test-data/users";

const PROTECTED_ROUTES = ["/cart", "/orders", "/profile"];
const REMAINING_ATTEMPT_MESSAGES = [
  "Invalid email or password (4 attempts remaining)",
  "Invalid email or password (3 attempts remaining)",
  "Invalid email or password (2 attempts remaining)",
  "Invalid email or password (1 attempt remaining)",
];

test.describe("Authentication Tests", () => {
  test.describe.configure({ timeout: 120000 });

  test("@Regression TC-003 Login with wrong password", async ({ loginPage, verifiedUser }) => {
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(verifiedUser.email, "WrongPassword1!");

    await loginPage.verifyLoginError(REMAINING_ATTEMPT_MESSAGES[0]);
    await loginPage.verifyUserStaysOnLoginPage();
  });

  test("@Regression TC-004 Account lockout after 5 failed attempts", async ({
    loginPage,
    verifiedUser,
  }) => {
    await loginPage.navigateToLoginPage();

    for (const [index, message] of REMAINING_ATTEMPT_MESSAGES.entries()) {
      await test.step(`Failed login attempt ${index + 1}`, async () => {
        await loginPage.loginWith(verifiedUser.email, `WrongPassword${index}!`);
        await loginPage.verifyLoginError(message);
      });
    }

    await test.step("Failed login attempt 5 locks the account", async () => {
      await loginPage.loginWith(verifiedUser.email, "WrongPassword5!");
      await loginPage.verifyLoginError(
        "Account locked for 30 minutes due to too many failed attempts",
      );
    });

    await test.step("Correct password is rejected while locked", async () => {
      await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
      await loginPage.verifyLoginError("Account locked. Try again in 30 minute(s).");
      await loginPage.verifyUserStaysOnLoginPage();
    });
  });

  test("@Regression TC-006 Register with duplicate email", async ({ registerPage }) => {
    const user = { ...buildNewUser(), email: EXISTING_USER_EMAIL };

    await registerPage.navigateToRegisterPage();
    await registerPage.registerWith(user);

    await registerPage.verifyEmailError("Email already registered");
    await registerPage.verifyFormNotSubmitted();
  });

  test.describe("TC-008 Register with invalid address fields", () => {
    test.beforeEach(async ({ registerPage }) => {
      await registerPage.navigateToRegisterPage();
      await registerPage.fillAccountDetails(buildNewUser());
    });

    test("@Regression TC-008 Empty City and State show inline errors", async ({ registerPage }) => {
      await registerPage.fillAddress(buildAddress({ city: "", state: "" }));
      await registerPage.submit();

      await registerPage.verifyCityError("Required");
      await registerPage.verifyStateError("Required");
      await registerPage.verifyFormNotSubmitted();
    });

    test("@Regression TC-008 Non 6-digit postal code shows inline error", async ({
      registerPage,
    }) => {
      await registerPage.fillAddress(buildAddress({ postalCode: "12345" }));
      await registerPage.submit();

      await registerPage.verifyPostalCodeError("6-digit postal code");
      await registerPage.verifyFormNotSubmitted();
    });
  });

  test("@Regression TC-009 Unverified email cannot log in", async ({ loginPage, authApi }) => {
    const user = buildNewUser();

    const response = await authApi.registerNewUser(user);

    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(response.user.email, user.password);

    await loginPage.verifyLoginError("Please verify your email first");
    await loginPage.verifyUserStaysOnLoginPage();
  });

  test("@Regression TC-011 Forgot and reset password", async ({
    forgotPasswordPage,
    resetPasswordPage,
    loginPage,
    verifiedUser,
  }) => {
    const newPassword = `New${DEFAULT_PASSWORD}`;

    await forgotPasswordPage.navigateToForgotPasswordPage();
    await forgotPasswordPage.requestPasswordReset(verifiedUser.email);
    await forgotPasswordPage.verifyResetLinkSent(verifiedUser.email);
    const resetToken = await forgotPasswordPage.getResetToken();

    await resetPasswordPage.navigateToResetPasswordPage(resetToken);
    await resetPasswordPage.resetPassword(newPassword);
    await resetPasswordPage.verifyPasswordResetSuccessful();

    await loginPage.loginWith(verifiedUser.email, newPassword);
    await loginPage.verifyWelcomeToast();
    await loginPage.verifyUserIsLoggedIn();
  });

  test("@Regression TC-013 Protected route redirects guests", async ({ page, loginPage }) => {
    for (const route of PROTECTED_ROUTES) {
      await test.step(`Guest opens ${route}`, async () => {
        await page.goto(route);
        await loginPage.verifyRedirectedToLoginFrom(route);
      });
    }
  });
});
