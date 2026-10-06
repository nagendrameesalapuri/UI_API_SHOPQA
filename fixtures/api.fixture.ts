import { APIRequestContext, request as playwrightRequest } from "@playwright/test";
import { AuthState } from "../api/state/AuthState";
import { AuthApi } from "../api/clients/AuthApi";
import { AuthService } from "../api/services/AuthService";
import { test as dataTest } from "./data.fixture";

// API-suite fixtures: everything in data.fixture.ts, plus an authenticated
// request context for the API_TEST_EMAIL account
type APIFixtures = {
  authState: AuthState;
  authenticatedRequest: APIRequestContext;
};

export const test = dataTest.extend<APIFixtures>({
  authState: async ({}, use) => {
    const authState = new AuthState();
    await use(authState);
  },

  authenticatedRequest: async ({ request, authState }, use) => {
    const email = process.env.API_TEST_EMAIL;
    const password = process.env.API_TEST_PASSWORD;

    if (!email || !password) {
      throw new Error(
        "API_TEST_EMAIL and API_TEST_PASSWORD must be configured in .env",
      );
    }

    // Create Auth API
    const authApi = new AuthApi(request);

    // Create Auth Service
    const authService = new AuthService(authApi, authState);

    // Login
    await authService.login({
      email,
      password,
    });

    // Create authenticated API context
    const authenticatedRequest = await playwrightRequest.newContext({
      extraHTTPHeaders: {
        Authorization: `Bearer ${authState.getAccessToken()}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    await use(authenticatedRequest);
    await authenticatedRequest.dispose();
  },
});

export { expect } from "@playwright/test";
