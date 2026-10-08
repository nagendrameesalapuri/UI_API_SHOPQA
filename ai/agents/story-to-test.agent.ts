import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AdoClient } from "../../integrations/ado/ado-client";
import { commitToBranch, createPullRequest, prWebUrl } from "../../integrations/ado/git";
import {
  createTestCase,
  getWorkItem,
  relatedIds,
  TESTED_BY,
  workItemSchema,
  workItemWebUrl,
  type WorkItem,
} from "../../integrations/ado/work-items";
import { audit } from "../core/audit";
import { type LlmProvider, NoneProvider } from "../core/llm-provider";
import { loadPrompt, renderPrompt } from "../core/prompts";
import { Redactor } from "../core/redact";
import {
  htmlToText,
  parseAcceptanceCriteria,
  planSchema,
  type Scenario,
} from "./story/acceptance-parser";
import { describeIndex, indexPageObjects, type PageMethod } from "./story/page-index";
import { renderPlanMarkdown, renderSpecSkeleton, type StoryInfo } from "./story/spec-writer";
import { type ValidationResult, validateSpec } from "./story/validate";

// Story-to-Test agent: Azure DevOps user story -> reviewed test pull request.
// 1. Fetch the story, acceptance criteria and linked Test Cases.
// 2. Plan scenarios: rule-based parser (none) or prompts/plan-from-story.md (LLM).
// 3. Optionally create Test Cases in Azure Test Plans (--create-test-cases).
// 4. Write specs/story-<id>.md and tests/ui/stories/story-<id>.spec.ts
//    (none: compilable test.fixme skeleton; LLM: generated spec, validated, max 2 fixes).
// 5. Commit to branch ai/story-<id> and open a DRAFT PR labelled ai-generated, linked to
//    the story. Never merges. --dry-run stops after writing local files.

export type StoryToTestDeps = {
  ado?: AdoClient;
  llm?: LlmProvider;
  repo?: string;
  baseBranch?: string;
  rootDir?: string;
  pageIndex?: PageMethod[];
  validate?: (file: string, opts: { runTests?: boolean }) => ValidationResult;
  redactor?: Redactor;
};

export type StoryToTestOptions = {
  workItemId?: number;
  /** Local story JSON (same shape as GET wit/workitems/{id}) instead of fetching it */
  storyFile?: string;
  dryRun?: boolean;
  createTestCases?: boolean;
};

export type StoryToTestResult = {
  storyId: number;
  source: "rules" | "llm";
  scenarios: Scenario[];
  files: { path: string; content: string }[];
  createdTestCases: number[];
  validation: ValidationResult | { ok: true; output: string };
  needsHuman: boolean;
  branch?: string;
  pullRequestUrl?: string;
  todos: number;
};

const field = (item: WorkItem, name: string) =>
  typeof item.fields[name] === "string" ? (item.fields[name] as string) : "";

export function toStoryInfo(item: WorkItem, url?: string): StoryInfo {
  return {
    id: item.id,
    title: field(item, "System.Title"),
    description: htmlToText(field(item, "System.Description")),
    acceptanceCriteria: field(item, "Microsoft.VSTS.Common.AcceptanceCriteria"),
    linkedTestCases: relatedIds(item, TESTED_BY),
    url,
  };
}

const generatedSpecSchema = z.object({ fileName: z.string(), code: z.string().min(20) });

async function planScenarios(
  story: StoryInfo,
  llm: LlmProvider,
  redactor: Redactor,
): Promise<{ scenarios: Scenario[]; source: "rules" | "llm" }> {
  const ruleScenarios = parseAcceptanceCriteria(story.acceptanceCriteria || story.description);
  if (llm instanceof NoneProvider) return { scenarios: ruleScenarios, source: "rules" };
  try {
    const prompt = loadPrompt("plan-from-story");
    const text = renderPrompt(prompt, {
      storyId: story.id,
      title: story.title,
      description: story.description || "(none)",
      acceptanceCriteria: htmlToText(story.acceptanceCriteria) || "(none)",
      linkedTestCases: story.linkedTestCases.join(", ") || "none",
    });
    const plan = await llm.json(planSchema, redactor.redact(text).text, {
      agent: "story-to-test",
      promptId: prompt.id,
      promptVersion: prompt.version,
      maxTokens: 3000,
    });
    return { scenarios: plan.scenarios, source: "llm" };
  } catch (error) {
    audit({
      agent: "story-to-test",
      action: "llm-plan",
      inputs: story.id,
      outcome: "failed",
      details: { error: String(error) },
    });
    return { scenarios: ruleScenarios, source: "rules" };
  }
}

