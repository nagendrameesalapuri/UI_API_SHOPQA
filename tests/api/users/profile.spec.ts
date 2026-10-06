import { test, expect } from "../../../fixtures/api.fixture";
import { updateProfileResponseSchema } from "../../../api/schemas/user.schema";
import { expectError, expectStatus } from "../../../utils/api-assertions";

const NEW_PASSWORD = "NewPassword456!";

test.describe("@API Users - profile", () => {
  test("Current user's profile", async ({ userApi, accessToken, verifiedUser }) => {
    const profile = await userApi.getProfile(accessToken);
    expect(profile).toMatchObject({
      email: verifiedUser.email,
      first_name: verifiedUser.firstName,
      last_name: verifiedUser.lastName,
      phone: verifiedUser.phone,
      role: "customer",
      status: "active",
    });
  });

  test("Update name and phone", async ({ api, userApi, accessToken }) => {
    const update = { firstName: "Updated", lastName: "Customer", phone: "9123456780" };
    const body = updateProfileResponseSchema.parse(
      await expectStatus(await api.path("users/me").auth(accessToken).body(update).putRequest(), 200),
    );
    expect(body.user).toMatchObject({ first_name: "Updated", last_name: "Customer", phone: "9123456780" });

    const profile = await userApi.getProfile(accessToken);
    expect(profile).toMatchObject({ first_name: "Updated", last_name: "Customer", phone: "9123456780" });
  });

  test("Updating the name keeps the phone number", async ({
    api,
    userApi,
    accessToken,
    verifiedUser,
  }) => {
    await expectStatus(
      await api.path("users/me").auth(accessToken).body({ firstName: "Renamed", lastName: "Only" }).putRequest(),
      200,
    );
    // Today the phone is wiped to null when it is not sent (the UI loses it too)
    expect((await userApi.getProfile(accessToken)).phone).toBe(verifiedUser.phone);
  });

  test("Empty first name is rejected", async ({ api, accessToken }) => {
    const response = await api
      .path("users/me")
      .auth(accessToken)
      .body({ firstName: "", lastName: "Customer" })
      .putRequest();
    // Today: 200, and the first name is saved as ""
    await expectStatus(response, 400);
  });

  test("Profile requires login", async ({ api }) => {
    await expectError(await api.path("users/me").getRequest(), 401, "MISSING_TOKEN");
  });
});

test.describe("@API Users - change password", () => {
  test("Successful change: new password works, old one does not", async ({
    api,
    authApi,
    verifiedUser,
  }) => {
    const login = await authApi.login({ email: verifiedUser.email, password: verifiedUser.password });

    const body = await expectStatus(
      await api
        .path("users/password")
        .auth(login.accessToken)
        .body({ currentPassword: verifiedUser.password, newPassword: NEW_PASSWORD })
        .putRequest(),
      200,
    );
    expect(body.message).toBe("Password changed successfully");

    await authApi.login({ email: verifiedUser.email, password: NEW_PASSWORD });
    await expect(
      authApi.login({ email: verifiedUser.email, password: verifiedUser.password }),
    ).rejects.toThrow("Status: 401");

    await test.step("Other sessions are signed out (refresh token revoked)", async () => {
      const refresh = await api.path("auth/refresh").body({ refreshToken: login.refreshToken }).postRequest();
      await expectError(refresh, 401, "TOKEN_REVOKED");
    });
  });

  const rejected = [
    ["wrong current password", { currentPassword: "WrongPassword1!", newPassword: NEW_PASSWORD }, 401, "INVALID_PASSWORD"],
    ["weak new password", { newPassword: "abc" }, 400, "WEAK_PASSWORD"],
    ["new password same as current", {}, 400, "SAME_PASSWORD"],
    ["missing fields", null, 400, "VALIDATION_ERROR"],
  ] as const;

  for (const [label, override, status, code] of rejected) {
    test(`Rejected: ${label}`, async ({ api, authApi, accessToken, verifiedUser }) => {
      const payload =
        override === null
          ? {}
          : { currentPassword: verifiedUser.password, newPassword: verifiedUser.password, ...override };

      const response = await api.path("users/password").auth(accessToken).body(payload).putRequest();
      await expectError(response, status, code);

      // The password is unchanged
      await authApi.login({ email: verifiedUser.email, password: verifiedUser.password });
    });
  }
});
