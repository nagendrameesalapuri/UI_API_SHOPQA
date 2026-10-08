import fs from "node:fs";
import path from "node:path";
import { AdoClient, AdoConfigError } from "../../integrations/ado/ado-client";
import { listRuns, readArtifactJson } from "../../integrations/ado/pipelines";
import { cliArgs, pipelineWarning, runCli, toInt } from "../../integrations/cli-utils";
import { readOverrides, readReport } from "../../integrations/report/playwright-json-parser";
import { readUsage, summarizeUsage } from "../core/cost-log";
import { createLlmProvider, NoneProvider, type LlmProvider } from "../core/llm-provider";
import { Redactor } from "../core/redact";
import { loadKnownIssues, triage } from "./triage.agent";
import { createBugsForReport } from "./triage-bugs";
import { loadHistory, mergeRuns, saveHistory } from "./triage-history";
import { renderMarkdown, teamsMessage } from "./triage-report";
import { triageReportSchema, type RunRecord } from "./triage-schema";

// npm run triage -- --results reports/results.json [--out reports]
//   [--history data/triage-history.json] [--history-from-ado 5] [--create-bugs] [--teams]
// Works fully with LLM_PROVIDER=none. ADO, LLM and Teams steps are optional and can only
// add information; when they fail the triage still writes its outputs.

runCli(async () => {
  const args = cliArgs({
    results: { type: "string", default: "reports/results.json" },
    out: { type: "string", default: "reports" },
    history: { type: "string", default: "data/triage-history.json" },
    "known-issues": { type: "string", default: "data/known-issues.json" },
    overrides: { type: "string", default: "data/tc-overrides.json" },
    "history-from-ado": { type: "string" },
    "create-bugs": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    teams: { type: "boolean", default: false },
    release: { type: "string" },
  });

  const report = readReport(args.results!, readOverrides(args.overrides!));
  const buildId = toInt(process.env.BUILD_BUILDID, "BUILD_BUILDID");
  const runId = buildId
    ? String(buildId)
    : `local-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  let ado: AdoClient | undefined;
  try {
    ado = AdoClient.fromEnv();
  } catch (e) {
    if (!(e instanceof AdoConfigError)) throw e;
  }

  // ---- History: local file + previous pipeline runs' ai-triage artifacts ----
  let history = loadHistory(args.history!);
  const fromAdo = toInt(args["history-from-ado"], "--history-from-ado");
  const pipelineId = toInt(process.env.ADO_REGRESSION_PIPELINE_ID, "ADO_REGRESSION_PIPELINE_ID");
  if (fromAdo && ado && pipelineId) {
    try {
      const runs = (await listRuns(ado, pipelineId, fromAdo + 5)).filter(
        (r) => r.id !== buildId && r.state === "completed",
      );
      const records: RunRecord[] = [];
      for (const run of runs.slice(0, fromAdo)) {
        const prev = await readArtifactJson(
          ado,
          run.id,
          "ai-triage",
          "ai-triage.json",
          triageReportSchema,
        ).catch(() => undefined);
        if (prev) records.push(prev.runRecord);
      }
      history = mergeRuns(history, records);
      console.log(`History: ${records.length} previous run(s) loaded from Azure DevOps`);
    } catch (e) {
      pipelineWarning(`Could not load triage history from Azure DevOps: ${String(e)}`);
    }
  }

  // ---- LLM (optional) ----
  let llm: LlmProvider = new NoneProvider();
  try {
    llm = createLlmProvider();
  } catch (e) {
    pipelineWarning(`${String(e)}. Continuing with rules only.`);
  }
  const redactor = Redactor.fromConfig();

  const result = await triage(report, {
    runId,
    buildId,
    buildNumber: process.env.BUILD_BUILDNUMBER,
    buildUrl: buildId && ado ? ado.webUrl(`_build/results?buildId=${buildId}`) : undefined,
    releaseVersion: args.release ?? process.env.RELEASE_VERSION,
    history,
    knownIssues: loadKnownIssues(args["known-issues"]!),
    llm,
    redactor,
  });

  // ---- Optional draft bugs ----
  const createBugs = args["create-bugs"] || /^true$/i.test(process.env.TRIAGE_CREATE_BUGS ?? "");
  if (createBugs) {
    if (!ado) pipelineWarning("--create-bugs ignored: Azure DevOps is not configured");
    else {
      try {
        const bugs = await createBugsForReport(ado, result, redactor, { dryRun: args["dry-run"] });
        console.log(`Bug drafts created: ${bugs.created.length}; skipped: ${bugs.skipped.length}`);
      } catch (e) {
        pipelineWarning(`Bug creation failed: ${String(e)}`);
      }
    }
  }

  // ---- Outputs ----
  fs.mkdirSync(args.out!, { recursive: true });
  const jsonFile = path.join(args.out!, "ai-triage.json");
  const mdFile = path.join(args.out!, "ai-triage.md");
  fs.writeFileSync(jsonFile, JSON.stringify(result, null, 2));
  const usage = llm instanceof NoneProvider ? undefined : summarizeUsage(readUsage());
  fs.writeFileSync(mdFile, renderMarkdown(result, usage));

  history = mergeRuns(history, [result.runRecord]);
  saveHistory(args.history!, history);
  // Also ship the merged history with the artifacts (pipeline workspaces are throwaway)
  saveHistory(path.join(args.out!, "triage-history.json"), history);

  const webhook = process.env.TEAMS_WEBHOOK_URL;
  if (args.teams && webhook) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(teamsMessage(result)),
      });
      if (!res.ok) pipelineWarning(`Teams webhook answered ${res.status}`);
    } catch (e) {
      pipelineWarning(`Teams webhook failed: ${String(e)}`);
    }
  }

  console.log(
    `Triage: ${result.items.length} failures in ${result.clusters.length} clusters`,
    result.totals,
  );
  console.log(`Wrote ${jsonFile} and ${mdFile}`);
});
