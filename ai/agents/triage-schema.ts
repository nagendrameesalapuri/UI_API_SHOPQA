import { z } from "zod";

// Contract of reports/ai-triage.json. Shared by the triage CLI, the history loader
// (previous runs' artifacts) and the dashboard, so all three agree on one shape.

export const categorySchema = z.enum([
  "PRODUCT_BUG",
  "TEST_ISSUE",
  "ENVIRONMENT",
  "FLAKY",
  "UNKNOWN",
]);

/** Compact per-run record used as history: testId -> "P" | "K" (flaky) | "F:<sigHash>" */
export const runRecordSchema = z.object({
  runId: z.string(),
  date: z.string(),
  buildId: z.number().optional(),
  buildNumber: z.string().optional(),
  results: z.record(z.string(), z.string()),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

export const triageItemSchema = z.object({
  testId: z.string(),
  title: z.string(),
  file: z.string(),
  project: z.string(),
  tags: z.array(z.string()),
  tcId: z.number().optional(),
  status: z.string(),
  retries: z.number(),
  failingStep: z.string().optional(),
  errorSummary: z.string(),
  errorMessage: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), path: z.string().optional() })),
  duration: z.number(),
  category: categorySchema,
  kind: z.string(),
  confidence: z.number(),
  reason: z.string(),
  ruleId: z.string(),
  source: z.enum(["rules", "known-issue", "history", "llm"]),
  signature: z.string(),
  signatureHash: z.string(),
  isNew: z.boolean(),
  history: z.object({
    runs: z.number(),
    failures: z.number(),
    consecutiveFailures: z.number(),
    failingSince: z.string().optional(),
  }),
  suggestedFix: z.string().optional(),
});
export type TriageItem = z.infer<typeof triageItemSchema>;

export const clusterSchema = z.object({
  signatureHash: z.string(),
  signature: z.string(),
  category: categorySchema,
  kind: z.string(),
  confidence: z.number(),
  reason: z.string(),
  count: z.number(),
  isNew: z.boolean(),
  tests: z.array(
    z.object({
      title: z.string(),
      file: z.string(),
      project: z.string(),
      tcId: z.number().optional(),
    }),
  ),
  sampleError: z.string(),
  bugId: z.number().optional(),
  bugUrl: z.string().optional(),
});
export type TriageCluster = z.infer<typeof clusterSchema>;

export const triageReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  run: z.object({
    runId: z.string(),
    buildId: z.number().optional(),
    buildUrl: z.string().optional(),
    releaseVersion: z.string().optional(),
  }),
  llm: z.object({
    provider: z.string(),
    model: z.string(),
    calls: z.number(),
    costUsd: z.number(),
  }),
  stats: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    flaky: z.number(),
    skipped: z.number(),
    durationMs: z.number(),
    passRate: z.number(),
  }),
  totals: z.record(categorySchema, z.number()),
  items: z.array(triageItemSchema),
  clusters: z.array(clusterSchema),
  globalErrors: z.array(z.string()),
  runRecord: runRecordSchema,
});
export type TriageReport = z.infer<typeof triageReportSchema>;
