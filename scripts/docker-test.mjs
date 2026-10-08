// Cross-platform `npm run docker:test`: builds the image and runs the regression
// inside it, mounting ./reports so results.json / junit.xml land on the host.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const image = "shopqa-playwright";
const run = (args) => {
  const r = spawnSync("docker", args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const reports = path.resolve("reports");
fs.mkdirSync(reports, { recursive: true });

run(["build", "-t", image, "."]);
const envFile = fs.existsSync(".env") ? ["--env-file", ".env"] : [];
const extra = process.argv.slice(2); // e.g. npm run docker:test -- npx playwright test --project=api
run(["run", "--rm", ...envFile, "-v", `${reports}:/app/reports`, image, ...extra]);
