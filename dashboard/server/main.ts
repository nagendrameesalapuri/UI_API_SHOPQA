import path from "node:path";
import { loadEnvFiles } from "../../src/config/env";
import { AdoClient } from "../../integrations/ado/ado-client";
import { JsonFileStore } from "../../integrations/store/store";
import { AdoDashboardService } from "./ado-service";
import { createApp } from "./app";
import { MockDashboardService } from "./mock-service";

// Starts the Release Dashboard.
//   npm run dashboard:dev     -> API + Vite dev server (hot reload) on one port
//   npm run dashboard:build && npm run dashboard:start  -> API + built web app
// DASHBOARD_MOCK=true runs the whole flow without Azure DevOps.

async function main() {
  loadEnvFiles();
  const dev = process.argv.includes("--dev");
  const mock = /^true$/i.test(process.env.DASHBOARD_MOCK ?? "");
  const port = Number(process.env.DASHBOARD_PORT ?? 4300);
  const root = path.resolve(__dirname, "..");

  const service = mock
    ? new MockDashboardService(Number(process.env.DASHBOARD_MOCK_STEP_SECONDS ?? 12))
    : new AdoDashboardService(AdoClient.fromEnv(), new JsonFileStore(path.join(root, ".cache")), {
        pipelineId: Number(process.env.ADO_REGRESSION_PIPELINE_ID ?? NaN),
        branch: process.env.DASHBOARD_PIPELINE_BRANCH ?? "main",
        mappingFile: path.resolve("data", "tc-mapping.json"),
        areaPath: process.env.ADO_AREA_PATH,
        iteration: process.env.ADO_ITERATION_PATH,
      });
  if (!mock && !Number.isInteger(Number(process.env.ADO_REGRESSION_PIPELINE_ID))) {
    throw new Error("ADO_REGRESSION_PIPELINE_ID is required (or set DASHBOARD_MOCK=true)");
  }

  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!mock && !(user && password)) {
    throw new Error(
      "Set DASHBOARD_USER and DASHBOARD_PASSWORD: the real dashboard can queue pipelines and must not be open",
    );
  }

  const app = createApp({
    service,
    mock,
    pollSeconds: Number(process.env.DASHBOARD_POLL_SECONDS ?? 15),
    auth: user && password ? { user, password } : undefined,
    staticDir: dev ? undefined : path.join(root, "dist"),
  });

  if (dev) {
    // Vite in middleware mode: React hot reload served by the same Express server
    const { createServer } = await import("vite");
    const vite = await createServer({
      configFile: path.join(root, "web", "vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(port, () => {
    console.log(
      `Release Dashboard on http://localhost:${port} (${mock ? "MOCK data" : "Azure DevOps"}${user ? ", basic auth on" : ", NO auth"})`,
    );
  });
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
