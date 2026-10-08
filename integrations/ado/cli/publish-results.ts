import { cliArgs, pipelineWarning, runCli, toInt } from "../../cli-utils";
import { readOverrides, readReport } from "../../report/playwright-json-parser";
import { AdoClient } from "../ado-client";
import { buildMapping, suitesFromMapping } from "../test-mapping";
import { addTestCases, createReleasePlan, ensureSuites } from "../test-plans";
import { publishResultsToPlan } from "../test-results";

// npm run ado:publish-results -- --plan <id> [--results reports/results.json]
// npm run ado:publish-results -- --release 2026.10   (creates/reuses "Regression 2026.10")
// In pipelines TEST_PLAN_ID / RELEASE_VERSION env vars are used when flags are absent.

runCli(async () => {
  const args = cliArgs({
    plan: { type: "string" },
    release: { type: "string" },
    results: { type: "string", default: "reports/results.json" },
    overrides: { type: "string", default: "data/tc-overrides.json" },
  });
  const client = AdoClient.fromEnv();
  const report = readReport(args.results!, readOverrides(args.overrides!));

  let planId = toInt(args.plan ?? process.env.TEST_PLAN_ID, "--plan");
  if (!planId) {
    const releaseVersion = args.release ?? process.env.RELEASE_VERSION;
    if (!releaseVersion) throw new Error("Pass --plan <id> or --release <version>");
    const { plan } = await createReleasePlan(client, { releaseVersion });
    planId = plan.id;
  }

  // Make sure every mapped Test Case is in the plan (idempotent)
  const { specs, testCases } = suitesFromMapping(buildMapping(report));
  const suiteIds = await ensureSuites(client, planId, specs);
  for (const [suite, ids] of Object.entries(testCases))
    await addTestCases(client, planId, suiteIds[suite], ids);

  const buildId = toInt(process.env.BUILD_BUILDID, "BUILD_BUILDID");
  const summary = await publishResultsToPlan(client, {
    planId,
    report,
    buildId,
    runName: `Playwright ${process.env.BUILD_BUILDNUMBER ?? new Date().toISOString()}`,
    artifactsUrl: buildId
      ? client.webUrl(`_build/results?buildId=${buildId}&view=artifacts`)
      : undefined,
  });

  if (summary.published === 0) {
    pipelineWarning(
      `No results published to plan ${planId}: no test carries an @TC-<id> tag or override.`,
    );
    return;
  }
  console.log(
    `Published ${summary.published} results to plan ${planId} (run ${summary.runId})`,
    summary.byOutcome,
  );
  if (summary.notInPlan.length)
    pipelineWarning(`Test Cases not in plan: ${summary.notInPlan.join(", ")}`);
});
