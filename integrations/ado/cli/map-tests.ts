import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cliArgs, runCli, toInt } from "../../cli-utils";
import { readOverrides, readReport } from "../../report/playwright-json-parser";
import { AdoClient } from "../ado-client";
import { findUnautomated, buildMapping, writeMapping } from "../test-mapping";
import { getAllTestPoints } from "../test-plans";

// npm run ado:map-tests [-- --plan <id>] [--from reports/results.json]
// Lists every Playwright test (without running them), maps @TC-<id> tags / overrides to
// Azure Test Cases, writes data/tc-mapping.json and reports gaps in both directions.

runCli(async () => {
  const args = cliArgs({
    plan: { type: "string" },
    from: { type: "string" },
    out: { type: "string", default: "data/tc-mapping.json" },
    overrides: { type: "string", default: "data/tc-overrides.json" },
  });

  let listFile = args.from;
  if (!listFile) {
    listFile = path.join("reports", "test-list.json");
    fs.mkdirSync("reports", { recursive: true });
    execFileSync("npx", ["playwright", "test", "--list", "--reporter=json"], {
      stdio: ["ignore", "ignore", "inherit"],
      shell: process.platform === "win32",
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: listFile },
    });
  }

  const report = readReport(listFile, readOverrides(args.overrides!));
  const mapping = buildMapping(report);
  writeMapping(args.out!, mapping);

  console.log(`Mapped Test Cases: ${mapping.mapped.length}`);
  console.log(`Unmapped tests:    ${mapping.unmapped.length}`);
  for (const u of mapping.unmapped.slice(0, 20)) console.log(`  - ${u.file} :: ${u.title}`);
  if (mapping.unmapped.length > 20)
    console.log(`  ... and ${mapping.unmapped.length - 20} more (see ${args.out})`);

  const planId = toInt(args.plan, "--plan");
  if (planId) {
    const points = await getAllTestPoints(AdoClient.fromEnv(), planId);
    const missing = findUnautomated(points, mapping);
    console.log(`Test Cases in plan ${planId} without an automated test: ${missing.length}`);
    for (const m of missing) console.log(`  - ${m.id} ${m.name ?? ""}`);
  }
  console.log(`Wrote ${args.out}`);
});
