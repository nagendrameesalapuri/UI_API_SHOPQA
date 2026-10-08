import { z } from "zod";

// API contract between dashboard/server and dashboard/web. Both sides import these
// schemas: the server validates requests and its own responses, the browser validates
// what it receives. One source of truth, like a shared OpenAPI model in Java.

export const ENVIRONMENTS = ["dev", "qa", "uat"] as const;

export const newRunRequestSchema = z.object({
  releaseVersion: z
    .string()
    .trim()
    .regex(
      /^\d{4}\.\d{1,2}(\.\d{1,3})?$/,
      "Use the format YYYY.MM or YYYY.MM.patch, e.g. 2026.10.1",
    ),
  environment: z.enum(ENVIRONMENTS),
  grep: z.string().trim().min(1).max(200).default("@Regression"),
  /** Optional feature suites (e.g. "api/cart"); empty = all mapped suites */
  suites: z.array(z.string().max(100)).max(50).default([]),
});
export type NewRunRequest = z.infer<typeof newRunRequestSchema>;

export const stepStateSchema = z.enum(["pending", "running", "done", "failed", "skipped"]);
export type StepState = z.infer<typeof stepStateSchema>;

export const STEP_IDS = ["plan", "queued", "running", "reports", "triage", "published"] as const;
export const progressStepSchema = z.object({
  id: z.enum(STEP_IDS),
  label: z.string(),
  state: stepStateSchema,
  detail: z.string().optional(),
  at: z.string().optional(),
});

export const shardSchema = z.object({ name: z.string(), state: stepStateSchema });

export const runSummarySchema = z.object({
  id: z.string(),
  releaseVersion: z.string(),
  environment: z.string(),
  grep: z.string(),
  planId: z.number().optional(),
  planUrl: z.string().optional(),
  pipelineRunId: z.number().optional(),
  buildUrl: z.string().optional(),
  createdAt: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  result: z.string().optional(),
  passRate: z.number().optional(),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

export const runProgressSchema = z.object({
  run: runSummarySchema,
  steps: z.array(progressStepSchema),
  shards: z.array(shardSchema),
  done: z.boolean(),
});
export type RunProgress = z.infer<typeof runProgressSchema>;

const categorySchema = z.enum(["PRODUCT_BUG", "TEST_ISSUE", "ENVIRONMENT", "FLAKY", "UNKNOWN"]);
export type Category = z.infer<typeof categorySchema>;

export const failureSchema = z.object({
  title: z.string(),
  file: z.string(),
  project: z.string(),
  category: categorySchema,
  kind: z.string(),
  confidence: z.number(),
  reason: z.string(),
  errorSummary: z.string(),
  signatureHash: z.string(),
  isNew: z.boolean(),
  tcId: z.number().optional(),
  testCaseUrl: z.string().optional(),
});

export const clusterViewSchema = z.object({
  signatureHash: z.string(),
  category: categorySchema,
  kind: z.string(),
  confidence: z.number(),
  reason: z.string(),
  count: z.number(),
  sampleError: z.string(),
  isNew: z.boolean(),
  bugId: z.number().optional(),
  bugUrl: z.string().optional(),
});

export const runResultsSchema = z.object({
  runId: z.string(),
  releaseVersion: z.string().optional(),
  kpis: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    flaky: z.number(),
    skipped: z.number(),
    passRate: z.number(),
    durationMs: z.number(),
  }),
  totals: z.record(categorySchema, z.number()),
  clusters: z.array(clusterViewSchema),
  failures: z.array(failureSchema),
  links: z.object({
    build: z.string().optional(),
    artifacts: z.string().optional(),
    testPlan: z.string().optional(),
  }),
});
export type RunResults = z.infer<typeof runResultsSchema>;

export const trendPointSchema = z.object({
  runId: z.string(),
  label: z.string(),
  date: z.string(),
  passRate: z.number(),
  flaky: z.number(),
  failed: z.number(),
  durationMs: z.number(),
});
export type TrendPoint = z.infer<typeof trendPointSchema>;

export const releaseSchema = z.object({
  releaseVersion: z.string(),
  planId: z.number().optional(),
  planUrl: z.string().optional(),
  runs: z.array(runSummarySchema),
  latestOutcome: z.string(),
});
export type Release = z.infer<typeof releaseSchema>;

export const configSchema = z.object({
  mock: z.boolean(),
  pollSeconds: z.number(),
  environments: z.array(z.string()),
  user: z.string().optional(),
});
export type DashboardConfig = z.infer<typeof configSchema>;

export const errorSchema = z.object({ error: z.string(), details: z.unknown().optional() });