async function generateSpecWithLlm(
  story: StoryInfo,
  scenarios: Scenario[],
  llm: LlmProvider,
  deps: Required<Pick<StoryToTestDeps, "rootDir" | "validate">> & { index: PageMethod[] },
  specPath: string,
): Promise<{ code: string; validation: ValidationResult; needsHuman: boolean } | undefined> {
  const gen = loadPrompt("generate-spec");
  const fix = loadPrompt("fix-spec");
  const seed = fs.readFileSync(path.join(deps.rootDir, "tests", "seed.spec.ts"), "utf8");
  const fixtures =
    fs
      .readFileSync(path.join(deps.rootDir, "fixtures", "ui.fixture.ts"), "utf8")
      .match(/^\s{2}\w+: \w+;$/gm)
      ?.join("\n") ?? "";
  let answer: z.infer<typeof generatedSpecSchema>;
  try {
    answer = await llm.json(
      generatedSpecSchema,
      renderPrompt(gen, {
        tags: "@Regression",
        scenarios: JSON.stringify(scenarios, null, 2),
        fixtures,
        pageObjects: describeIndex(deps.index),
        seed,
      }),
      { agent: "story-to-test", promptId: gen.id, promptVersion: gen.version, maxTokens: 6000 },
    );
  } catch {
    return undefined; // fall back to the skeleton
  }

  const abs = path.join(deps.rootDir, specPath);
  let code = answer.code;
  for (let attempt = 0; ; attempt++) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, code);
    const validation = deps.validate(specPath, { runTests: true });
    if (validation.ok) return { code, validation, needsHuman: false };
    if (attempt >= 2) return { code, validation, needsHuman: true };
    try {
      const fixed = await llm.json(
        generatedSpecSchema,
        renderPrompt(fix, {
          fileName: path.basename(specPath),
          code,
          errors: `${validation.step}:\n${validation.output}`,
        }),
        { agent: "story-to-test", promptId: fix.id, promptVersion: fix.version, maxTokens: 6000 },
      );
      code = fixed.code;
    } catch {
      return { code, validation, needsHuman: true };
    }
  }
}

export function prDescription(
  r: Omit<StoryToTestResult, "files" | "branch" | "pullRequestUrl">,
  story: StoryInfo,
): string {
  return [
    `Generated by the **story-to-test agent** from story #${story.id} — ${story.title}.`,
    "",
    `Planner: ${r.source === "llm" ? "LLM-assisted" : "rule-based (LLM_PROVIDER=none)"}.${r.needsHuman ? " **Needs human: validation did not pass after 2 fix attempts.**" : ""}`,
    "",
    "### Scenarios",
    ...r.scenarios.map(
      (s, i) => `${i + 1}. ${s.title} (${s.type}, ${s.level})${s.tcId ? ` — TC ${s.tcId}` : ""}`,
    ),
    "",
    `### Test Cases created\n${r.createdTestCases.length ? r.createdTestCases.join(", ") : "none"}`,
    "",
    `### Validation\n${r.validation.output}`,
    "",
    `### TODOs\n${r.todos} TODO marker(s) in the plan and spec. Every test is \`test.fixme\` until implemented.`,
    "",
    "_This PR was opened by an agent. Review every line; the agent never merges._",
  ].join("\n");
}

