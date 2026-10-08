# How to run on cloud browsers (Azure Playwright Workspaces) — optional

`playwright.service.config.ts` wraps `playwright.config.ts` with `createAzurePlaywrightConfig`
(`@azure/playwright`) and authenticates with `DefaultAzureCredential` (Entra ID, no access tokens).
It refuses to start unless `PLAYWRIGHT_SERVICE_URL` is set.

## Setup

1. Azure portal → create a **Playwright Workspace** (region close to the app) → copy the
   _Browser endpoint_ (`wss://…/playwrightworkspaces/…/browsers`).
2. Give your identity (and the pipeline's service connection) the **Playwright Workspace Contributor**
   role (or Owner) on the workspace.
3. Locally: `az login`, then
   ```bash
   export PLAYWRIGHT_SERVICE_URL="wss://<region>.api.playwright.microsoft.com/playwrightworkspaces/<id>/browsers"
   npx playwright test --config=playwright.service.config.ts --project=chromium --workers=20
   ```
4. Pipeline: run the test command inside an `AzureCLI@2` task with an Azure Resource Manager service
   connection (so `DefaultAzureCredential` picks up the CLI login) and set `PLAYWRIGHT_SERVICE_URL` as a
   pipeline variable.

## Notes

- Browsers run in the cloud, tests run on the agent: more workers without bigger agents. Keep the
  backend load in mind — the ShopQA API is a free tier and slows down under many parallel workers.
- `exposeNetwork: "<loopback>"` lets cloud browsers reach `localhost` on the agent (needed for the
  dashboard tests only; the shop app is public).
- Visual baselines must come from the same browser environment: create separate baselines for cloud
  runs (Linux) or do visual checks only in Docker.
