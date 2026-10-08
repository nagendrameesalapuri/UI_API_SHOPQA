import fs from "node:fs";
import { z } from "zod";
import type {
  NormalizedTest,
  ParsedReport,
} from "../../integrations/report/playwright-json-parser";
import { audit } from "../core/audit";
import { GuardrailError } from "../core/guardrails";
import { type LlmProvider, LlmUnavailableError, NoneProvider } from "../core/llm-provider";
import { loadPrompt, renderPrompt } from "../core/prompts";
import { Redactor, truncateMiddle } from "../core/redact";
import { classify, type RuleResult, type TriageCategory } from "../rules/triage-rules";
import { normalizeError, signatureHash } from "../rules/signature";
import {
  emptyHistory,
  isIntermittent,
  testHistory,
  toRunRecord,
  type TriageHistory,
} from "./triage-history";
import {
  categorySchema,
  type TriageCluster,
  type TriageItem,
  type TriageReport,
} from "./triage-schema";

// Failure Triage agent.
// 1. Rules classify every failure (ai/rules/triage-rules.ts).
// 2. Known issues (data/known-issues.json) override matching failures.
// 3. History adjusts confidence: intermittent -> FLAKY, consistent -> stronger PRODUCT_BUG.
// 4. ONLY IF an LLM is configured: one call per uncertain cluster (UNKNOWN or low
//    confidence) with redacted, truncated context; the answer is schema-validated and
//    merged when more confident. Any LLM problem keeps the rule result. Never throws
//    because of the LLM, so it can never block the pipeline.

export const knownIssueSchema = z.array(
  z.object({
    id: z.string(),
    /** Regex tested against the error message */
    pattern: z.string(),
    category: categorySchema,
    kind: z.string().default("known-issue"),
    reason: z.string(),
    bugId: z.number().optional(),
  }),
);
export type KnownIssue = z.infer<typeof knownIssueSchema>[number];

