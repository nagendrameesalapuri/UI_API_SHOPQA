import fs from "node:fs";
import { z } from "zod";

// Parses Playwright's JSON report (reports/results.json, also produced by
// `merge-reports --reporter json` and by `playwright test --list --reporter=json`)
// into one flat, normalised list of tests. Everything downstream (triage, Test Plan
// publishing, the dashboard) works on this model, not on Playwright's nested format.

// ---- Raw report schema (only the fields we use; extra fields are ignored) ----

const errorSchema = z.object({
  message: z.string().optional(),
  stack: z.string().optional(),
  location: z.object({ file: z.string(), line: z.number(), column: z.number() }).optional(),
});

type RawStep = { title: string; error?: z.infer<typeof errorSchema>; steps?: RawStep[] };
const stepSchema: z.ZodType<RawStep> = z.lazy(() =>
  z.object({
    title: z.string(),
    error: errorSchema.optional(),
    steps: z.array(stepSchema).optional(),
  }),
);

const resultSchema = z.object({
  status: z.enum(["passed", "failed", "timedOut", "skipped", "interrupted"]).optional(),
  duration: z.number().default(0),
  retry: z.number().default(0),
  error: errorSchema.optional(),
  errors: z.array(errorSchema).default([]),
  steps: z.array(stepSchema).default([]),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        path: z.string().optional(),
        contentType: z.string().optional(),
      }),
    )
    .default([]),
  startTime: z.string().optional(),
});

const testSchema = z.object({
  projectName: z.string().default(""),
  expectedStatus: z.string().optional(),
  status: z.enum(["expected", "unexpected", "flaky", "skipped"]).optional(),
  annotations: z
    .array(z.object({ type: z.string(), description: z.string().optional() }))
    .default([]),
  results: z.array(resultSchema).default([]),
});

const specSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  file: z.string().optional(),
  line: z.number().optional(),
  tags: z.array(z.string()).default([]),
  tests: z.array(testSchema).default([]),
});

type RawSuite = {
  title: string;
  file?: string;
  specs?: z.infer<typeof specSchema>[];
  suites?: RawSuite[];
};
const suiteSchema: z.ZodType<RawSuite> = z.lazy(() =>
  z.object({
    title: z.string(),
    file: z.string().optional(),
    specs: z.array(specSchema).optional(),
    suites: z.array(suiteSchema).optional(),
  }),
);

export const reportSchema = z.object({
  config: z.object({ rootDir: z.string().optional() }).loose().optional(),
  suites: z.array(suiteSchema).default([]),
  errors: z.array(errorSchema).default([]),
  stats: z
    .object({
      startTime: z.string().optional(),
      duration: z.number().optional(),
      expected: z.number().default(0),
      unexpected: z.number().default(0),
      flaky: z.number().default(0),
      skipped: z.number().default(0),
    })
    .optional(),
});
export type RawReport = z.infer<typeof reportSchema>;

// ---- Normalised model ----

export type TestStatus = "passed" | "failed" | "flaky" | "timedOut" | "skipped" | "interrupted";

export type Attachment = { name: string; path?: string; contentType?: string };

export type NormalizedTest = {
  /** Stable id: file + title path + project */
  testId: string;
  title: string;
  /** describe blocks + test title */
  titlePath: string[];
  file: string;
  line?: number;
  project: string;
  /** With leading "@" */
  tags: string[];
  /** Azure Test Case id from @TC-<id> tag, a "TC" annotation, or the overrides file */
  tcId?: number;
  status: TestStatus;
  /** Number of retries that were needed / attempted */
  retries: number;
  errorMessage?: string;
  stack?: string;
  /** Deepest test.step that failed */
  failingStep?: string;
  attachments: Attachment[];
  duration: number;
};

export type ParsedReport = {
  tests: NormalizedTest[];
  failures: NormalizedTest[];
  stats: {
    total: number;
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
    durationMs: number;
    startTime?: string;
  };
  /** Errors outside any test (global setup, config) */
  globalErrors: string[];
};

/** "file > describe > title" -> Azure Test Case id, for tests whose titles can't carry @TC tags */
export type TcOverrides = Record<string, number>;

