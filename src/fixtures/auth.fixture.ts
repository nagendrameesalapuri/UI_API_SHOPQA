import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { type Role, storageStatePath } from "./roles";

type AuthFixtures = {
  /**
   * Opens a new, already-signed-in page for a role, using the storageState saved by
   * tests/setup/auth.setup.ts. Several roles can be used in one test:
   *
   *   const admin = await asRole("admin");
   */
  asRole: (role: Role) => Promise<Page>;
};

export const test = base.extend<AuthFixtures>({
  asRole: async ({ browser, baseURL }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (role) => {
      const context = await browser.newContext({
        baseURL,
        storageState: storageStatePath(role),
      });
      contexts.push(context);
      return context.newPage();
    });
    for (const context of contexts) await context.close();
  },
});