export function loadKnownIssues(file: string): KnownIssue[] {
  if (!fs.existsSync(file)) return [];
  return knownIssueSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export const LOW_CONFIDENCE = 0.6;

const llmAnswerSchema = z.object({
  category: categorySchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(600),
  suggestedFix: z.string().max(400).optional(),
});

export type TriageOptions = {
  runId: string;
  buildId?: number;
  buildNumber?: string;
  buildUrl?: string;
  releaseVersion?: string;
  history?: TriageHistory;
  knownIssues?: KnownIssue[];
  llm?: LlmProvider;
  redactor?: Redactor;
  now?: Date;
};

const firstLine = (s?: string) =>
  (s ?? "")
    .split("\n")
    .find((l) => l.trim())
    ?.trim()
    .slice(0, 200) ?? "(no error message)";
const CATEGORY_ORDER: TriageCategory[] = [
  "PRODUCT_BUG",
  "ENVIRONMENT",
  "TEST_ISSUE",
  "FLAKY",
  "UNKNOWN",
];

function applyHistory(
  rule: RuleResult & { source: TriageItem["source"] },
  h: ReturnType<typeof testHistory>,
) {
  const r = { ...rule };
  if (isIntermittent(h)) {
    if (r.category === "FLAKY") {
      r.confidence = Math.min(0.97, r.confidence + 0.05);
      r.reason += ` Intermittent in history (${h.failures}/${h.runs} recent runs failed).`;
    } else if (r.category === "UNKNOWN" || r.kind === "timeout" || r.kind === "assertion") {
      return {
        ...r,
        category: "FLAKY" as const,
        kind: "intermittent",
        confidence: 0.7,
        reason: `Intermittent: failed ${h.failures} of the last ${h.runs} runs with passes in between (${h.flips} pass/fail flips). Original rule: ${r.ruleId}.`,
        source: "history" as const,
      };
    }
  } else if (r.category === "PRODUCT_BUG" && h.consecutiveSameFailures > 0) {
    r.confidence = Math.min(0.95, r.confidence + 0.1 * h.consecutiveSameFailures);
    r.reason += ` Consistently failing with the same error since ${h.failingSince} (${h.consecutiveSameFailures + 1} runs in a row).`;
  }
  return r;
}

export async function triage(report: ParsedReport, opts: TriageOptions): Promise<TriageReport> {
  const history = opts.history ?? emptyHistory();
  const llm = opts.llm ?? new NoneProvider();
  const redactor = opts.redactor ?? new Redactor();

  const items: TriageItem[] = report.failures.map((t: NormalizedTest) => {
    const signature = normalizeError(t.errorMessage);
    const hash = signatureHash(signature);
    const h = testHistory(history, t.testId, hash);

    let result: RuleResult & { source: TriageItem["source"] } = { ...classify(t), source: "rules" };
    const known = opts.knownIssues?.find((k) =>
      new RegExp(k.pattern, "i").test(t.errorMessage ?? ""),
    );
    if (known) {
      result = {
        category: known.category,
        kind: known.kind,
        confidence: 0.95,
        reason: `Known issue ${known.id}${known.bugId ? ` (bug ${known.bugId})` : ""}: ${known.reason}`,
        ruleId: `known:${known.id}`,
        source: "known-issue",
      };
    } else {
      result = applyHistory(result, h);
    }

    return {
      testId: t.testId,
      title: t.titlePath.join(" > "),
      file: t.file,
      project: t.project,
      tags: t.tags,
      tcId: t.tcId,
      status: t.status,
      retries: t.retries,
      failingStep: t.failingStep,
      errorSummary: firstLine(t.errorMessage),
      errorMessage: t.errorMessage ? truncateMiddle(t.errorMessage, 3000) : undefined,
      attachments: t.attachments
        .filter((a) => ["trace", "screenshot", "video", "error-context"].includes(a.name) && a.path)
        .map((a) => ({ name: a.name, path: a.path })),
      duration: t.duration,
      category: result.category,
      kind: result.kind,
      confidence: Number(result.confidence.toFixed(2)),
      reason: result.reason,
      ruleId: result.ruleId,
      source: result.source,
      signature,
      signatureHash: hash,
      isNew: h.runs === 0 || h.passedLastTime,
      history: {
        runs: h.runs,
        failures: h.failures,
        consecutiveFailures: h.consecutiveFailures,
        failingSince: h.failingSince,
      },
    };
  });

  // ---- Optional LLM pass: one call per uncertain cluster ----
  let llmCalls = 0;
  if (!(llm instanceof NoneProvider)) {
    const prompt = loadPrompt("triage-failure");
    const uncertain = new Map<string, TriageItem[]>();
    for (const item of items) {
      if (item.source === "known-issue") continue;
      if (item.category === "UNKNOWN" || item.confidence < LOW_CONFIDENCE) {
        uncertain.set(item.signatureHash, [...(uncertain.get(item.signatureHash) ?? []), item]);
      }
    }
    for (const [hash, group] of uncertain) {
      const sample = group[0];
      const vars = {
        ruleCategory: sample.category,
        ruleConfidence: sample.confidence,
        ruleReason: sample.reason,
        title: sample.title,
        file: sample.file,
        project: sample.project,
        status: sample.status,
        retries: sample.retries,
        failingStep: sample.failingStep ?? "(none)",
        history: `${sample.history.failures} failures in ${sample.history.runs} previous runs`,
        error: truncateMiddle(sample.errorMessage ?? sample.errorSummary, 4000),
      };
      const redacted = redactor.redact(renderPrompt(prompt, vars)).text;
      try {
        llmCalls++;
        const answer = await llm.json(llmAnswerSchema, redacted, {
          agent: "triage",
          promptId: prompt.id,
          promptVersion: prompt.version,
          maxTokens: 400,
        });
        audit({
          agent: "triage",
          action: "llm-classify",
          inputs: { hash },
          outcome: "ok",
          details: { category: answer.category, confidence: answer.confidence },
        });
        if (answer.confidence > sample.confidence) {
          for (const item of group) {
            Object.assign(item, {
              category: answer.category,
              kind: answer.category === sample.category ? item.kind : "llm",
              confidence: Number(answer.confidence.toFixed(2)),
              reason: `${answer.reason} (LLM; rules said ${item.category} ${item.confidence})`,
              source: "llm",
              suggestedFix: answer.suggestedFix,
            });
          }
        }
      } catch (error) {
        audit({
          agent: "triage",
          action: "llm-classify",
          inputs: { hash },
          outcome: "failed",
          details: { error: String(error) },
        });
        // Unavailable / budget / call limit reached: stop asking; rule results stay for the rest.
        // Other errors (bad answer, HTTP error) only affect this cluster.
        if (error instanceof LlmUnavailableError || error instanceof GuardrailError) break;
      }
    }
  }

  // ---- Clusters: one entry per root cause ----
  const clusters = new Map<string, TriageCluster>();
  for (const item of items) {
    const c = clusters.get(item.signatureHash);
    const test = { title: item.title, file: item.file, project: item.project, tcId: item.tcId };
    if (!c) {
      clusters.set(item.signatureHash, {
        signatureHash: item.signatureHash,
        signature: item.signature,
        category: item.category,
        kind: item.kind,
        confidence: item.confidence,
        reason: item.reason,
        count: 1,
        isNew: item.isNew,
        tests: [test],
        sampleError: item.errorSummary,
      });
      continue;
    }
    c.count++;
    c.tests.push(test);
    c.isNew ||= item.isNew;
    if (item.confidence > c.confidence)
      Object.assign(c, {
        category: item.category,
        kind: item.kind,
        confidence: item.confidence,
        reason: item.reason,
      });
  }
  const sortedClusters = [...clusters.values()].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || b.count - a.count,
  );

  const totals = Object.fromEntries(
    CATEGORY_ORDER.map((c) => [c, items.filter((i) => i.category === c).length]),
  ) as Record<TriageCategory, number>;
  const executed = report.stats.total - report.stats.skipped;
  const usage = llm.usage();

  return {
    schemaVersion: 1,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    run: {
      runId: opts.runId,
      buildId: opts.buildId,
      buildUrl: opts.buildUrl,
      releaseVersion: opts.releaseVersion,
    },
    llm: {
      provider: llm.name,
      model: llm.model,
      calls: Math.max(usage.calls, llmCalls),
      costUsd: Number(usage.spentUsd.toFixed(4)),
    },
    stats: {
      ...report.stats,
      passRate:
        executed > 0
          ? Number(((report.stats.passed + report.stats.flaky) / executed).toFixed(4))
          : 0,
    },
    totals,
    items,
    clusters: sortedClusters,
    globalErrors: report.globalErrors,
    runRecord: toRunRecord(report, {
      runId: opts.runId,
      buildId: opts.buildId,
      buildNumber: opts.buildNumber,
      date: opts.now?.toISOString(),
    }),
  };
}
