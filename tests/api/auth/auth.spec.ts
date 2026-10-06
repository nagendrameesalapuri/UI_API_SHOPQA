import { test, expect } from "../../../fixtures/api.fixture";
import { loginResponseSchema } from "../../../api/schemas/auth.schema";
import { messageResponseSchema } from "../../../api/schemas/common.schema";
import {
  expectError,
  expectStatus,
  expectValidationError,
} from "../../../utils/api-assertions";
import { buildNewUser, EXISTING_USER_EMAIL } from "../../../test-data/users";

const WRONG_PASSWORD = "WrongPassword1!";

test.describe("@API Auth - registration", () => {
  test("Missing fields are rejected with field-level details", async ({ api }) => {
    const response = await api
      .path("auth/register")
      .body({ email: `missing.${Date.now()}@test.com` })
      .postRequest();

    const fields = await expectValidationError(response);
    expect(fields).toEqual(expect.arrayContaining(["password", "firstName", "lastName"]));
  });

  test("Weak password is rejected", async ({ api }) => {
    const response = await api
      .path("auth/register")
      .body({ ...buildNewUser(), password: "abc" })
      .postRequest();

    expect(await expectValidationError(response)).toEqual(["password"]);
  });

  test("Malformed email is rejected", async ({ api }) => {
    const response = await api
      .path("auth/register")
      .body({ ...buildNewUser(), email: "not-an-email" })
      .postRequest();

    expect(await expectValidationError(response)).toEqual(["email"]);
  });

  test("Duplicate email returns 409 EMAIL_TAKEN", async ({ api }) => {
    const response = await api
      .path("auth/register")
      .body({ ...buildNewUser(), email: EXISTING_USER_EMAIL })
      .postRequest();

    const body = await expectError(response, 409, "EMAIL_TAKEN");
    expect(body.error).toBe("Email already registered");
  });
});

test.describe("@API Auth - email verification", () => {
  test("Unverified user cannot log in", async ({ api, pendingUser }) => {
    const response = await api
      .path("auth/login")
      .body({ email: pendingUser.email, password: pendingUser.password })
      .postRequest();

    await expectError(response, 403, "EMAIL_NOT_VERIFIED");
  });

  test("Verification link works once, then the user can log in", async ({
    api,
    authApi,
    pendingUser,
  }) => {
    const verify = () =>
      api.path(`auth/verify-email/${pendingUser.verificationToken}`).getRequest();

    const first = await expectStatus(await verify(), 200);
    expect(messageResponseSchema.parse(first).message).toContain(
      "Email verified successfully",
    );
    await expectError(await verify(), 400, "INVALID_TOKEN");

    const login = await authApi.login({
      email: pendingUser.email,
      password: pendingUser.password,
    });
    expect(loginResponseSchema.parse(login).user.email).toBe(pendingUser.email);
  });

  test("Unknown verification token is rejected", async ({ api }) => {
    const response = await api.path("auth/verify-email/not-a-real-token").getRequest();
    await expectError(response, 400, "INVALID_TOKEN");
  });
});

test.describe("@API Auth - login", () => {
  test("Valid credentials return a token pair and the user", async ({
    authApi,
    verifiedUser,
  }) => {
    const login = loginResponseSchema.parse(
      await authApi.login({ email: verifiedUser.email, password: verifiedUser.password }),
    );
    expect(login.user.email).toBe(verifiedUser.email);
    expect(login.user.firstName).toBe(verifiedUser.firstName);
  });

  test("Missing credentials are rejected", async ({ api }) => {
    const response = await api.path("auth/login").body({}).postRequest();
    expect(await expectValidationError(response)).toEqual(["email", "password"]);
  });

  test("Wrong password and unknown email get the same message", async ({
    api,
    verifiedUser,
  }) => {
    const wrongPassword = await expectError(
      await api
        .path("auth/login")
        .body({ email: verifiedUser.email, password: WRONG_PASSWORD })
        .postRequest(),
      401,
      "INVALID_CREDENTIALS",
    );
    const unknownEmail = await expectError(
      await api
        .path("auth/login")
        .body({ email: `nobody.${Date.now()}@test.com`, password: WRONG_PASSWORD })
        .postRequest(),
      401,
      "INVALID_CREDENTIALS",
    );

    // Identical messages, so the API does not reveal which emails are registered
    expect(unknownEmail.error).toBe(wrongPassword.error);
    expect(wrongPassword.attemptsRemaining).toBe(4);
  });

  test("Five failed attempts lock the account for 30 minutes", async ({
    api,
    verifiedUser,
  }) => {
    const attempt = (password: string) =>
      api.path("auth/login").body({ email: verifiedUser.email, password }).postRequest();

    for (const remaining of [4, 3, 2, 1]) {
      const body = await expectError(await attempt(WRONG_PASSWORD), 401, "INVALID_CREDENTIALS");
      expect(body.attemptsRemaining).toBe(remaining);
    }

    const locked = await expectError(await attempt(WRONG_PASSWORD), 403, "ACCOUNT_LOCKED");
    expect(locked.error).toBe("Account locked for 30 minutes due to too many failed attempts");

    // Even the right password is refused until the lock expires
    const stillLocked = await expectError(
      await attempt(verifiedUser.password),
      403,
      "ACCOUNT_LOCKED",
    );
    const minutesLeft = (Date.parse(stillLocked.lockedUntil!) - Date.now()) / 60000;
    expect(minutesLeft).toBeGreaterThan(28);
    expect(minutesLeft).toBeLessThanOrEqual(30);
  });
});