export async function runStoryToTest(
  opts: StoryToTestOptions,
  deps: StoryToTestDeps = {},
): Promise<StoryToTestResult> {
  const rootDir = deps.rootDir ?? process.cwd();
  const llm = deps.llm ?? new NoneProvider();
  const redactor = deps.redactor ?? new Redactor();
  const validate = deps.validate ?? validateSpec;
  const index = deps.pageIndex ?? indexPageObjects(path.join(rootDir, "pages"));

  // 1. Story
  let item: WorkItem;
  if (opts.storyFile)
    item = workItemSchema.parse(JSON.parse(fs.readFileSync(opts.storyFile, "utf8")));
  else if (opts.workItemId && deps.ado) item = await getWorkItem(deps.ado, opts.workItemId);
  else
    throw new Error("Pass --id <workItemId> (with Azure DevOps configured) or --story-file <json>");
  const story = toStoryInfo(item, deps.ado ? workItemWebUrl(deps.ado, item.id) : undefined);
  if (!story.acceptanceCriteria && !story.description)
    throw new Error(`Story ${story.id} has no acceptance criteria or description`);
  audit({
    agent: "story-to-test",
    action: "fetch-story",
    inputs: story.id,
    outcome: "ok",
    details: { linkedTestCases: story.linkedTestCases.length },
  });

  // 2. Plan
  const { scenarios, source } = await planScenarios(story, llm, redactor);
  if (scenarios.length === 0)
    throw new Error(`Could not derive any scenario from story ${story.id}`);

  // 3. Test Cases (optional, never in dry-run)
  const createdTestCases: number[] = [];
  if (opts.createTestCases && !opts.dryRun && deps.ado) {
    for (const s of scenarios) {
      const tc = await createTestCase(deps.ado, {
        title: s.title,
        storyId: story.id,
        tags: [`story-${story.id}`],
        steps: [
          ...s.given.map((g) => ({ action: `Given ${g}` })),
          ...s.when.map((w) => ({ action: `When ${w}` })),
          { action: "Verify", expected: s.then.join("; ") },
        ],
      });
      s.tcId = tc.id;
      createdTestCases.push(tc.id);
    }
    audit({
      agent: "story-to-test",
      action: "create-test-cases",
      inputs: story.id,
      outcome: "ok",
      details: { ids: createdTestCases },
    });
  }

  // 4. Files
  const planPath = `specs/story-${story.id}.md`;
  const specPath = `tests/ui/stories/story-${story.id}.spec.ts`;
  const plan = renderPlanMarkdown(story, scenarios, { source });
  let spec = renderSpecSkeleton(story, scenarios, index);
  let validation: StoryToTestResult["validation"];
  let needsHuman: boolean;

  const llmSpec =
    llm instanceof NoneProvider
      ? undefined
      : await generateSpecWithLlm(story, scenarios, llm, { rootDir, validate, index }, specPath);
  if (llmSpec) {
    spec = llmSpec.code;
    validation = llmSpec.validation;
    needsHuman = llmSpec.needsHuman;
  } else {
    fs.mkdirSync(path.join(rootDir, path.dirname(specPath)), { recursive: true });
    fs.writeFileSync(path.join(rootDir, specPath), spec);
    validation = opts.dryRun
      ? { ok: true, output: "skeleton written (dry run: validation skipped)" }
      : validate(specPath, { runTests: false });
    needsHuman = !validation.ok;
  }
  fs.mkdirSync(path.join(rootDir, "specs"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, planPath), plan);

  const files = [
    { path: planPath, content: plan },
    { path: specPath, content: spec },
  ];
  const todos = (plan.match(/TODO/g) ?? []).length + (spec.match(/TODO/g) ?? []).length;
  const result: StoryToTestResult = {
    storyId: story.id,
    source,
    scenarios,
    files,
    createdTestCases,
    validation,
    needsHuman,
    todos,
  };

  if (opts.dryRun) {
    audit({
      agent: "story-to-test",
      action: "write-files",
      inputs: story.id,
      outcome: "dry-run",
      details: { files: files.map((f) => f.path) },
    });
    return result;
  }

  // 5. Branch + draft PR (never merged by the agent)
  if (!deps.ado || !deps.repo)
    throw new Error(
      "Azure DevOps and ADO_REPO are required to open the pull request (or use --dry-run)",
    );
  const branch = `ai/story-${story.id}`;
  await commitToBranch(deps.ado, {
    repo: deps.repo,
    baseBranch: deps.baseBranch ?? "main",
    branch,
    files,
    message: `AI: test plan and spec skeleton for story #${story.id}`,
  });
  const { pr } = await createPullRequest(deps.ado, {
    repo: deps.repo,
    sourceBranch: branch,
    targetBranch: deps.baseBranch ?? "main",
    title: `AI tests: story #${story.id} ${story.title}`.slice(0, 200),
    description: prDescription(result, story),
    workItemIds: [story.id],
    labels: ["ai-generated"],
    draft: true,
  });
  audit({
    agent: "story-to-test",
    action: "open-pr",
    inputs: story.id,
    outcome: "ok",
    details: { branch, pr: pr.pullRequestId },
  });
  return { ...result, branch, pullRequestUrl: prWebUrl(pr) };
}
