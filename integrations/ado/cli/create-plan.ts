import { cliArgs, runCli, setPipelineVariable } from "../../cli-utils";
import { AdoClient } from "../ado-client";
import { readMapping, suitesFromMapping } from "../test-mapping";
import { addTestCases, createReleasePlan, ensureSuites } from "../test-plans";

// npm run ado:create-plan -- --release 2026.10 [--area "Proj\\Team"] [--iteration "Proj\\Sprint 1"]
// Creates (or reuses) the Test Plan "Regression <release>", a static suite per feature
// folder, and adds every mapped Test Case from data/tc-mapping.json (run ado:map-tests first).

runCli(async () => {
  const args = cliArgs({
    release: { type: "string" },
    area: { type: "string" },
    iteration: { type: "string" },
    mapping: { type: "string", default: "data/tc-mapping.json" },
  });
  const releaseVersion = args.release ?? process.env.RELEASE_VERSION;
  if (!releaseVersion) throw new Error("--release <version> is required");

  const client = AdoClient.fromEnv();
  const { plan, created } = await createReleasePlan(client, {
    releaseVersion,
    areaPath: args.area ?? process.env.ADO_AREA_PATH,
    iteration: args.iteration ?? process.env.ADO_ITERATION_PATH,
  });
  console.log(`${created ? "Created" : "Reusing"} plan ${plan.id} "${plan.name}"`);

  const mapping = readMapping(args.mapping!);
  if (!mapping) {
    console.log(`No ${args.mapping}; run "npm run ado:map-tests" to add suites and Test Cases.`);
  } else {
    const { specs, testCases } = suitesFromMapping(mapping);
    const suiteIds = await ensureSuites(client, plan.id, specs);
    for (const [suite, ids] of Object.entries(testCases)) {
      const added = await addTestCases(client, plan.id, suiteIds[suite], ids);
      console.log(
        `  suite ${suite} (${suiteIds[suite]}): ${ids.length} Test Cases, ${added.length} newly added`,
      );
    }
  }
  setPipelineVariable("planId", plan.id);
  console.log(`PLAN_ID=${plan.id}`);
});
