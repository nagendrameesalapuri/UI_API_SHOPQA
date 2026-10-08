import { defineConfig } from "@playwright/test";
import { createAzurePlaywrightConfig, ServiceAuth, ServiceOS } from "@azure/playwright";
import { DefaultAzureCredential } from "@azure/identity";
import baseConfig from "./playwright.config";

// Optional: run browsers in Azure Playwright Workspaces instead of on the agent.
//   npx playwright test --config=playwright.service.config.ts --workers=20
// Only used when PLAYWRIGHT_SERVICE_URL is set; see docs/how-to-cloud-browsers.md.
if (!process.env.PLAYWRIGHT_SERVICE_URL) {
  throw new Error(
    "PLAYWRIGHT_SERVICE_URL is not set. Use playwright.config.ts for local browsers, " +
      "or set the workspace URL from the Azure portal (docs/how-to-cloud-browsers.md).",
  );
}

export default defineConfig(
  baseConfig,
  createAzurePlaywrightConfig(baseConfig, {
    // Entra ID via DefaultAzureCredential: `az login` locally, the AzureCLI@2 task
    // with a service connection in pipelines. No access tokens in variables.
    credential: new DefaultAzureCredential(),
    serviceAuthType: ServiceAuth.ENTRA_ID,
    os: ServiceOS.LINUX,
    // The app is public, so browsers do not need to reach the agent's network
    exposeNetwork: "<loopback>",
  }),
);
