import { test, expect } from "../../../fixtures/api.fixture";
import { expectError, expectStatus } from "../../../utils/api-assertions";
import { UNKNOWN_ID } from "../../../test-data/api";

test.describe("@API Admin - users", () => {
  test("Search finds a user by email", async ({ adminApi, adminAccessToken, verifiedUser }) => {
    const { users, total } = await adminApi.getUsers(adminAccessToken, verifiedUser.email);
    expect(total).toBe(1);
    expect(users[0]).toMatchObject({
      email: verifiedUser.email,
      first_name: verifiedUser.firstName,
      role: "customer",
      status: "active",
    });
  });

  test("Role filter returns only admins", async ({ api, adminAccessToken }) => {
    const { users } = await expectStatus(
      await api.path("admin/users").auth(adminAccessToken).params({ role: "admin" }).getRequest(),
      200,
    );
    expect(users.length).toBeGreaterThan(0);
    expect(users.every(({ role }: { role: string }) => role === "admin")).toBe(true);
  });

  test("Banned user cannot log in until unbanned", async ({
    api,
    adminApi,
    authApi,
    adminAccessToken,
    verifiedUser,
  }) => {
    const { users } = await adminApi.getUsers(adminAccessToken, verifiedUser.email);
    const userId = users[0].id;

    const banned = await adminApi.setUserStatus(adminAccessToken, userId, "banned");
    expect(banned.status).toBe("banned");

    await test.step("Login is refused while banned", async () => {
      const response = await api
        .path("auth/login")
        .body({ email: verifiedUser.email, password: verifiedUser.password })
        .postRequest();
      const body = await expectError(response, 403, "ACCOUNT_BANNED");
      expect(body.error).toBe("Account has been banned");
    });

    await test.step("Banned users show up in the status filter", async () => {
      const { users: bannedUsers } = await expectStatus(
        await api.path("admin/users").auth(adminAccessToken).params({ status: "banned", search: verifiedUser.email }).getRequest(),
        200,
      );
      expect(bannedUsers.map(({ id }: { id: string }) => id)).toEqual([userId]);
    });

    await adminApi.setUserStatus(adminAccessToken, userId, "active");
    await authApi.login({ email: verifiedUser.email, password: verifiedUser.password });
  });

  test("Unknown user returns 404", async ({ api, adminAccessToken }) => {
    const response = await api
      .path(`admin/users/${UNKNOWN_ID}`)
      .auth(adminAccessToken)
      .body({ status: "banned" })
      .patchRequest();
    await expectStatus(response, 404);
  });

  test("Invalid status is rejected with 400", async ({
    api,
    adminApi,
    adminAccessToken,
    verifiedUser,
  }) => {
    const { users } = await adminApi.getUsers(adminAccessToken, verifiedUser.email);
    const response = await api
      .path(`admin/users/${users[0].id}`)
      .auth(adminAccessToken)
      .body({ status: "superstar" })
      .patchRequest();
    // Today: 500 with a raw database enum error
    await expectError(response, 400);
  });
});
