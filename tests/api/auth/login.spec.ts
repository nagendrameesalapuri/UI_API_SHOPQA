import { test, expect } from "@playwright/test";
import { AuthApi } from "../../../api/clients/AuthApi";
import { loginResponseSchema } from "../../../api/schemas/auth.schema";

const email = process.env.API_TEST_EMAIL!;
const password = process.env.API_TEST_PASSWORD!;

test("Login with valid credentials", async ({ request }) => {
  const authApi = new AuthApi(request);

  const response = await authApi.login({
    email: email,
    password: password,
  });

  const validatedResponse = loginResponseSchema.parse(response);

  console.log(validatedResponse);

  expect(validatedResponse.accessToken).toBeDefined();
  expect(validatedResponse.refreshToken).toBeDefined();
  expect(validatedResponse.user).toBeDefined();
  expect(validatedResponse.user.email).toBe(email);
});
