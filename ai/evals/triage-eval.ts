import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  NormalizedTest,
  ParsedReport,
} from "../../integrations/report/playwright-json-parser";
import type { LlmProvider } from "../core/llm-provider";
import { normalizeError, signatureHash } from "../rules/signature";
import { categorySchema } from "../agents/triage-schema";
import { triage } from "../agents/triage.agent";
import type { TriageHistory } from "../agents/triage-history";

// Golden-set evaluation of the triage: runs every sample through the real agent and
// measures accuracy. Run it after changing a rule or a prompt (`npm run eval:triage`).

const sampleSchema = z.object({
  id: z.string(),
  failure: z.object({
    status: z.enum(["failed", "flaky", "timedOut"]),
    errorMessage: z.string(),
    failingStep: z.string().optional(),
    retries: z.number().default(0),
  }),
  /** Previous runs, oldest first: "P" pass, "F" other failure, "SAME" same error */
  history: z.array(z.enum(["P", "F", "SAME"])).optional(),
  expected: categorySchema,
  minConfidence: z.number().optional(),
});
export type GoldenSample = z.infer<typeof sampleSchema>;

export const GOLDEN_FILE = path.resolve(__dirname, "golden", "triage-golden.json");

export function loadGolden(file = GOLDEN_FILE): GoldenSample[] {
  return z.array(sampleSchema).parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

function toTest(s: GoldenSample): NormalizedTest {
  return {
    testId: `golden::${s.id}`,
    title: s.id,
    titlePath: [s.id],
    file: "golden.spec.ts",
    project: "golden",
    tags: [],
    status: s.failure.status,
    retries: s.failure.retries,
    errorMessage: s.failure.errorMessage,
    failingStep: s.failure.failingStep,
    attachments: [],
    duration: 0,
  };
}

function historyFor(samples: GoldenSample[]): TriageHistory {
  const maxLen = Math.max(0, ...samples.map((s) => s.history?.length ?? 0));
  const runs = Array.from({ length: maxLen }, (_, i) => ({
    runId: `golden-${i}`,
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    results: {} as Record<string, string>,
  }));
  for (const s of samples) {
    const sig = signatureHash(normalizeError(s.failure.errorMessage));
    const h = s.history ?? [];
    // Align histories to the most recent runs
    h.forEach((v, i) => {
      runs[maxLen - h.length + i].results[`golden::${s.id}`] =
        v === "P" ? "P" : v === "SAME" ? `F:${sig}` : "F:other";
    });
  }
  return { version: 1, runs };
}

export type EvalResult = {
  accuracy: number;
  correct: number;
  total: number;
  rows: {
    id: string;
    expected: string;
    actual: string;
    confidence: number;
    ok: boolean;
    ruleId: string;
  }[];
  confusion: Record<string, Record<string, number>>;
};

export async function runTriageEval(
  samples = loadGolden(),
  llm?: LlmProvider,
): Promise<EvalResult> {
  const tests = samples.map(toTest);
  const report: ParsedReport = {
    tests,
    failures: tests,
    stats: {
      total: tests.length,
      passed: 0,
      failed: tests.length,
      flaky: 0,
      skipped: 0,
      durationMs: 0,
    },
    globalErrors: [],
  };
  const result = await triage(report, { runId: "eval", history: historyFor(samples), llm });
  const rows = samples.map((s) => {
    const item = result.items.find((i) => i.testId === `golden::${s.id}`)!;
    const ok =
      item.category === s.expected &&
      (s.minConfidence === undefined || item.confidence >= s.minConfidence);
    return {
      id: s.id,
      expected: s.expected,
      actual: item.category,
      confidence: item.confidence,
      ok,
      ruleId: item.ruleId,
    };
  });
  const confusion: EvalResult["confusion"] = {};
  for (const r of rows) {
    confusion[r.expected] ??= {};
    confusion[r.expected][r.actual] = (confusion[r.expected][r.actual] ?? 0) + 1;
  }
  const correct = rows.filter((r) => r.ok).length;
  return { accuracy: correct / rows.length, correct, total: rows.length, rows, confusion };
}