const ANSI = /\x1b\[[0-9;]*m/g; // eslint-disable-line no-control-regex
export const stripAnsi = (s: string) => s.replace(ANSI, "");

export const TC_TAG = /^@?TC-(\d+)$/i;

export function overrideKey(file: string, titlePath: string[]): string {
  return [file, ...titlePath].join(" > ");
}

export function findTcId(
  tags: string[],
  annotations: { type: string; description?: string }[],
  overrides: TcOverrides,
  key: string,
): number | undefined {
  for (const tag of tags) {
    const m = TC_TAG.exec(tag);
    if (m) return Number(m[1]);
  }
  const ann = annotations.find((a) => /^(tc|testcase|test-case)$/i.test(a.type));
  if (ann?.description && /^\d+$/.test(ann.description.trim()))
    return Number(ann.description.trim());
  return overrides[key];
}

function deepestFailingStep(steps: RawStep[]): string | undefined {
  for (const step of steps) {
    if (step.error) return deepestFailingStep(step.steps ?? []) ?? step.title;
  }
  return undefined;
}

function statusOf(test: z.infer<typeof testSchema>): TestStatus {
  const last = test.results[test.results.length - 1];
  switch (test.status) {
    case "flaky":
      return "flaky";
    case "skipped":
      return "skipped";
    case "expected":
      return test.expectedStatus === "skipped" ? "skipped" : "passed";
    case "unexpected":
      if (last?.status === "timedOut") return "timedOut";
      if (last?.status === "interrupted") return "interrupted";
      return "failed";
    default:
      // --list output has no results/status
      return "skipped";
  }
}

const normalisePath = (p: string) => p.replace(/\\/g, "/");

export function parseReport(raw: unknown, overrides: TcOverrides = {}): ParsedReport {
  const report = reportSchema.parse(raw);
  const tests: NormalizedTest[] = [];

  const walk = (suite: RawSuite, parents: string[], file: string | undefined) => {
    const suiteFile = suite.file ?? file;
    // Top-level suites are files: their title is the file path, not a describe block
    const path = file === undefined ? [] : [...parents, suite.title];
    for (const spec of suite.specs ?? []) {
      const specFile = normalisePath(spec.file ?? suiteFile ?? "");
      const titlePath = [...path, spec.title];
      const tags = spec.tags.map((t) => (t.startsWith("@") ? t : `@${t}`));
      for (const t of spec.tests) {
        const status = statusOf(t);
        const failedResult = t.results.find(
          (r) => r.status && r.status !== "passed" && r.status !== "skipped",
        );
        const key = overrideKey(specFile, titlePath);
        const error = failedResult?.error ?? failedResult?.errors[0];
        tests.push({
          testId: `${specFile}::${titlePath.join(" > ")}::${t.projectName}`,
          title: spec.title,
          titlePath,
          file: specFile,
          line: spec.line,
          project: t.projectName,
          tags,
          tcId: findTcId(tags, t.annotations, overrides, key),
          status,
          retries: Math.max(0, t.results.length - 1),
          errorMessage: error?.message ? stripAnsi(error.message) : undefined,
          stack: error?.stack ? stripAnsi(error.stack) : undefined,
          failingStep: failedResult ? deepestFailingStep(failedResult.steps) : undefined,
          attachments: t.results.flatMap((r) => r.attachments),
          duration: t.results.reduce((sum, r) => sum + r.duration, 0),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, path, suiteFile);
  };
  for (const suite of report.suites) walk(suite, [], undefined);

  const count = (s: TestStatus) => tests.filter((t) => t.status === s).length;
  return {
    tests,
    failures: tests.filter(
      (t) => t.status === "failed" || t.status === "timedOut" || t.status === "flaky",
    ),
    stats: {
      total: tests.length,
      passed: count("passed"),
      failed: count("failed") + count("timedOut") + count("interrupted"),
      flaky: count("flaky"),
      skipped: count("skipped"),
      durationMs: report.stats?.duration ?? 0,
      startTime: report.stats?.startTime,
    },
    globalErrors: report.errors.map((e) => stripAnsi(e.message ?? "")).filter(Boolean),
  };
}

export function readReport(path: string, overrides: TcOverrides = {}): ParsedReport {
  return parseReport(JSON.parse(fs.readFileSync(path, "utf8")), overrides);
}

export function readOverrides(path: string): TcOverrides {
  if (!fs.existsSync(path)) return {};
  return z
    .record(z.string(), z.number().int().positive())
    .parse(JSON.parse(fs.readFileSync(path, "utf8")));
}
