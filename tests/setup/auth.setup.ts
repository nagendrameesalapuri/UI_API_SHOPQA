import { test as setup } from "@playwright/test";
import { LoginPage } from "../../pages/LoginPage";
import { AdminDashboardPage } from "../../pages/admin/AdminDashboardPage";
import { credentialsFor, ROLES, storageStatePath } from "../../src/fixtures/roles";

// Runs once before the UI projects (see `dependencies` in playwright.config.ts).
// Like a Serenity @BeforeAll that logs in, except the browser state (cookies +
// localStorage) is saved to disk and reused by every test that asks for that role.
for (const role of ROLES) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    const loginPage = new LoginPage(page);
    const { email, password } = credentialsFor(role);

    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(email, password);

    // Admins land on the admin panel, customers on the storefront
    const verifyLanded = {
      admin: () => new AdminDashboardPage(page).verifyAdminPanelShown(),
      customer: () => loginPage.verifyUserIsLoggedIn(),
    };
    await verifyLanded[role]();

    await page.context().storageState({ path: storageStatePath(role) });
  });
}
