import { AdoClient, AdoConfigError } from "../../integrations/ado/ado-client";
import { cliArgs, pipelineWarning, runCli, toInt } from "../../integrations/cli-utils";
import { createLlmProvider, NoneProvider, type LlmProvider } from "../core/llm-provider";
import { Redactor } from "../core/redact";
import { runStoryToTest } from "./story-to-test.agent";

// npm run agent:story -- --id <workItemId> [--dry-run] [--create-test-cases]
// npm run agent:story -- --story-file ai/evals/fixtures/story-1234.json --dry-run

runCli(async () => {
  const args = cliArgs({
    id: { type: "string" },
    "story-file": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "create-test-cases": { type: "boolean", default: false },
    base: { type: "string", default: "main" },
  });

  let ado: AdoClient | undefined;
  try {
    ado = AdoClient.fromEnv();
  } catch (e) {
    if (!(e instanceof AdoConfigError)) throw e;
    if (!args["story-file"]) throw e;
  }
  let llm: LlmProvider = new NoneProvider();
  try {
    llm = createLlmProvider();
  } catch (e) {
    pipelineWarning(`${String(e)}. Using rule-based planning.`);
  }

  const result = await runStoryToTest(
    {
      workItemId: toInt(args.id, "--id"),
      storyFile: args["story-file"],
      dryRun: args["dry-run"],
      createTestCases:
        args["create-test-cases"] || /^true$/i.test(process.env.CREATE_TEST_CASES ?? ""),
    },
    {
      ado,
      llm,
      repo: process.env.ADO_REPO ?? process.env.BUILD_REPOSITORY_NAME,
      baseBranch: args.base,
      redactor: Redactor.fromConfig(),
    },
  );

  console.log(`Story ${result.storyId}: ${result.scenarios.length} scenario(s) (${result.source})`);
  for (const f of result.files) console.log(`  wrote ${f.path}`);
  console.log(
    `Validation: ${result.validation.ok ? "OK" : "FAILED"} — ${result.validation.output.split("\n")[0]}`,
  );
  console.log(`TODO markers: ${result.todos}${result.needsHuman ? " — NEEDS HUMAN" : ""}`);
  if (result.pullRequestUrl) console.log(`Pull request: ${result.pullRequestUrl}`);
});
