import { mergeTests } from "@playwright/test";
import { DashboardPage } from "../../pages/dashboard/DashboardPage";
import { test as a11yTest } from "./a11y.fixture";
import { NetworkControl, test as networkTest } from "./network.fixture";

// Fixtures for tests/ui/dashboard: the dashboard page object plus a mocked backend.
// The backend is never started; every /api call is answered by page.route, so the tests
// check only the web app (like testing a React app against WireMock stubs).

export type DashboardApiMock = {
  /** Default happy-path API: config + empty lists. Override single routes afterwards. */
  defaults: () => Promise<void>;
  network: NetworkControl;
};

export const test = mergeTests(a11yTest, networkTest).extend<{
  dashboardPage: DashboardPage;
  dashboardApi: DashboardApiMock;
}>({
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  dashboardApi: async ({ network }, use) => {
    await use({
      network,
      defaults: async () => {
        await network.mockJson("**/api/config", {
          mock: true,
          pollSeconds: 1,
          environments: ["dev", "qa", "uat"],
        });
        await network.mockJson("**/api/runs", []);
        await network.mockJson("**/api/trend?n=*", []);
        await network.mockJson("**/api/releases", []);
      },
    });
  },
});

export { expect } from "../utils/matchers";
