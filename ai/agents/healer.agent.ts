import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AdoClient } from "../../integrations/ado/ado-client";
import { commitToBranch, createPullRequest, prWebUrl } from "../../integrations/ado/git";
import { audit } from "../core/audit";
import { type LlmProvider, NoneProvider } from "../core/llm-provider";
import { loadPrompt, renderPrompt } from "../core/prompts";
import { Redactor, truncateMiddle } from "../core/redact";
import {
  applyLocatorChange,
  type Candidate,
  extractBrokenLocator,
  findLocatorInSources,
  isAllowedLocator,
  parseAriaSnapshot,
  ruleCandidates,
  unifiedDiff,
} from "./healer/locator-tools";
import type { TriageItem, TriageReport } from "./triage-schema";

// Healer agent: for TEST_ISSUE (locator) failures only.
// 1. Find the broken locator in the error and the page-object line that defines it.
// 2. Propose replacements: rule-based candidates from the accessibility snapshot in
//    error-context.md ('none' mode), plus one from prompts/heal-locator.md if an LLM is set.
// 3. Apply one, re-run the failing test; keep it only if the test passes. Max 2 attempts.
// 4. Open ONE draft PR with the page-object changes only. Never edits specs or assertions.

export const PAGE_OBJECT_DIRS = [
  "pages",
  path.join("src", "pages"),
  path.join("src", "components"),
];

export type HealOutcome = {
  test: string;
  status: "healed" | "not-healed" | "skipped";
  reason: string;
  file?: string;
  before?: string;
  after?: string;
  attempts: { expression: string; source: "rules" | "llm"; passed: boolean }[];
};

export type HealerDeps = {
  rootDir?: string;
  llm?: LlmProvider;
  /** Re-runs one test; true when it passes */
  rerun?: (item: TriageItem) => boolean;
  ado?: AdoClient;
  repo?: string;
  baseBranch?: string;
  redactor?: Redactor;
};

export const MAX_ATTEMPTS = 2;

export function rerunWithPlaywright(item: TriageItem, rootDir = process.cwd()): boolean {
  const title = item.title.split(" > ").pop() ?? item.title;
  const grep = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const r = spawnSync(
    "npx",
    [
      "playwright",
      "test",
      item.file,
      "--project",
      item.project,
      "-g",
      grep,
      "--retries=0",
      "--reporter=line",
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: 600_000,
    },
  );
  return r.status === 0;
}

const llmLocatorSchema = z.object({
  locator: z.string().min(5).max(300),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(400),
});

async function llmCandidate(
  item: TriageItem,
  hit: { file: string; text: string; field?: string },
  snapshot: string,
  candidates: Candidate[],
  llm: LlmProvider,
  redactor: Redactor,
): Promise<Candidate | undefined> {
  if (llm instanceof NoneProvider) return undefined;
  try {
    const prompt = loadPrompt("heal-locator");
    const text = renderPrompt(prompt, {
      pageObject: path.basename(hit.file),
      field: hit.field ?? "(unknown)",
      currentLocator: hit.text.trim(),
      failingStep: item.failingStep ?? "(none)",
      error: truncateMiddle(item.errorMessage ?? item.errorSummary, 2000),
      snapshot: truncateMiddle(snapshot || "(no snapshot)", 6000),
      candidates: candidates.map((c) => c.expression).join(", ") || "none",
    });
    const answer = await llm.json(llmLocatorSchema, redactor.redact(text).text, {
      agent: "healer",
      promptId: prompt.id,
      promptVersion: prompt.version,
      maxTokens: 300,
    });
    const expression = answer.locator.replace(/^(this\.)?page\./, "");
    if (answer.confidence < 0.5 || !isAllowedLocator(`page.${expression}`)) return undefined;
    return { expression, reason: `LLM: ${answer.reason}`, priority: 0 };
  } catch (error) {
    audit({
      agent: "healer",
      action: "llm-candidate",
      inputs: item.testId,
      outcome: "failed",
      details: { error: String(error) },
    });
    return undefined;
  }
}