test.describe("@API Auth - sessions", () => {
  test("Refresh token issues a working access token", async ({
    authApi,
    userApi,
    verifiedUser,
  }) => {
    const login = await authApi.login({
      email: verifiedUser.email,
      password: verifiedUser.password,
    });

    const refreshed = await authApi.refreshToken(login.refreshToken);

    const profile = await userApi.getProfile(refreshed.accessToken);
    expect(profile.email).toBe(verifiedUser.email);
  });

  test("Invalid refresh token is rejected", async ({ api }) => {
    const response = await api
      .path("auth/refresh")
      .body({ refreshToken: "not-a-token" })
      .postRequest();
    await expectError(response, 401, "INVALID_TOKEN");
  });

  test("Logout revokes the refresh token", async ({ api, authApi, verifiedUser }) => {
    const login = await authApi.login({
      email: verifiedUser.email,
      password: verifiedUser.password,
    });

    await authApi.logout(login.accessToken, login.refreshToken);

    const response = await api
      .path("auth/refresh")
      .body({ refreshToken: login.refreshToken })
      .postRequest();
    await expectError(response, 401, "TOKEN_REVOKED");
  });

  test("Logout requires an access token", async ({ api }) => {
    const response = await api.path("auth/logout").postRequest();
    await expectError(response, 401, "MISSING_TOKEN");
  });

  test("Malformed access token is rejected", async ({ api }) => {
    const response = await api.path("users/me").auth("abc.def.ghi").getRequest();
    await expectError(response, 401, "INVALID_TOKEN");
  });
});

test.describe("@API Auth - password reset", () => {
  test("Reset password with the emailed token", async ({ authApi, verifiedUser }) => {
    const newPassword = "ResetPassword789!";
    const { resetToken } = await authApi.forgotPassword(verifiedUser.email);
    expect(resetToken, "Reset token is only returned outside production").toBeTruthy();

    await authApi.resetPassword(resetToken!, newPassword);

    await authApi.login({ email: verifiedUser.email, password: newPassword });
    await expect(
      authApi.login({ email: verifiedUser.email, password: verifiedUser.password }),
    ).rejects.toThrow("Status: 401");
  });

  test("Reset token cannot be reused", async ({ api, authApi, verifiedUser }) => {
    const { resetToken } = await authApi.forgotPassword(verifiedUser.email);
    await authApi.resetPassword(resetToken!, "ResetPassword789!");

    const response = await api
      .path("auth/reset-password")
      .body({ token: resetToken, password: "AnotherPassword1!" })
      .postRequest();
    await expectError(response, 400, "INVALID_TOKEN");
  });

  test("Reset rejects a weak password", async ({ api, authApi, verifiedUser }) => {
    const { resetToken } = await authApi.forgotPassword(verifiedUser.email);

    const response = await api
      .path("auth/reset-password")
      .body({ token: resetToken, password: "abc" })
      .postRequest();
    expect(await expectValidationError(response)).toEqual(["password"]);
  });

  test("Forgot password does not reveal whether an email exists", async ({ authApi }) => {
    const unknown = await authApi.forgotPassword(`nobody.${Date.now()}@test.com`);
    expect(unknown.resetToken).toBeUndefined();
  });

  test("Forgot password requires an email", async ({ api }) => {
    const response = await api.path("auth/forgot-password").body({}).postRequest();
    expect(await expectValidationError(response)).toEqual(["email"]);
  });
});
