import fs from "node:fs";
import { AdoClient, AdoConfigError } from "../../integrations/ado/ado-client";
import { cliArgs, pipelineWarning, runCli, toInt } from "../../integrations/cli-utils";
import { createLlmProvider, NoneProvider, type LlmProvider } from "../core/llm-provider";
import { Redactor } from "../core/redact";
import { runHealer } from "./healer.agent";
import { triageReportSchema } from "./triage-schema";

// npm run agent:heal -- [--triage reports/ai-triage.json] [--dry-run] [--limit 10]
// Heals TEST_ISSUE (locator) failures in page objects. With Azure DevOps configured
// (and not --dry-run) it opens a draft PR; otherwise the change stays in your working tree.

runCli(async () => {
  const args = cliArgs({
    triage: { type: "string", default: "reports/ai-triage.json" },
    "dry-run": { type: "boolean", default: false },
    limit: { type: "string" },
  });
  if (!fs.existsSync(args.triage!))
    throw new Error(`${args.triage} not found: run "npm run triage" first`);
  const report = triageReportSchema.parse(JSON.parse(fs.readFileSync(args.triage!, "utf8")));

  let ado: AdoClient | undefined;
  try {
    ado = AdoClient.fromEnv();
  } catch (e) {
    if (!(e instanceof AdoConfigError)) throw e;
  }
  let llm: LlmProvider = new NoneProvider();
  try {
    llm = createLlmProvider();
  } catch (e) {
    pipelineWarning(`${String(e)}. Using rule-based candidates.`);
  }

  const result = await runHealer(
    report,
    { dryRun: args["dry-run"], limit: toInt(args.limit, "--limit") },
    {
      ado,
      llm,
      repo: process.env.ADO_REPO ?? process.env.BUILD_REPOSITORY_NAME,
      redactor: Redactor.fromConfig(),
    },
  );

  if (result.outcomes.length === 0) console.log("No TEST_ISSUE (locator) failures to heal.");
  for (const o of result.outcomes) {
    console.log(
      `${o.status.toUpperCase().padEnd(10)} ${o.test}\n           ${o.reason}${o.attempts.length ? ` [tried: ${o.attempts.map((a) => `${a.expression} ${a.passed ? "✓" : "✗"}`).join(", ")}]` : ""}`,
    );
  }
  if (result.diff)
    console.log(
      `\n${args["dry-run"] ? "Proposed change (dry run, not applied)" : "Applied change"}:\n${result.diff}`,
    );
  if (result.pullRequestUrl) console.log(`\nPull request: ${result.pullRequestUrl}`);
});