export async function healOne(
  item: TriageItem,
  deps: Required<Pick<HealerDeps, "rootDir" | "llm" | "rerun" | "redactor">>,
): Promise<HealOutcome> {
  const base: HealOutcome = { test: item.title, status: "skipped", reason: "", attempts: [] };
  if (item.category !== "TEST_ISSUE" || item.kind !== "locator")
    return { ...base, reason: `not a locator issue (${item.category}/${item.kind})` };

  const error = item.errorMessage ?? item.errorSummary;
  const locator = extractBrokenLocator(error);
  if (!locator) return { ...base, reason: "could not find the broken locator in the error" };

  const hits = findLocatorInSources(
    locator,
    PAGE_OBJECT_DIRS.map((d) => path.join(deps.rootDir, d)),
  );
  if (hits.length === 0)
    return {
      ...base,
      reason: `${locator} is not defined in a page object (raw locator in a spec: fix by hand)`,
    };
  const files = new Set(hits.map((h) => h.file));
  if (files.size > 1 || hits.length > 1)
    return { ...base, reason: `${locator} is defined in ${hits.length} places; refusing to guess` };
  const hit = hits[0];

  const contextFile = item.attachments.find((a) => a.name === "error-context")?.path;
  const snapshotMd =
    contextFile && fs.existsSync(contextFile) ? fs.readFileSync(contextFile, "utf8") : "";
  const nodes = parseAriaSnapshot(snapshotMd);
  const rules = ruleCandidates(locator, nodes, error);
  const llm = await llmCandidate(
    item,
    hit,
    /# Page snapshot\s*```yaml\s*([\s\S]*?)```/.exec(snapshotMd)?.[1] ?? "",
    rules,
    deps.llm,
    deps.redactor,
  );
  const candidates = [...(llm ? [llm] : []), ...rules].slice(0, MAX_ATTEMPTS);
  if (candidates.length === 0)
    return {
      ...base,
      status: "not-healed",
      reason: nodes.length
        ? "no unique replacement found in the page snapshot"
        : "no page snapshot (error-context.md) to derive a locator from",
      file: hit.file,
    };

  const original = fs.readFileSync(hit.file, "utf8");
  const attempts: HealOutcome["attempts"] = [];
  for (const c of candidates) {
    const updated = applyLocatorChange(original, hit, c.expression);
    fs.writeFileSync(hit.file, updated);
    const passed = deps.rerun(item);
    attempts.push({ expression: c.expression, source: c.priority === 0 ? "llm" : "rules", passed });
    audit({
      agent: "healer",
      action: "try-locator",
      inputs: { test: item.testId, expression: c.expression },
      outcome: passed ? "ok" : "failed",
    });
    if (passed) {
      return {
        test: item.title,
        status: "healed",
        reason: c.reason,
        file: hit.file,
        before: original,
        after: updated,
        attempts,
      };
    }
    fs.writeFileSync(hit.file, original); // revert
  }
  return {
    test: item.title,
    status: "not-healed",
    reason: "no candidate made the test pass",
    file: hit.file,
    attempts,
  };
}

export async function runHealer(
  report: TriageReport,
  opts: { dryRun?: boolean; limit?: number } = {},
  deps: HealerDeps = {},
) {
  const rootDir = deps.rootDir ?? process.cwd();
  const full = {
    rootDir,
    llm: deps.llm ?? new NoneProvider(),
    rerun: deps.rerun ?? ((item: TriageItem) => rerunWithPlaywright(item, rootDir)),
    redactor: deps.redactor ?? new Redactor(),
  };
  const locatorItems = report.items
    .filter((i) => i.category === "TEST_ISSUE" && i.kind === "locator")
    .slice(0, opts.limit ?? 10);
  const outcomes: HealOutcome[] = [];
  for (const item of locatorItems) outcomes.push(await healOne(item, full));

  const healed = outcomes.filter((o) => o.status === "healed" && o.file);
  // Final content per file (several fixes may touch the same page object)
  const changedFiles = new Map<string, { before: string; after: string }>();
  for (const h of healed) {
    const prev = changedFiles.get(h.file!);
    changedFiles.set(h.file!, {
      before: prev?.before ?? h.before!,
      after: fs.readFileSync(h.file!, "utf8"),
    });
  }
  const diff = [...changedFiles]
    .map(([file, c]) =>
      unifiedDiff(path.relative(rootDir, file).replace(/\\/g, "/"), c.before, c.after),
    )
    .join("\n\n");

  let pullRequestUrl: string | undefined;
  if (opts.dryRun) {
    for (const [file, c] of changedFiles) fs.writeFileSync(file, c.before); // leave the tree untouched
  } else if (changedFiles.size && deps.ado && deps.repo) {
    const branch = `ai/heal-${report.run.runId}`.replace(/[^\w./-]/g, "-");
    await commitToBranch(deps.ado, {
      repo: deps.repo,
      baseBranch: deps.baseBranch ?? "main",
      branch,
      files: [...changedFiles].map(([file, c]) => ({
        path: path.relative(rootDir, file).replace(/\\/g, "/"),
        content: c.after,
      })),
      message: `AI healer: update ${changedFiles.size} page-object locator(s) from run ${report.run.runId}`,
    });
    const { pr } = await createPullRequest(deps.ado, {
      repo: deps.repo,
      sourceBranch: branch,
      targetBranch: deps.baseBranch ?? "main",
      title: `AI healer: ${healed.length} locator fix(es) from run ${report.run.runId}`,
      description: [
        "Locator changes proposed by the healer agent. **Page objects only; no assertion was changed.**",
        "Each change made the failing test pass on re-run.",
        "",
        ...healed.map(
          (h) => `- **${h.test}** — ${h.reason} (\`${h.attempts.at(-1)?.expression}\`)`,
        ),
        "",
        "```diff",
        diff.slice(0, 3000),
        "```",
        "",
        "_Opened by an agent. Review before merging; the agent never merges._",
      ].join("\n"),
      labels: ["ai-generated", "ai-healer"],
      draft: true,
    });
    pullRequestUrl = prWebUrl(pr);
    audit({
      agent: "healer",
      action: "open-pr",
      inputs: report.run.runId,
      outcome: "ok",
      details: { pr: pr.pullRequestId, files: [...changedFiles.keys()].length },
    });
  }
  return { outcomes, diff, pullRequestUrl };
}
